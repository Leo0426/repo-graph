/*
 * MIT License
 *
 * Copyright (c) 2023 Leo Lu.  All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

package com.repograph.taint.tools;

import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.Entrypoint;
import com.ibm.wala.ipa.callgraph.cha.CHACallGraph;
import com.ibm.wala.ipa.callgraph.impl.DefaultEntrypoint;
import com.ibm.wala.ipa.callgraph.impl.Everywhere;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.Selector;
import com.ibm.wala.types.TypeName;
import com.ibm.wala.types.TypeReference;
import com.ibm.wala.util.CancelException;
import com.ibm.wala.util.graph.traverse.SCCIterator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * get all root nodes of the subgraphs of CHA graph
 */
public class UnreachableCollector {
	private static final Logger LOGGER = LoggerFactory.getLogger(UnreachableCollector.class);
	private static UnreachableCollector instance;
	private final IClassHierarchy cha;
	private final CHACallGraph chaCG;
	private final List<IMethod> allAppMethods = new ArrayList<>();
	private final Set<IMethod> handledRootMethods = new HashSet<>();
	private final Set<Set<CGNode>> unanalysedScc = new HashSet<>();
	private final Set<Entrypoint> entriesInConfig = new HashSet<>();
	private final Set<Selector> entrySelectors = new HashSet<>();
	private boolean firstSolve = true;
	private boolean stopUnreachable = false;

	private UnreachableCollector(IClassHierarchy cha) {
		this.cha = cha;
		this.chaCG = new CHACallGraph(cha, true);
		try {
			this.chaCG.init();
		} catch (CancelException cancelException) {
			LOGGER.error("init UnreachableCollector failed: {}", cancelException.getMessage());
		}
		cha.getLoader(ClassLoaderReference.Application).iterateAllClasses()
			.forEachRemaining(clazz -> clazz.getDeclaredMethods()
				.forEach(method -> {
					if (matchConfig(method)) {
						entriesInConfig.add(new DefaultEntrypoint(method, cha));
					}
					allAppMethods.add(method);
				}));
	}

	public static UnreachableCollector getInstance(IClassHierarchy cha) {
		if (instance == null) {
			instance = new UnreachableCollector(cha);
		}
		return instance;
	}

	public static void clear() {
		if (instance != null) {
			instance.allAppMethods.clear();
			instance.handledRootMethods.clear();
			instance.unanalysedScc.clear();
			instance = null;
		}
	}

	private boolean matchConfig(IMethod m) {
		Selector s = m.getSelector();
		for (Selector entrySelector : entrySelectors) {
			if (entrySelector.equals(s)) {
				return true;
			}
			if (!s.getName().equals(entrySelector.getName())) {
				continue;
			}
			TypeName[] cTypeNames = s.getDescriptor().getParameters();
			TypeName[] pTypeNames = entrySelector.getDescriptor().getParameters();
			if (cTypeNames == null && pTypeNames == null) {
				return true;
			}
			if (cTypeNames == null || pTypeNames == null) {
				continue;
			}
			if (cTypeNames.length != pTypeNames.length) {
				continue;
			}
			boolean argMatch = true;
			for (int i = 0; i < cTypeNames.length; i++) {
				TypeName cTypeName = cTypeNames[i];
				TypeName pTypeName = pTypeNames[i];
				if (cTypeName.equals(pTypeName)) {
					continue;
				}
				IClass c1 = cha.lookupClass(TypeReference.findOrCreate(ClassLoaderReference.Application, pTypeName));
				IClass c2 = cha.lookupClass(TypeReference.findOrCreate(ClassLoaderReference.Application, cTypeName));
				if (c1 == null || c2 == null) {
					argMatch = false;
					break;
				}
				if (!cha.isAssignableFrom(c1, c2)) {
					argMatch = false;
					break;
				}
			}
			if (argMatch)
				return true;
		}
		return false;
	}

	public Set<Entrypoint> getEntryPoints() {
		return getUnreachableRoots(new HashSet<>());
	}

	public Set<Entrypoint> getUnreachableRoots(Set<IMethod> visited) {
		SCCTimeoutWatcher timeoutWatcher = new SCCTimeoutWatcher(3000);
		timeoutWatcher.start();

		Map<CGNode, Boolean> zeroIncomingMap = new HashMap<>();
		for (IMethod appMethod : allAppMethods) {
			if (appMethod.isAbstract() || visited.contains(appMethod) || handledRootMethods.contains(appMethod)) {
				continue;
			}
			try {
				CGNode node = chaCG.findOrCreateNode(appMethod, Everywhere.EVERYWHERE);
				node.iterateCallSites().forEachRemaining(callSite -> chaCG.getPossibleTargets(node, callSite)
					.forEach(callee -> zeroIncomingMap.put(callee, false)));
				if (!zeroIncomingMap.containsKey(node)) {
					zeroIncomingMap.put(node, true);
				}
			} catch (CancelException ignore) {
			}
		}

		// scc should be calculated only once
		if (firstSolve) {
			firstSolve = false;
			List<CGNode> sccEntries = new ArrayList<>();
			for (IMethod appMethod : allAppMethods) {
				if (appMethod.isAbstract() || visited.contains(appMethod) || handledRootMethods.contains(appMethod)) {
					continue;
				}
				try {
					CGNode node = chaCG.findOrCreateNode(appMethod, Everywhere.EVERYWHERE);
					if (zeroIncomingMap.get(node)) {
						sccEntries.add(node);
					}
				} catch (CancelException ignore) {
				}
			}
			SCCIterator<CGNode> sccIter = new SCCIterator<>(chaCG, sccEntries.iterator());
			while (sccIter.hasNext()) {
				if (stopUnreachable) {
					LOGGER.info("unreachable searching solver timeout, STOP");
					break;
				}
				Set<CGNode> scc = sccIter.next();
				unanalysedScc.add(scc);
			}
		}

		Set<Entrypoint> result = new HashSet<>();
		List<Set<CGNode>> deleteSccs = new ArrayList<>();
		// first, handle scc
		outouter:
		for (Set<CGNode> scc : unanalysedScc) {
			boolean isolatedScc = true;
			outer:
			for (CGNode node : scc) {
				Iterator<CGNode> iter = chaCG.getPredNodes(node);
				while (iter.hasNext()) {
					if (stopUnreachable) {
						LOGGER.info("unreachable searching solver timeout, out");
						break outouter;
					}
					if (!scc.contains(iter.next())) {
						isolatedScc = false;
						break outer;
					}
				}
			}
			if (isolatedScc) {
				IMethod randomNode = null;
				for (CGNode cgNode : scc) {
					randomNode = cgNode.getMethod();
					if (!randomNode.isPrivate() && !pass(randomNode)
						&& !randomNode.getDeclaringClass().isAbstract()) {
						break;
					}
				}
				if (randomNode != null) {
					handledRootMethods.add(randomNode);
					if (randomNode.toString().contains("fakeRootMethod"))
						continue;
					result.add(new DefaultEntrypoint(randomNode, cha));
				}
				for (CGNode node : scc) {
					zeroIncomingMap.put(node, false);
				}
				deleteSccs.add(scc);
			}
		}

		deleteSccs.forEach(unanalysedScc::remove);

		zeroIncomingMap.forEach((key, value) -> {
			if (value) {
				IMethod tmpMethod = key.getMethod();
				if (pass(tmpMethod)) {
					return;
				}
				handledRootMethods.add(tmpMethod);
				if (tmpMethod.isPrivate() || tmpMethod.getDeclaringClass().isAbstract()) {
					return;
				}
				if (tmpMethod.toString().contains("fakeRootMethod")) {
					return;
				}
				Entrypoint ep = new DefaultEntrypoint(tmpMethod, cha);
				result.add(ep);
			}
		});
		timeoutWatcher.stop();
		return result;
	}

	private boolean pass(IMethod m) {
		return Objects.equals(m.getDeclaringClass().getReference(),
			TypeReference.LambdaMetaFactory);
	}

	private class SCCTimeoutWatcher {
		private final long timeout;

		/**
		 * @param timeout The timeout in seconds after which the solvers shall be
		 *                stopped
		 */
		public SCCTimeoutWatcher(long timeout) {
			this.timeout = timeout;
			stopUnreachable = false;
		}

		public void stop() {
			stopUnreachable = true;
		}

		/**
		 * Starts the timeout watcher
		 */
		public void start() {
			final long startTime = System.currentTimeMillis();

			new Thread(() -> {
				while (!stopUnreachable && ((System.currentTimeMillis() - startTime) < 1000 * timeout)) {
					try {
						Thread.sleep(1000);
					} catch (InterruptedException ignored) {
					}
				}
				stopUnreachable = true;
			}, "SCC Timeout Watcher").start();
		}
	}
}
