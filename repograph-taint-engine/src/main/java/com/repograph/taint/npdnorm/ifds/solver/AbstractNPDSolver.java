package com.repograph.taint.npdnorm.ifds.solver;

import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.api.report.taint.Flow;
import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.repograph.taint.domain.AbstractDomainElement;
import com.repograph.taint.domain.AbstractDomainElement.Info;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.LocalElement;
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.dataflow.IFDS.ISupergraph;
import com.ibm.wala.dataflow.IFDS.TabulationResult;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.ssa.SSAArrayLengthInstruction;
import com.ibm.wala.ssa.SSAGetInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableIntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Objects;
import java.util.Set;

import static com.repograph.taint.report.util.ComputeLineUtils.getSourcePosition;
import static com.repograph.taint.tools.PathBuilder.traceSinglePath;

public abstract class AbstractNPDSolver {
	private static final Logger LOGGER = LoggerFactory.getLogger(AbstractNPDSolver.class);
	protected SolverManager manager;
	protected TaintResult mResult = new TaintResult();

	// CHECKSTYLE:OFF
	protected void buildResult(
		TabulationResult<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> result) {
		CallGraph cg = manager.getCallgraph();
		ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> isg = ICFGSupergraph.make(cg);

		isg.forEach(bb -> {
			SSAInstruction sinkInst = bb.getLastInstruction();
			if (sinkInst != null && bb.getNode().getIR().getMethod().getDeclaringClass().getClassLoader().getReference()
				.equals(ClassLoaderReference.Application)) {

				// all dereference statement may be SINK
				if (sinkInst instanceof SSAInvokeInstruction
					|| sinkInst instanceof SSAGetInstruction
					|| sinkInst instanceof SSAArrayLengthInstruction) {

					IntSet facts = result.getResult(bb);
					Set<IDomainElement> validSourceSet = new HashSet<>();

					MutableIntSet allFactSet = MutableSparseIntSet.makeEmpty();
					allFactSet.addAll(facts);

					allFactSet.foreach(fact -> {
						if (fact == 0) {
							return;
						}

						NPDDomainElement de = (NPDDomainElement) manager.getDomain().getMappedObject(fact);
						if (de.getCodeElement() instanceof LocalElement ice) {
							if (sinkInst instanceof SSAInvokeInstruction) {
								if (!((SSAInvokeInstruction) sinkInst).isStatic()) {
									if (sinkInst.getUse(0) == ice.getValueNumber() && ice.getCGNode().equals(bb.getNode())) {
										validSourceSet.add(de);
									}
								}
							}
							if (sinkInst instanceof SSAGetInstruction) {
								if (!((SSAGetInstruction) sinkInst).isStatic()) {
									if (sinkInst.getUse(0) == ice.getValueNumber() && ice.getCGNode().equals(bb.getNode())) {
										validSourceSet.add(de);
									}
								}
							}
							if (sinkInst instanceof SSAArrayLengthInstruction) {
								if (sinkInst.getUse(0) == ice.getValueNumber() && ice.getCGNode().equals(bb.getNode())) {
									validSourceSet.add(de);
								}
							}
						}
					});

					if (validSourceSet.isEmpty()) {
						return;
					}
					try {
						buildFlows(bb, validSourceSet);
					} catch (InvalidClassFileException e) {
						LOGGER.error("NPDSolver build get an exception : {} ", e.getMessage());
					}

				}
			}
		});

	}

	private void buildFlows(BasicBlockInContext<IExplodedBasicBlock> bb, Set<IDomainElement> validSourceSet)
		throws InvalidClassFileException {
		String application = manager.getAppName();
		SSAInstruction sinkInst = bb.getDelegate().getInstruction();
		if (sinkInst instanceof SSAInvokeInstruction) {
			for (IDomainElement de : validSourceSet) {
				IMethod toMethod = bb.getMethod();
				int iindex = bb.getDelegate().getInstruction().iIndex();

				int toLineNum = -1;
				if (getSourcePosition(bb.getMethod(), iindex) != null) {
					toLineNum = Objects.requireNonNull(getSourcePosition(bb.getMethod(), iindex)).getLastLine();
				}

				String var = "null";
				Iterator<Info> it = de.getInfos().iterator();

				if (it.hasNext()) {
					Info info = it.next();
					var = de.getValueName(iindex + 1, info);
				}

				BugMateInfo to = BugMateInfo.builder()
					.withBb(bb)
					.withMethod(toMethod)
					.withMethodName(bb.getMethod().getName().toString())
					.withVariable(var)
					.withLineNumber(toLineNum)
					.withCgNode(bb.getNode())
					.withSsaInstruction(sinkInst)
					.build();

				// create path
				Set<List<BugMateInfo>> paths = new HashSet<>();
				traceSinglePath(((AbstractDomainElement) de), application, paths, manager);
				for (List<BugMateInfo> singlePath : paths) {
					BugMateInfo from = singlePath.get(singlePath.size() - 1);
					// create and add flow
					Flow flow = new Flow(from, to, singlePath, new SourceDefinition("nullPointFakeClass",
						"nullPointFakeReturn", "nullPointFakeMethod",
						"", 1, "CWE476", "HIGH"));
					this.mResult.addFlow(flow);
				}
			}
		}
	}
}
