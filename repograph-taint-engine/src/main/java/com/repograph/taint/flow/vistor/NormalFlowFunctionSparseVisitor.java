package com.repograph.taint.flow.vistor;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.sourcesink.KillFieldDefinition;
import com.repograph.taint.sourcesink.KillManager;
import com.repograph.taint.sourcesink.SourceSinkGroup;
import com.repograph.taint.AbsNormalFlowVisitor;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.TaintDomain;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.flow.sparse.util.SparseTaintUtil;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.ssa.SSAArrayLoadInstruction;
import com.ibm.wala.ssa.SSAArrayStoreInstruction;
import com.ibm.wala.ssa.SSABinaryOpInstruction;
import com.ibm.wala.ssa.SSACheckCastInstruction;
import com.ibm.wala.ssa.SSAConversionInstruction;
import com.ibm.wala.ssa.SSAGetCaughtExceptionInstruction;
import com.ibm.wala.ssa.SSAGetInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SSAPhiInstruction;
import com.ibm.wala.ssa.SSAPutInstruction;
import com.ibm.wala.ssa.SSAReturnInstruction;
import com.ibm.wala.ssa.SSAThrowInstruction;
import com.ibm.wala.ssa.SSAUnaryOpInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.util.debug.Assertions;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class NormalFlowFunctionSparseVisitor extends AbsNormalFlowVisitor {

	private final TaintDomain domain;
	private final IClassHierarchy classHierarchy;
	private final int d1;
	private final DomainElement domainElement;
	private final AccessPath accessPath;
	private final CGNode cgNode;
	private final BasicBlockInContext<IExplodedBasicBlock> src;
	private final BasicBlockInContext<IExplodedBasicBlock> dest;
	private final KillManager killManager;
	private SourceSinkGroup sourceSinkGroup;

	public NormalFlowFunctionSparseVisitor(SolverManager solverManager, int d1,
										   BasicBlockInContext<IExplodedBasicBlock> src,
										   BasicBlockInContext<IExplodedBasicBlock> dest) {
		this.domain = (TaintDomain) solverManager.getDomain();
		this.classHierarchy = solverManager.getClassHierarchy();
		this.d1 = d1;
		this.domainElement = (DomainElement) this.domain.getMappedObject(d1);
		this.accessPath = this.domainElement.getAccessPath();
		this.cgNode = src.getNode();
		this.src = src;
		this.dest = dest;
		this.killManager = solverManager.getKillManager();
		this.sourceSinkGroup = solverManager.getCurrentSourceSinkGroup();
	}

	public void visitArrayLoad(SSAArrayLoadInstruction inst) {
		int arrayRef = inst.getArrayRef();
		if (this.accessPath.getBase() == arrayRef) {
			AccessPath newPath = new AccessPath(inst.getDef(), this.accessPath.cloneFieldRefs(), this.cgNode);
			this.ret.add(this.domain.add(new DomainElement(this.cgNode, newPath, this.domainElement.getSource(), DomainElementType.NORMAL, inst, this.domainElement)));
		}
	}

	public void visitArrayStore(SSAArrayStoreInstruction inst) {
		int value = inst.getValue();
		int arrayRef = inst.getArrayRef();
		if (this.accessPath.getBase() == value) {
			AccessPath newPath = new AccessPath(arrayRef, this.accessPath.cloneFieldRefs(), this.cgNode);
			this.ret.add(this.domain.add(new DomainElement(this.cgNode, newPath, this.domainElement.getSource(), DomainElementType.NORMAL, inst, this.domainElement)));
		} else if (this.accessPath.getBase() == arrayRef) {
			this.ret.remove(this.d1);
		}
	}

	public void visitReturn(SSAReturnInstruction inst) {
		if (!inst.returnsVoid()) {
			int result = inst.getResult();
			if (this.accessPath.getBase() == result) {
				DomainElement domainElement1
					= new DomainElement(this.cgNode, this.accessPath.clone(), this.domainElement.getSource(), DomainElementType.RETURN, inst, this.domainElement);
				this.ret.add(this.domain.add(domainElement1));
			}
		}
	}

	public void visitThrow(SSAThrowInstruction inst) {
		int exception = inst.getException();
		if (this.accessPath.getBase() == exception) {
			if (this.dest.isCatchBlock()) {
				SSAGetCaughtExceptionInstruction catchInst = this.dest.getDelegate().getCatchInstruction();
				int caught = catchInst.getException();
				AccessPath newPath = new AccessPath(caught, this.accessPath.cloneFieldRefs(), this.cgNode);
				this.ret.add(this.domain.add(new DomainElement(this.cgNode, newPath, this.domainElement.getSource(), DomainElementType.NORMAL, inst, this.domainElement)));
			} else if (this.dest.isExitBlock()) {
				this.ret.add(this.domain.add(new DomainElement(this.cgNode, this.accessPath.clone(), this.domainElement.getSource(), DomainElementType.EXCEPTION, inst, this.domainElement)));
			}
		}
	}

	public void visitGet(SSAGetInstruction inst) {
		FieldReference field = inst.getDeclaredField();
		int base = inst.getRef();
		int def = inst.getDef();
		if (this.accessPath.getBase() != def) {
			if (this.accessPath.getFirstField() == null || DFAUtils.isCommonField(this.classHierarchy, field, this.accessPath.getFirstField())) {
				if (inst.isStatic()) {
					if (this.accessPath.isStatic()) {
						AccessPath newPath = new AccessPath(def, this.accessPath.cutFirstField(), this.cgNode);
						this.ret.add(this.domain.add(new DomainElement(this.cgNode, newPath, this.domainElement.getSource(), DomainElementType.NORMAL, inst, this.domainElement)));
					}
				} else if (this.accessPath.getBase() == base) {
					AccessPath newPath = new AccessPath(def, this.accessPath.cutFirstField(), this.cgNode);
					this.ret.add(this.domain.add(new DomainElement(this.cgNode, newPath, this.domainElement.getSource(), DomainElementType.NORMAL, inst, this.domainElement)));
				} else {
					Set<List<FieldReference>> aliasPaths = new HashSet<>();
					if (SparseTaintUtil.matchAccessPath(this.cgNode, base, this.accessPath, aliasPaths)) {
						for (List<FieldReference> aliasFieldRefs : aliasPaths) {
							AccessPath aliasBase = new AccessPath(base, aliasFieldRefs, this.cgNode);
							AccessPath aliasDef = new AccessPath(def, aliasBase.cutFirstField(), this.cgNode);
							this.ret.add(this.domain.add(new DomainElement(this.cgNode, aliasBase, this.domainElement.getSource(), DomainElementType.NORMAL, inst, this.domainElement)));
							this.ret.add(this.domain.add(new DomainElement(this.cgNode, aliasDef, this.domainElement.getSource(), DomainElementType.NORMAL, inst, this.domainElement)));
						}
					}
				}
			}
		}
	}

	public void visitPut(SSAPutInstruction inst) {
		int value = inst.getVal();
		int ref = inst.getRef();
		FieldReference field = inst.getDeclaredField();
		if (this.accessPath.getBase() == value) {
			if (this.killManager.needKillField(new KillFieldDefinition(field.getDeclaringClass().getName().toString(), field.getName().toString(), field.getFieldType().getName().toString()))) {
				return;
			}
			AccessPath newPath = new AccessPath(ref, this.accessPath.appendFirstField(field), this.cgNode);
			this.ret.add(this.domain.add(new DomainElement(this.cgNode, newPath, this.domainElement.getSource(), DomainElementType.NORMAL, inst, this.domainElement)));
			this.ret.add(this.d1);
		} else {
			FieldReference firstField = this.accessPath.getFirstField();
			if (this.accessPath.getBase() != ref || firstField == null || !DFAUtils.isCommonField(this.classHierarchy, field, firstField)) {
				this.ret.add(this.d1);
			}
		}
	}

	public void visitInvoke(SSAInvokeInstruction inst) {
		Assertions.UNREACHABLE();
	}

	public void visitBinaryOp(SSABinaryOpInstruction inst) {
		handleUnaryBinaryPhi(inst);
	}

    public void visitUnaryOp(SSAUnaryOpInstruction inst) {
        handleUnaryBinaryPhi(inst);
    }

	  public void visitCheckCast(SSACheckCastInstruction inst) {
        handleUnaryBinaryPhi(inst);
    }

	  public void visitPhi(SSAPhiInstruction inst) {
        handleUnaryBinaryPhi(inst);
    }

	public void visitConversion(SSAConversionInstruction inst) {
        handleUnaryBinaryPhi(inst);
    }

    private void handleUnaryBinaryPhi(SSAInstruction inst) {
        int useCount = inst.getNumberOfUses();
        for (int i = 0; i < useCount; i++) {
            int use = inst.getUse(i);
            if (use == this.accessPath.getBase()) {
                int def = inst.getDef();
                AccessPath newPath = new AccessPath(def, this.accessPath.cloneFieldRefs(), this.cgNode);
                this.ret.add(this.domain.add(new DomainElement(this.cgNode, newPath, this.domainElement.getSource(), DomainElementType.NORMAL, inst, this.domainElement)));
                break;
            }
        }
    }

}
