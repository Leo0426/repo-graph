package com.repograph.taint.flow.vistor;

import com.repograph.taint.AbsNormalFlowVisitor;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.util.SparseUtil;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAArrayLengthInstruction;
import com.ibm.wala.ssa.SSAArrayLoadInstruction;
import com.ibm.wala.ssa.SSAArrayStoreInstruction;
import com.ibm.wala.ssa.SSABinaryOpInstruction;
import com.ibm.wala.ssa.SSACheckCastInstruction;
import com.ibm.wala.ssa.SSAComparisonInstruction;
import com.ibm.wala.ssa.SSAConditionalBranchInstruction;
import com.ibm.wala.ssa.SSAConversionInstruction;
import com.ibm.wala.ssa.SSAGetCaughtExceptionInstruction;
import com.ibm.wala.ssa.SSAGetInstruction;
import com.ibm.wala.ssa.SSAGotoInstruction;
import com.ibm.wala.ssa.SSAInstanceofInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SSALoadMetadataInstruction;
import com.ibm.wala.ssa.SSAMonitorInstruction;
import com.ibm.wala.ssa.SSANewInstruction;
import com.ibm.wala.ssa.SSAPhiInstruction;
import com.ibm.wala.ssa.SSAPiInstruction;
import com.ibm.wala.ssa.SSAPutInstruction;
import com.ibm.wala.ssa.SSAReturnInstruction;
import com.ibm.wala.ssa.SSASwitchInstruction;
import com.ibm.wala.ssa.SSAThrowInstruction;
import com.ibm.wala.ssa.SSAUnaryOpInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.util.debug.Assertions;

import java.util.HashSet;
import java.util.List;

import static com.repograph.taint.api.DomainElementType.EXCEPTION;
import static com.repograph.taint.api.DomainElementType.NORMAL;
import static com.repograph.taint.api.DomainElementType.RETURN;

public class NormalFlowFunctionVisitor extends AbsNormalFlowVisitor {

	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;
	private final int d1;
	private final DomainElement domainElement;
	private final AccessPath accessPath;
	private final CGNode cgNode;
	private final BasicBlockInContext<IExplodedBasicBlock> src;
	private final BasicBlockInContext<IExplodedBasicBlock> dest;


	public NormalFlowFunctionVisitor(SolverManager solverManager, int d1,
									 BasicBlockInContext<IExplodedBasicBlock> src,
									 BasicBlockInContext<IExplodedBasicBlock> dest) {
		this.domain = solverManager.getDomain();
		this.d1 = d1;
		this.domainElement = (DomainElement) this.domain.getMappedObject(d1);
		this.accessPath = this.domainElement.getAccessPath();
		this.cgNode = src.getNode();
		this.src = src;
		this.dest = dest;
	}

	@Override
	public void visitGoto(SSAGotoInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitArrayLoad(SSAArrayLoadInstruction instruction) {
		this.ret.add(this.d1);
		int arrayRef = instruction.getArrayRef();
		if (this.accessPath.getBase() == arrayRef) {
			this.ret.add(this.domain.add(new DomainElement(this.cgNode,
				new AccessPath(instruction.getDef(), this.accessPath.cloneFieldRefs(), this.cgNode),
				this.domainElement.getSource(), NORMAL, instruction, this.domainElement)));
		}
	}

	@Override
	public void visitArrayStore(SSAArrayStoreInstruction instruction) {
		this.ret.add(this.d1);
		int value = instruction.getValue();
		int arrayRef = instruction.getArrayRef();
		if (this.accessPath.getBase() == value) {
			this.ret.add(this.domain.add(new DomainElement(this.cgNode,
				new AccessPath(arrayRef, this.accessPath.cloneFieldRefs(), this.cgNode),
				this.domainElement.getSource(), NORMAL, instruction, this.domainElement)));
		} else if (this.accessPath.getBase() == arrayRef) {
			this.ret.remove(this.d1);
		}
	}

	@Override
	public void visitComparison(SSAComparisonInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitConditionalBranch(SSAConditionalBranchInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitSwitch(SSASwitchInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitReturn(SSAReturnInstruction instruction) {
		this.ret.add(this.d1);
		if (!instruction.returnsVoid()) {
			int result = instruction.getResult();
			if (this.accessPath.getBase() == result) {
				this.ret.add(this.domain.add(
					new DomainElement(this.cgNode, this.accessPath.clone(),
						this.domainElement.getSource(), RETURN, instruction, this.domainElement)));
			}
		}

		// TODO: CWE79 need update.
//		if (GlobalConfig.getConfig().isWebRetSink(this.passKind)) {
//			String returnType = this.cgNode.getMethod().getReturnType().getName().toString();
//			Set<String> returnTypes = GlobalConfig.getConfig().getPassConfig().getConfig(PassKindEnum.CWE79, "ReturnType");
//			if (returnTypes.contains(returnType) && Utils.hasRequestMappingAnno(this.cgNode.getMethod())) {
//				this.sourceSinkGroup.addSinkBB(this.basicBlockInContext1);
//			}
//		}
	}

	@Override
	public void visitNew(SSANewInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitThrow(SSAThrowInstruction instruction) {
		this.ret.add(this.d1);
		if (this.accessPath.getBase() == instruction.getException()) {
			if (this.dest.isCatchBlock()) {
				SSAGetCaughtExceptionInstruction catchInstruction = this.dest.getDelegate().getCatchInstruction();
				this.ret.add(this.domain.add(new DomainElement(this.cgNode,
					new AccessPath(catchInstruction.getException(), this.accessPath.cloneFieldRefs(), this.cgNode),
					this.domainElement.getSource(), NORMAL, instruction, this.domainElement)));
			} else if (this.dest.isExitBlock()) {
				this.ret.add(this.domain.add(new DomainElement(this.cgNode, this.accessPath.clone(),
					this.domainElement.getSource(), EXCEPTION, instruction, this.domainElement)));
			}
		}
	}


	@Override
	public void visitGetCaughtException(SSAGetCaughtExceptionInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitMonitor(SSAMonitorInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitInstanceof(SSAInstanceofInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitPi(SSAPiInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitLoadMetadata(SSALoadMetadataInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitGet(SSAGetInstruction instruction) {
		FieldReference field = instruction.getDeclaredField();
		int ref = instruction.getRef();
		int def = instruction.getDef();

		if (this.accessPath.getBase() != def) {
			this.ret.add(this.d1);
			if (this.accessPath.getFirstField() == null
				|| DFAUtils.isCommonField(this.cgNode.getClassHierarchy(), field, this.accessPath.getFirstField())) {

				if (instruction.isStatic()) {
					if (this.accessPath.isStatic()) {
						this.ret.add(this.domain.add(new DomainElement(this.cgNode,
							new AccessPath(def, this.accessPath.cutFirstField(), this.cgNode),
							this.domainElement.getSource(), NORMAL, instruction, this.domainElement)));
					}

				} else if (this.accessPath.getBase() == ref) {
					this.ret.add(this.domain.add(new DomainElement(this.cgNode,
						new AccessPath(def, this.accessPath.cutFirstField(), this.cgNode),
						this.domainElement.getSource(), NORMAL, instruction, this.domainElement)));
				} else {
					if (this.src.getNode().equals(this.accessPath.getCGNode())) {
						HashSet<List<FieldReference>> possiblePaths = new HashSet<>();

						if (SparseUtil.matchAccessPaths(this.cgNode, ref, this.accessPath, possiblePaths)) {
							for (List<FieldReference> path : possiblePaths) {
								AccessPath accessPath = new AccessPath(ref, path, this.cgNode);
								this.ret.add(this.domain.add(new DomainElement(this.cgNode,
									accessPath, this.domainElement.getSource(),
									NORMAL, instruction, this.domainElement)));

								this.ret.add(this.domain.add(
									new DomainElement(this.cgNode,
										new AccessPath(def, accessPath.cutFirstField(), this.cgNode),
										this.domainElement.getSource(),
										NORMAL, instruction, this.domainElement)));
							}
						}
					}
				}
			}
		}
	}

	@Override
	public void visitPut(SSAPutInstruction instruction) {
		int value = instruction.getVal();
		int ref = instruction.getRef();
		FieldReference field = instruction.getDeclaredField();

		if (this.accessPath.getBase() == value) {
			this.ret.add(this.d1);

//			if (this.killManager.needKillField(new KillFieldDefinition(
//				fieldReference.getDeclaringClass().getName().toString(),
//				fieldReference.getName().toString(),
//				fieldReference.getFieldType().getName().toString()))) {
//				return;
//			}

			int domain = this.domain.add(new DomainElement(this.cgNode,
				new AccessPath(ref, this.accessPath.appendFirstField(field), this.cgNode),
				this.domainElement.getSource(), NORMAL, instruction, this.domainElement));
			this.ret.add(domain);
		} else {
			FieldReference firstField = this.accessPath.getFirstField();
			if (this.accessPath.getBase() != ref || firstField == null
				|| !DFAUtils.isCommonField(this.cgNode.getClassHierarchy(), field, firstField)) {
				this.ret.add(this.d1);
			}
		}
	}

	@Override
	public void visitInvoke(SSAInvokeInstruction instruction) {
		Assertions.UNREACHABLE();
	}

	@Override
	public void visitArrayLength(SSAArrayLengthInstruction instruction) {
		this.ret.add(this.d1);
	}

	@Override
	public void visitBinaryOp(SSABinaryOpInstruction instruction) {
		this.processUnaryOrBinaryInstruction(instruction);
	}

	@Override
	public void visitUnaryOp(SSAUnaryOpInstruction instruction) {
		this.processUnaryOrBinaryInstruction(instruction);
	}

	@Override
	public void visitCheckCast(SSACheckCastInstruction instruction) {
		this.processUnaryOrBinaryInstruction(instruction);
	}

	@Override
	public void visitPhi(SSAPhiInstruction instruction) {
		this.processUnaryOrBinaryInstruction(instruction);
	}

	@Override
	public void visitConversion(SSAConversionInstruction instruction) {
		this.processUnaryOrBinaryInstruction(instruction);
	}

	private void processUnaryOrBinaryInstruction(SSAInstruction instruction) {

		if (!(instruction instanceof SSAUnaryOpInstruction)
			&& !(instruction instanceof SSABinaryOpInstruction)
			&& !(instruction instanceof SSAPhiInstruction)
			&& !(instruction instanceof SSAConversionInstruction)
			&& !(instruction instanceof SSACheckCastInstruction)) {
			throw new AssertionError();
		}

		this.ret.add(this.d1);
		int numberOfUses = instruction.getNumberOfUses();

		for (int i = 0; i < numberOfUses; ++i) {
			int use = instruction.getUse(i);
			if (use == this.accessPath.getBase()) {
				int def = instruction.getDef();
				this.ret.add(this.domain.add(
					new DomainElement(this.cgNode,
						new AccessPath(def, this.accessPath.cloneFieldRefs(), this.cgNode),
						this.domainElement.getSource(), NORMAL, instruction, this.domainElement)));
				break;
			}
		}
	}


}
