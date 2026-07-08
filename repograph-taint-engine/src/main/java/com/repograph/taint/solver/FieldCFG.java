package com.repograph.taint.solver;

import com.repograph.taint.common.AliasAnalysis;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.cfg.ControlFlowGraph;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.ssa.*;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * FieldCFG class is responsible for managing the control flow graph (CFG) in relation to fields and their usage.
 * It provides methods to analyze the propagation of field values across the CFG and to identify blocks where fields are used.
 */
public class FieldCFG {

	// Logger for debugging and tracing
	private final Logger logger = LoggerFactory.getLogger(getClass());

	// References to the SolverManager, Class Hierarchy, and Alias Analysis
	private final SolverManager manager;
	private final IClassHierarchy cha;
	private final AliasAnalysis aliasAnalysis;

	// The Control Flow Graph (CFG) being analyzed
	private final ControlFlowGraph<SSAInstruction, IExplodedBasicBlock> cfg;

	// Maps and Sets to track field references, calls, and basic blocks
	private final Map<IExplodedBasicBlock, Set<FieldReference>> bb2fieldRef = new HashMap<>();
	private final Set<FieldReference> fieldRefs = new HashSet<>();
	private final Set<IExplodedBasicBlock> containCalls = new HashSet<>();
	private final Set<IExplodedBasicBlock> containPutFields = new HashSet<>();
	private final Map<FieldReference, Set<IExplodedBasicBlock>> fieldRef2BB = new HashMap<>();

	// Caches for field and local queries
	private final Map<FieldReferenceEntity, List<IExplodedBasicBlock>> fieldQuery;
	private final Map<LocalFieldEntity, List<IExplodedBasicBlock>> localQuery;

	/**
	 * Constructor for FieldCFG.
	 *
	 * @param paramSolverManager    The SolverManager instance managing the analysis
	 * @param paramControlFlowGraph The Control Flow Graph (CFG) to be analyzed
	 */
	public FieldCFG(SolverManager paramSolverManager,
					ControlFlowGraph<SSAInstruction, IExplodedBasicBlock> paramControlFlowGraph) {
		this.manager = paramSolverManager;
		this.cha = paramSolverManager.getClassHierarchy();
		this.aliasAnalysis = new AliasAnalysis(paramSolverManager.getPointerAnalysis());
		this.cfg = paramControlFlowGraph;

		// Initialize the analysis
		FieldInstVisitor h
			= new FieldInstVisitor(this,
			this.bb2fieldRef, this.containCalls, this.containPutFields, this.fieldRefs, this.fieldRef2BB);

		for (IExplodedBasicBlock iExplodedBasicBlock : paramControlFlowGraph) {
			h.getCurrentBB(iExplodedBasicBlock);
			for (SSAInstruction sSAInstruction : iExplodedBasicBlock) {
				sSAInstruction.visit(h);
			}
		}
		this.fieldQuery = new HashMap<>();
		this.localQuery = new HashMap<>();
	}

	/**
	 * Returns the Control Flow Graph (CFG) being analyzed.
	 *
	 * @return The CFG
	 */
	public ControlFlowGraph<SSAInstruction, IExplodedBasicBlock> getCFG() {
		return this.cfg;
	}

	/**
	 * Returns a set of basic blocks that field values fall through to when starting from a given block.
	 * Used for analyzing the propagation of zero values.
	 *
	 * @param paramBasicBlockInContext The basic block to start the analysis from
	 * @return A set of basic blocks that field values fall through to
	 */
	public Set<IExplodedBasicBlock> getZeroFallThroughTo(
		BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext) {
		HashSet<IExplodedBasicBlock> hashSet = new HashSet<>();
		if (paramBasicBlockInContext.isEntryBlock()) {
			hashSet.addAll(this.containCalls);
			hashSet.addAll(this.containPutFields);
			hashSet.add(this.cfg.exit());
		}
		return hashSet;
	}

	/**
	 * Returns a list of successor blocks for a given CGNode, value number, and basic block.
	 * Used for analyzing the propagation of local values.
	 *
	 * @param paramCGNode              The CGNode being analyzed
	 * @param paramInt                 The value number in question
	 * @param paramIExplodedBasicBlock The basic block to start the analysis from
	 * @return A list of successor basic blocks
	 */
	public List<IExplodedBasicBlock> getLocalFallThroughTo(
		CGNode paramCGNode, int paramInt, IExplodedBasicBlock paramIExplodedBasicBlock) {
		LocalFieldEntity j
			= new LocalFieldEntity(this, paramCGNode, paramInt, paramIExplodedBasicBlock);
		if (!this.localQuery.containsKey(j)) {
			List<IExplodedBasicBlock> list = calculateLocalSucc(paramCGNode, paramInt, paramIExplodedBasicBlock);
			this.localQuery.put(j, list);
		}
		return this.localQuery.get(j);
	}

	/**
	 * Calculates the local successors for a given CGNode, value number, and basic block.
	 * This is used to trace the propagation of values within a local context.
	 *
	 * @param paramCGNode              The CGNode being analyzed
	 * @param paramInt                 The value number in question
	 * @param paramIExplodedBasicBlock The starting basic block
	 * @return A list of successor basic blocks
	 */
	private List<IExplodedBasicBlock> calculateLocalSucc(CGNode paramCGNode, int paramInt,
														 IExplodedBasicBlock paramIExplodedBasicBlock) {
		ArrayList<IExplodedBasicBlock> arrayList = new ArrayList<>();
		LinkedList<IExplodedBasicBlock> linkedList = new LinkedList<>();
		HashSet<IExplodedBasicBlock> hashSet = new HashSet<>();
		linkedList.add(paramIExplodedBasicBlock);

		while (!linkedList.isEmpty()) {
			IExplodedBasicBlock iExplodedBasicBlock = linkedList.remove();
			hashSet.add(iExplodedBasicBlock);
			Iterator<IExplodedBasicBlock> iterator = this.cfg.getSuccNodes(iExplodedBasicBlock);

			while (iterator.hasNext()) {
				IExplodedBasicBlock iExplodedBasicBlock1 = iterator.next();
				if (arrayList.contains(iExplodedBasicBlock1)) {
					continue;
				}

				SSAInstruction sSAInstruction = iExplodedBasicBlock1.getLastInstruction();
				if (sSAInstruction instanceof SSAInvokeInstruction sSAInvokeInstruction) {
					if (!sSAInvokeInstruction.isStatic() && sSAInvokeInstruction.getUse(0) == paramInt) {
						arrayList.add(iExplodedBasicBlock1);
						continue;
					}
					if (this.manager.getKillManager().getInvokeKills()
						.contains(sSAInvokeInstruction.getDeclaredTarget())) {
						arrayList.add(iExplodedBasicBlock1);
						continue;
					}
					if (used(iExplodedBasicBlock1, paramInt)) {
						arrayList.add(iExplodedBasicBlock1);
					}
					if (!hashSet.contains(iExplodedBasicBlock1) && !linkedList.contains(iExplodedBasicBlock1)) {
						linkedList.add(iExplodedBasicBlock1);
					}
					continue;
				}
				if (used(iExplodedBasicBlock1, paramInt)) {
					arrayList.add(iExplodedBasicBlock1);
				}
				if (!hashSet.contains(iExplodedBasicBlock1) && !linkedList.contains(iExplodedBasicBlock1)) {
					linkedList.add(iExplodedBasicBlock1);
				}
			}
		}
		return arrayList;
	}

	/**
	 * Checks if a given value is used in a given basic block.
	 *
	 * @param paramIExplodedBasicBlock The basic block being checked
	 * @param paramInt                 The value number being checked
	 * @return True if the value is used in the basic block, otherwise false
	 */
	private boolean used(IExplodedBasicBlock paramIExplodedBasicBlock, int paramInt) {
		Iterator<SSAPhiInstruction> iterator = paramIExplodedBasicBlock.iteratePhis();
		while (iterator.hasNext()) {
			SSAPhiInstruction sSAPhiInstruction = iterator.next();
			for (byte b = 0; b < sSAPhiInstruction.getNumberOfUses(); b++) {
				if (sSAPhiInstruction.getUse(b) == paramInt)
					return true;
			}
		}
		SSAInstruction sSAInstruction = paramIExplodedBasicBlock.getLastInstruction();
		if (sSAInstruction != null)
			for (byte b = 0; b < sSAInstruction.getNumberOfUses(); b++) {
				if (sSAInstruction.getUse(b) == paramInt)
					return true;
			}
		Iterator<SSAPiInstruction> iterator1 = paramIExplodedBasicBlock.iteratePis();
		while (iterator1.hasNext()) {
			SSAPiInstruction sSAPiInstruction = iterator1.next();
			for (byte b = 0; b < sSAPiInstruction.getNumberOfUses(); b++) {
				if (sSAPiInstruction.getUse(b) == paramInt)
					return true;
			}
		}
		if (paramIExplodedBasicBlock.isCatchBlock()) {
			SSAGetCaughtExceptionInstruction sSAGetCaughtExceptionInstruction
				= paramIExplodedBasicBlock.getCatchInstruction();
			if (sSAGetCaughtExceptionInstruction != null)
				for (byte b = 0; b < sSAGetCaughtExceptionInstruction.getNumberOfUses(); b++) {
					if (sSAGetCaughtExceptionInstruction.getUse(b) == paramInt)
						return true;
				}
		}
		return false;
	}

	/**
	 * Checks if a given value or its alias is used in a given basic block.
	 *
	 * @param paramIExplodedBasicBlock The basic block being checked
	 * @param paramCGNode              The CGNode being analyzed
	 * @param paramInt                 The value number being checked
	 * @return True if the value or its alias is used in the basic block, otherwise false
	 */
	private boolean usedOrAlias(IExplodedBasicBlock paramIExplodedBasicBlock, CGNode paramCGNode, int paramInt) {
		Iterator<SSAPhiInstruction> iterator = paramIExplodedBasicBlock.iteratePhis();
		while (iterator.hasNext()) {
			SSAPhiInstruction sSAPhiInstruction = iterator.next();
			for (byte b = 0; b < sSAPhiInstruction.getNumberOfUses(); b++) {
				if (sSAPhiInstruction.getUse(b) == paramInt
					|| this.aliasAnalysis.mayAlias(paramCGNode, sSAPhiInstruction.getUse(b), paramCGNode, paramInt))
					return true;
			}
		}
		SSAInstruction sSAInstruction = paramIExplodedBasicBlock.getLastInstruction();
		if (sSAInstruction != null)
			for (byte b = 0; b < sSAInstruction.getNumberOfUses(); b++) {
				if (sSAInstruction.getUse(b) == paramInt
					|| this.aliasAnalysis.mayAlias(paramCGNode, sSAInstruction.getUse(b), paramCGNode, paramInt))
					return true;
			}
		Iterator<SSAPiInstruction> iterator1 = paramIExplodedBasicBlock.iteratePis();
		while (iterator1.hasNext()) {
			SSAPiInstruction sSAPiInstruction = iterator1.next();
			for (byte b = 0; b < sSAPiInstruction.getNumberOfUses(); b++) {
				if (sSAPiInstruction.getUse(b) == paramInt
					|| this.aliasAnalysis.mayAlias(paramCGNode, sSAPiInstruction.getUse(b), paramCGNode, paramInt))
					return true;
			}
		}
		if (paramIExplodedBasicBlock.isCatchBlock()) {
			SSAGetCaughtExceptionInstruction sSAGetCaughtExceptionInstruction
				= paramIExplodedBasicBlock.getCatchInstruction();
			if (sSAGetCaughtExceptionInstruction != null)
				for (byte b = 0; b < sSAGetCaughtExceptionInstruction.getNumberOfUses(); b++) {
					if (sSAGetCaughtExceptionInstruction.getUse(b) == paramInt
						|| this.aliasAnalysis.mayAlias(paramCGNode, sSAGetCaughtExceptionInstruction.getUse(b),
						paramCGNode, paramInt))
						return true;
				}
		}
		return false;
	}

	/**
	 * Returns a list of successor blocks for a given CGNode, value number, and field reference.
	 * Used for analyzing the propagation of field values.
	 *
	 * @param paramCGNode              The CGNode being analyzed
	 * @param paramInt                 The value number in question
	 * @param paramFieldReference      The field reference in question
	 * @param paramIExplodedBasicBlock The basic block to start the analysis from
	 * @return A list of successor basic blocks
	 */
	public List<IExplodedBasicBlock> getFallThroughTo(CGNode paramCGNode, int paramInt,
													  FieldReference paramFieldReference,
													  IExplodedBasicBlock paramIExplodedBasicBlock) {
		FieldReferenceEntity i = new FieldReferenceEntity(this, paramCGNode, paramInt,
			paramFieldReference, paramIExplodedBasicBlock);
		if (!this.fieldQuery.containsKey(i)) {
			List<IExplodedBasicBlock> list = calculateSucc(paramCGNode, paramInt,
				paramFieldReference, paramIExplodedBasicBlock);
			this.fieldQuery.put(i, list);
		}
		return this.fieldQuery.get(i);
	}

	/**
	 * Calculates the successors for a given CGNode, value number, and field reference.
	 * This is used to trace the propagation of field values.
	 *
	 * @param paramCGNode              The CGNode being analyzed
	 * @param paramInt                 The value number in question
	 * @param paramFieldReference      The field reference in question
	 * @param paramIExplodedBasicBlock The starting basic block
	 * @return A list of successor basic blocks
	 */
	private List<IExplodedBasicBlock> calculateSucc(CGNode paramCGNode, int paramInt,
													FieldReference paramFieldReference,
													IExplodedBasicBlock paramIExplodedBasicBlock) {
		ArrayList<IExplodedBasicBlock> arrayList = new ArrayList<>();
		LinkedList<IExplodedBasicBlock> linkedList = new LinkedList<>();
		HashSet<IExplodedBasicBlock> hashSet = new HashSet<>();
		linkedList.add(paramIExplodedBasicBlock);

		while (!linkedList.isEmpty()) {
			IExplodedBasicBlock iExplodedBasicBlock = linkedList.remove();
			hashSet.add(iExplodedBasicBlock);
			Iterator<IExplodedBasicBlock> iterator = this.cfg.getSuccNodes(iExplodedBasicBlock);

			while (iterator.hasNext()) {
				IExplodedBasicBlock iExplodedBasicBlock1 = iterator.next();
				if (arrayList.contains(iExplodedBasicBlock1)) {
					continue;
				}

				Set<FieldReference> set = this.bb2fieldRef.get(iExplodedBasicBlock1);
				if (iExplodedBasicBlock1.isExitBlock() || this.containCalls.contains(iExplodedBasicBlock1)
					|| (set != null && DFAUtils.containsCommonField(this.cha, set, paramFieldReference))
					|| useBase(paramInt, paramFieldReference, iExplodedBasicBlock1)) {
					arrayList.add(iExplodedBasicBlock1);
					continue;
				}
				if (!hashSet.contains(iExplodedBasicBlock1) && !linkedList.contains(iExplodedBasicBlock1)) {
					linkedList.add(iExplodedBasicBlock1);
				}
			}
		}
		return arrayList;
	}

	/**
	 * Checks if a given value is used as a base in a given basic block.
	 *
	 * @param paramInt                 The value number being checked
	 * @param paramFieldReference      The field reference in question
	 * @param paramIExplodedBasicBlock The basic block being checked
	 * @return True if the value is used as a base, otherwise false
	 */
	private boolean useBase(int paramInt, FieldReference paramFieldReference,
							IExplodedBasicBlock paramIExplodedBasicBlock) {
		boolean bool = false;
		Iterator<SSAPhiInstruction> iterator = paramIExplodedBasicBlock.iteratePhis();
		while (iterator.hasNext()) {
			SSAPhiInstruction sSAPhiInstruction = iterator.next();
			for (byte b = 0; b < sSAPhiInstruction.getNumberOfUses(); b++) {
				if (sSAPhiInstruction.getUse(b) == paramInt)
					bool = true;
			}
		}
		Iterator<SSAPiInstruction> iterator1 = paramIExplodedBasicBlock.iteratePis();
		while (iterator1.hasNext()) {
			SSAPiInstruction sSAPiInstruction = iterator1.next();
			for (byte b = 0; b < sSAPiInstruction.getNumberOfUses(); b++) {
				if (sSAPiInstruction.getUse(b) == paramInt)
					bool = true;
			}
		}
		SSAInstruction sSAInstruction = paramIExplodedBasicBlock.getLastInstruction();
		if (sSAInstruction == null)
			return bool;

		if (sSAInstruction instanceof SSAGetInstruction) {
			if (sSAInstruction.getDef() == paramInt)
				bool = true;
		} else if (sSAInstruction instanceof SSAPutInstruction) {
			if (((SSAPutInstruction) sSAInstruction).getVal() == paramInt)
				bool = true;
		} else {
			for (byte b = 0; b < sSAInstruction.getNumberOfUses(); b++) {
				if (sSAInstruction.getUse(b) == paramInt) {
					bool = true;
					break;
				}
			}
		}
		return bool;
	}

	/**
	 * Debugging method to print the internal mappings and sets.
	 */
	private void debug() {
		this.logger.debug(" BB to field reference:");
		for (Map.Entry<IExplodedBasicBlock, Set<FieldReference>> entry : this.bb2fieldRef.entrySet()) {
			IExplodedBasicBlock iExplodedBasicBlock = entry.getKey();
			Set<FieldReference> set = entry.getValue();
			this.logger.debug("BB[" + iExplodedBasicBlock.getNumber() + "]:");
			DFAUtils.listSetElements(set);
		}
		this.logger.debug("field reference to BB: ");
		for (Map.Entry<FieldReference, Set<IExplodedBasicBlock>> entry : this.fieldRef2BB.entrySet()) {
			FieldReference fieldReference = entry.getKey();
			Set<IExplodedBasicBlock> set = entry.getValue();
			this.logger.debug("field ref: " + fieldReference);
			for (IExplodedBasicBlock iExplodedBasicBlock : set) {
				this.logger.debug("BB[" + iExplodedBasicBlock.getNumber() + "]");
			}
		}
		this.logger.debug("BB that contains call: ");
		for (IExplodedBasicBlock iExplodedBasicBlock : this.containCalls) {
			this.logger.debug("BB[" + iExplodedBasicBlock.getNumber() + "]");
		}
		this.logger.debug("BB that contains putFields: ");
		for (IExplodedBasicBlock iExplodedBasicBlock : this.containPutFields) {
			this.logger.debug("BB[" + iExplodedBasicBlock.getNumber() + "]");
		}
		this.logger.debug("all field reference");
		DFAUtils.listSetElements(this.fieldRefs);
	}
}
