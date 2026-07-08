package com.repograph.taint.common;

import com.ibm.wala.classLoader.IField;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.propagation.HeapModel;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.callgraph.propagation.PointerKey;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.util.intset.OrdinalSet;


public class AliasAnalysis {

	private final PointerAnalysis<InstanceKey> pa;

	public AliasAnalysis(PointerAnalysis<InstanceKey> paramPointerAnalysis) {
		this.pa = paramPointerAnalysis;
	}

	/**
	 * Determines whether two pointer keys may alias, i.e., point to overlapping or common memory locations.
	 *
	 * @param paramPointerKey1 the first pointer key
	 * @param paramPointerKey2 the second pointer key
	 * @return true if the two pointer keys may reference overlapping memory, false otherwise
	 */
	public boolean mayAlias(PointerKey paramPointerKey1, PointerKey paramPointerKey2) {
		OrdinalSet<InstanceKey> ordinalSet1 = this.pa.getPointsToSet(paramPointerKey1);
		OrdinalSet<InstanceKey> ordinalSet2 = this.pa.getPointsToSet(paramPointerKey2);
		OrdinalSet<InstanceKey> ordinalSet3 = OrdinalSet.intersect(ordinalSet1, ordinalSet2);
		return !ordinalSet3.isEmpty();
	}

	/**
	 * Determines whether two local variables in respective call graph nodes may alias.
	 *
	 * @param paramCGNode1 the first call graph node
	 * @param paramInt1    the local variable index in the first node
	 * @param paramCGNode2 the second call graph node
	 * @param paramInt2    the local variable index in the second node
	 * @return true if the two local variables can alias, false otherwise
	 */
	public boolean mayAlias(CGNode paramCGNode1, int paramInt1, CGNode paramCGNode2, int paramInt2) {
		HeapModel heapModel = this.pa.getHeapModel();
		PointerKey pointerKey1 = heapModel.getPointerKeyForLocal(paramCGNode1, paramInt1);
		PointerKey pointerKey2 = heapModel.getPointerKeyForLocal(paramCGNode2, paramInt2);
		return mayAlias(pointerKey1, pointerKey2);
	}

	/**
	 * Determines whether a local variable in one call graph node and an instance field in another may alias.
	 *
	 * @param paramCGNode1 the first call graph node
	 * @param paramInt1    the local variable index in the first node
	 * @param paramCGNode2 the second call graph node
	 * @param paramInt2    the local variable index in the second node
	 * @param paramIField  the instance field to check
	 * @return true if the local variable and the instance field may alias, false otherwise
	 */
	public boolean mayAlias(CGNode paramCGNode1, int paramInt1, CGNode paramCGNode2, int paramInt2, IField paramIField) {
		if (paramIField == null)
			return false;
		HeapModel heapModel = this.pa.getHeapModel();
		PointerKey pointerKey1 = heapModel.getPointerKeyForLocal(paramCGNode1, paramInt1);
		PointerKey pointerKey2 = heapModel.getPointerKeyForLocal(paramCGNode2, paramInt2);
		OrdinalSet<InstanceKey> ordinalSet = this.pa.getPointsToSet(pointerKey2);
		for (InstanceKey instanceKey : ordinalSet) {
			PointerKey pointerKey = heapModel.getPointerKeyForInstanceField(instanceKey, paramIField);
			if (mayAlias(pointerKey1, pointerKey))
				return true;
		}
		return false;
	}

	/**
	 * Determines whether a local variable in one call graph node and a static field may alias.
	 *
	 * @param paramCGNode1 the call graph node containing the local variable
	 * @param paramInt     the local variable index in the node
	 * @param paramCGNode2 the call graph node containing the static field
	 * @param paramIField  the static field to check
	 * @return true if the local variable and the static field may alias, false otherwise
	 */
	public boolean mayAlias(CGNode paramCGNode1, int paramInt, CGNode paramCGNode2, IField paramIField) {
		HeapModel heapModel = this.pa.getHeapModel();
		PointerKey pointerKey1 = heapModel.getPointerKeyForLocal(paramCGNode1, paramInt);
		PointerKey pointerKey2 = heapModel.getPointerKeyForStaticField(paramIField);
		return mayAlias(pointerKey1, pointerKey2);
	}

	public boolean mayAlias(FieldReference paramFieldReference1, FieldReference paramFieldReference2) {
		HeapModel heapModel = this.pa.getHeapModel();
		IField iField1 = this.pa.getClassHierarchy().resolveField(paramFieldReference1);
		IField iField2 = this.pa.getClassHierarchy().resolveField(paramFieldReference2);
		PointerKey pointerKey1 = heapModel.getPointerKeyForStaticField(iField1);
		PointerKey pointerKey2 = heapModel.getPointerKeyForStaticField(iField2);
		return mayAlias(pointerKey1, pointerKey2);
	}

	public boolean mayAlias(CGNode paramCGNode, int paramInt, FieldReference paramFieldReference1,
							FieldReference paramFieldReference2) {
		HeapModel heapModel = this.pa.getHeapModel();
		IField iField1 = this.pa.getClassHierarchy().resolveField(paramFieldReference2);
		IField iField2 = this.pa.getClassHierarchy().resolveField(paramFieldReference1);
		PointerKey pointerKey1 = heapModel.getPointerKeyForLocal(paramCGNode, paramInt);
		PointerKey pointerKey2 = heapModel.getPointerKeyForStaticField(iField1);
		OrdinalSet<InstanceKey> ordinalSet = this.pa.getPointsToSet(pointerKey1);
		for (InstanceKey instanceKey : ordinalSet) {
			PointerKey pointerKey = heapModel.getPointerKeyForInstanceField(instanceKey, iField2);
			if (mayAlias(pointerKey, pointerKey2))
				return true;
		}
		return false;
	}
}
