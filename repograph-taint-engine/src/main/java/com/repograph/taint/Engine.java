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

package com.repograph.taint;

import com.repograph.taint.api.IContext;
import com.repograph.taint.api.IPropagationTransform;
import com.repograph.taint.support.framework.spring.entrypoint.SpringEntryPointCreator;
import com.repograph.taint.tools.UnreachableCollector;
import com.ibm.wala.classLoader.Language;
import com.ibm.wala.core.util.ProgressMaster;
import com.ibm.wala.core.util.config.AnalysisScopeReader;
import com.ibm.wala.core.util.io.FileProvider;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.ipa.callgraph.AnalysisCache;
import com.ibm.wala.ipa.callgraph.AnalysisCacheImpl;
import com.ibm.wala.ipa.callgraph.AnalysisOptions;
import com.ibm.wala.ipa.callgraph.AnalysisScope;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.CallGraphBuilder;
import com.ibm.wala.ipa.callgraph.Entrypoint;
import com.ibm.wala.ipa.callgraph.impl.Util;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cha.ClassHierarchy;
import com.ibm.wala.ipa.cha.ClassHierarchyException;
import com.ibm.wala.ipa.cha.ClassHierarchyFactory;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.ssa.SSAGetCaughtExceptionInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAPhiInstruction;
import com.ibm.wala.ssa.SSAPiInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.Descriptor;
import com.ibm.wala.types.Selector;
import com.ibm.wala.util.MonitorUtil;
import com.ibm.wala.util.NullProgressMonitor;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

import static com.repograph.taint.report.util.FileLoaderUtil.assemblerFiles;
import static com.ibm.wala.ipa.callgraph.impl.Util.makeMainEntrypoints;
import static java.util.Objects.nonNull;

/**
 * engine entrypoint.
 *
 * @author leolu
 * @since 2023/10/25
 */
public class Engine {
	private static final Logger LOGGER = LoggerFactory.getLogger(Engine.class);

	/**
	 * use phantom algorithm or not.
	 */
	private final boolean phantom;

	private final List<Path> targetPath;

	private final String taskName;

	private final String taintWrapper;

	public Engine(IContext context) {
		LOGGER.info("SAST-Tool start init engine ...");
		this.targetPath = context.getTargetPath();
		this.taskName = context.getTaskName();
		this.phantom = context.getCheckConfig().isPhantom();
		this.taintWrapper = context.getSourceFileConfig().getSummaryConfigPath().toAbsolutePath().toString();
	}

	public static List<String> searchEntriesByMain(IClassHierarchy cha) {
		List<String> result = new ArrayList<>();
		cha.getLoader(ClassLoaderReference.Application).iterateAllClasses().forEachRemaining(clazz -> {
			final Atom mainMethod = Atom.findOrCreateAsciiAtom("main");
			Selector selector = new Selector(mainMethod, Descriptor.findOrCreateUTF8("([Ljava/lang/String;)V"));
			clazz.getDeclaredMethods().forEach(method -> {
				if (method.getSelector().equals(selector)) {
					String className = clazz.getName().toString();
					result.add(className);
				}
			});
		});
		return result;
	}

	/**
	 * each BasicBlockInContext contain one core instruction and several phi
	 * instructions (or other insts, or no inst) before it. evaluate these
	 * pre-instructions. d1 != 0;
	 */
	public static MutableSparseIntSet evaluateBeforeCoreInst(
		BasicBlockInContext<IExplodedBasicBlock> src, int d1, AbsNormalFlowVisitor visitor) {
		Iterator<SSAPhiInstruction> phiIterator = src.iteratePhis();
		boolean hasElement = false;
		if (src.isCatchBlock()) {
			hasElement = true;
			SSAGetCaughtExceptionInstruction catchInstruction = src.getDelegate().getCatchInstruction();
			if (catchInstruction != null) {
				catchInstruction.visit(visitor);
			}
		}
		while (phiIterator.hasNext()) {
			hasElement = true;
			SSAInstruction inst = phiIterator.next();
			inst.visit(visitor);
		}
		if (!hasElement) {
			MutableSparseIntSet ret = MutableSparseIntSet.makeEmpty();
			ret.add(d1);
			return ret;
		}
		return visitor.getIntSet();
	}

	/**
	 * each BasicBlockInContext contain one core instruction and several pi
	 * instructions (or other insts, or no inst) after it. evaluate these
	 * post-instructions. d1 != 0;
	 */
	public static IntSet evaluateAfterCoreInst(BasicBlockInContext<IExplodedBasicBlock> bb, int d1,
											   AbsNormalFlowVisitor visitor) {
		Iterator<SSAPiInstruction> piIterator = bb.iteratePis();
		boolean hasElement = false;
		while (piIterator.hasNext()) {
			hasElement = true;
			SSAInstruction inst = piIterator.next();
			inst.visit(visitor);
		}
		if (!hasElement) {
			MutableSparseIntSet ret = MutableSparseIntSet.makeEmpty();
			ret.add(d1);
			return ret;
		}
		return visitor.getIntSet();
	}

	public IPropagationTransform assemblerEngine() throws IOException, ClassHierarchyException {

		LOGGER.info("SAST-Tool start assembler analysis check info...");

		targetPath.forEach(e -> LOGGER.info("Scan project path is : {}", e.toString()));

		AnalysisScope scope =
			AnalysisScopeReader.instance.makeJavaBinaryAnalysisScope(
				targetPath.get(0).toString(), new FileProvider()
					.getFile("/opt/config/Java60RegressionExclusions.txt"));

		// assemblerFiles, maybe custom scope.
		assemblerFiles(scope, targetPath.get(0).toString());

		ClassHierarchy cha;
		if (phantom) {
			cha = ClassHierarchyFactory.makeWithPhantom(scope);
		} else {
			cha = ClassHierarchyFactory.makeWithRoot(scope);
		}

		Set<Entrypoint> entryPoints = new HashSet<>(UnreachableCollector.getInstance(cha).getEntryPoints());
		List<String> strings = searchEntriesByMain(cha);

		try {
			makeMainEntrypoints(cha, strings.toArray(new String[0])).forEach(entryPoints::add);
		} catch (Exception ignore) {
		}

		Set<Entrypoint> springEntryPoints = (new SpringEntryPointCreator()).getEntryPoints(scope, cha);
		if (nonNull(springEntryPoints) && !springEntryPoints.isEmpty()) {
			entryPoints.addAll(springEntryPoints);
		}

		if (entryPoints.isEmpty()) {
			return null;
		}
		// search main
		AnalysisOptions options = new AnalysisOptions(scope, entryPoints);

		// user default IR factory.
		AnalysisCache cache = new AnalysisCacheImpl();

		return generatorIPA(options, cache, cha);
	}

	private IPropagationTransform generatorIPA(AnalysisOptions options, AnalysisCache cache, ClassHierarchy cha) {
		return makeByRTA(options, cache, cha);
	}

	// build an RTA call graph
	public IPropagationTransform makeByRTA(AnalysisOptions options, AnalysisCache cache, ClassHierarchy cha) {
		CallGraphBuilder<InstanceKey> rtaBuilder
			= Util.makeZeroOneCFABuilder(Language.JAVA, options, cache, cha);
		MonitorUtil.IProgressMonitor make = ProgressMaster.make(
			new NullProgressMonitor(), 30 * 10000, true);
		CallGraph cgNodes = null;
		try {
			cgNodes = rtaBuilder.makeCallGraph(options, make);
		} catch (Exception e) {
			LOGGER.error("generator ipa get an exception : {}", e.getMessage());
		}

		return IPropagationTransform.builder()
			.withProjectName(taskName)
			.withWrapperFile(taintWrapper)
			.withAnalysisCache(rtaBuilder.getAnalysisCache())
			.withClassHierarchy(rtaBuilder.getClassHierarchy())
			.withPointerAnalysis(rtaBuilder.getPointerAnalysis())
			.withCgNodes(cgNodes)
			.build();
	}
}
