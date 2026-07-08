package com.repograph.taint.solver;

import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.api.report.taint.Flow;
import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.sourcesink.SinkDefinition;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.repograph.taint.sourcesink.SourceSinkGroup;
import com.repograph.taint.sourcesink.type.TaintedType;
import com.repograph.taint.domain.AbstractDomainElement;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.google.common.base.CharMatcher;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.dataflow.IFDS.TabulationResult;
import com.ibm.wala.dataflow.IFDS.TabulationSolver;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.ssa.IR;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SSAReturnInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.collections.Pair;
import com.ibm.wala.util.intset.IntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Arrays;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static com.repograph.taint.tools.TaintPathBuilder.traceSinglePath;
import static com.repograph.taint.extutil.DFAUtils.getSourcePosition;

public abstract class AbstractTaintSolver implements ITaintSolver {
	private static final Logger LOGGER = LoggerFactory.getLogger(AbstractTaintSolver.class);

	protected TabulationSolver<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> solver = null;
	protected int factsCount = 0;
	protected SolverManager manager;
	protected TaintResult taintResult = new TaintResult();

	public AbstractTaintSolver(SolverManager manager) {
		this.manager = manager;
	}

	protected abstract Map<Integer, Set<Pair<IDomainElement, SourceDefinition>>> argIndex2FlowtoDomainElements(
		BasicBlockInContext<IExplodedBasicBlock> bb, IntSet facts);

	public void buildResult(TabulationResult<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> result) {

		LOGGER.info("TaintSolver start building result ...");
		SourceSinkGroup ssg = manager.getCurrentSourceSinkGroup();
		for (Iterator<BasicBlockInContext<IExplodedBasicBlock>> it = ssg.sinkIterator(); it.hasNext(); ) {
			BasicBlockInContext<IExplodedBasicBlock> bb = it.next();
			IntSet facts = result.getResult(bb);
			Map<Integer, Set<Pair<IDomainElement, SourceDefinition>>> sourceDEs = argIndex2FlowtoDomainElements(bb, facts);
			if (sourceDEs.isEmpty()) {
				continue;
			}
			SSAInstruction sinkInst = bb.getDelegate().getInstruction();

			Set<IDomainElement> validSourceSet = new HashSet<>();
			Set<Pair<IDomainElement, SourceDefinition>> tempStates = new HashSet<>();
			if (sinkInst instanceof SSAInvokeInstruction) {
				// generate valid source and path
				Set<SinkDefinition> sinkDefines = manager.getSourceSinkManager().getSinkDefinition(
					manager.getClassHierarchy(), ((SSAInvokeInstruction) sinkInst).getDeclaredTarget());

				sinkDefines.forEach(sinkDefine -> {
					validSourceSet.addAll(validSource(sinkDefine, sourceDEs));
					tempStates.addAll(transformPairs(sourceDEs));
				});
			}
			if (sinkInst instanceof SSAReturnInstruction) {
				validSourceSet.addAll(sourceDEs.values().stream().flatMap(Collection::stream)
					.map(pair -> pair.fst)
					.collect(Collectors.toSet()));
				tempStates.addAll(transformPairs(sourceDEs));
			}
			if (validSourceSet.isEmpty()) {
				continue;
			}
			buildFlows(bb, validSourceSet, tempStates);
		}
		if (this.taintResult.isEmpty()) {
			LOGGER.info("result is empty, no source to sink!");
		}
	}

	/**
	 * calculate flows, a flow is represented as {from, to}
	 */
	protected void buildFlows(BasicBlockInContext<IExplodedBasicBlock> bb,
							  Set<IDomainElement> validSourceSet, Set<Pair<IDomainElement, SourceDefinition>> pairs) {
		String application = manager.getAppName();
		SSAInstruction sinkInst = bb.getDelegate().getInstruction();
		for (IDomainElement de : validSourceSet) {
			SourceDefinition sourceDefinition = null;
			for (Pair<IDomainElement, SourceDefinition> pair : pairs) {
				if (pair.fst.equals(de)) {
					sourceDefinition = pair.snd;
					break;
				}
			}

			BugMateInfo to;
			try {
				to = assemblerLastSinkMetadata(bb, de, sinkInst);
			} catch (InvalidClassFileException e) {
				throw new RuntimeException(e);
			}

			try {
				// create path
				Set<List<BugMateInfo>> paths = new HashSet<>();
				traceSinglePath(((AbstractDomainElement) de), application, paths, manager, solver);

				for (List<BugMateInfo> singlePath : paths) {
					BugMateInfo from = singlePath.get(singlePath.size() - 1);
					Flow flow = new Flow(from, to, singlePath, sourceDefinition);
					this.taintResult.addFlow(flow);
				}
			} catch (InvalidClassFileException e) {
				LOGGER.error("TaintSolver buildFlows get an exception : {}", e.getMessage());
			}
		}
		LOGGER.info("build flows path valid Source Set finished. ");
	}

	/**
	 * create sink MetaData
	 */
	private BugMateInfo assemblerLastSinkMetadata(
		BasicBlockInContext<IExplodedBasicBlock> bb, IDomainElement de, SSAInstruction sinkInst)
		throws InvalidClassFileException {

		IMethod toMethod = bb.getMethod();
		IR ir = bb.getNode().getIR();

		int iindex = sinkInst.iIndex();

		int toLineNum = -1;
		if (getSourcePosition(bb.getMethod(), iindex) != null) {
			toLineNum = Objects.requireNonNull(getSourcePosition(bb.getMethod(), iindex)).getLastLine();
		}

		String variables = "null";
		if (de instanceof DomainElement) {
			AccessPath accessPath = ((DomainElement) de).getAccessPath();
			int base = accessPath.getBase();
			String[] localNames = ir.getLocalNames(iindex, base);
			variables = CharMatcher.inRange('[', ']').trimFrom(Arrays.toString(localNames));
		}

		return BugMateInfo.builder()
			.withBb(bb)
			.withMethod(toMethod)
			.withVariable(variables)
			.withLineNumber(toLineNum)
			.withCgNode(bb.getNode())
			.withSsaInstruction(sinkInst)
			.build();
	}


	/**
	 * add sources to given sink according to taintedTypes
	 */
	private Set<IDomainElement> validSource(
		SinkDefinition sinkDefine, Map<Integer, Set<Pair<IDomainElement, SourceDefinition>>> idx2des) {
		Set<IDomainElement> res = new HashSet<>();
		List<TaintedType> taintedTypes = sinkDefine.getTaintedTypes();
		for (TaintedType taintedType : taintedTypes) {
			res.addAll(taintedType.collectValidElements(idx2des));
		}
		return res;
	}

	/**
	 * save temp pairs states.
	 */
	private Set<Pair<IDomainElement, SourceDefinition>> transformPairs(
		Map<Integer, Set<Pair<IDomainElement, SourceDefinition>>> pair) {
		Set<Pair<IDomainElement, SourceDefinition>> result = new HashSet<>();
		for (Set<Pair<IDomainElement, SourceDefinition>> value : pair.values()) {
			result.addAll(value);
		}
		return result;
	}
}
