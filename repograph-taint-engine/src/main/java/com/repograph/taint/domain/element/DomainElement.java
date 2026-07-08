package com.repograph.taint.domain.element;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.domain.AbstractDomainElement;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.SourceContext;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ssa.IR;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.types.FieldReference;

import static com.repograph.taint.api.DomainElementType.EXCEPTION;
import static com.repograph.taint.api.DomainElementType.NORMAL;
import static com.repograph.taint.api.DomainElementType.RETURN;
import static com.repograph.taint.extutil.DFAUtils.getSourceCodeVariableName;


/**
 * Represents a domain element in a data flow analysis framework.
 * It contains an access path, element type, and information for data flow analysis.
 */
public class DomainElement extends AbstractDomainElement {

	public static DomainElement ZERO =
		new DomainElement(null, new AccessPath(0, null, null),
			null, NORMAL, null, null);

	private final AccessPath accessPath;
	private final DomainElementType domainElementType;

	private int hashCode = 0;

	/**
	 * Initializes a new {@code DomainElement} instance with the given parameters.
	 *
	 * @param node        The control flow graph node associated with this domain element.
	 * @param accessPath  The access path for this domain element.
	 * @param source      The source context associated with the domain element.
	 * @param deType      The type of the domain element (e.g., NORMAL, RETURN, or EXCEPTION).
	 * @param currentInst The current instruction being processed.
	 * @param predecessor The predecessor in the data flow chain.
	 */
	public DomainElement(CGNode node, AccessPath accessPath, SourceContext source, DomainElementType deType,
						 SSAInstruction currentInst, AbstractDomainElement predecessor) {
		super(node, source, currentInst, predecessor);
		this.accessPath = accessPath;
		this.domainElementType = deType;
	}

	/**
	 * Retrieves the access path of this domain element.
	 *
	 * @return The {@code AccessPath} associated with this domain element.
	 */
	public AccessPath getAccessPath() {
		return accessPath;
	}

	/**
	 * Retrieves the type of this domain element.
	 *
	 * @return The {@code DomainElementType} representing the type of this domain element.
	 */
	@Override
	public DomainElementType getElementType() {
		return domainElementType;
	}

	/**
	 * Checks whether this domain element represents a return type.
	 *
	 * @return {@code true} if this domain element is of type RETURN; {@code false} otherwise.
	 */
	@Override
	public boolean isReturnType() {
		return domainElementType == RETURN;
	}

	/**
	 * Checks whether this domain element represents an exception type.
	 *
	 * @return {@code true} if this domain element is of type EXCEPTION; {@code false} otherwise.
	 */
	@Override
	public boolean isExceptionType() {
		return domainElementType == EXCEPTION;
	}

	/**
	 * Retrieves the domain element type of this instance.
	 *
	 * @return The {@code DomainElementType} representing the type of the domain element.
	 */
	public DomainElementType getDomainElementType() {
		return domainElementType;
	}

	/**
	 * Calculates the hash code of this domain element.
	 *
	 * @return An integer hash code representing this domain element.
	 */
	@Override
	public int hashCode() {
		if (hashCode != 0) {
			return hashCode;
		}
		final int prime = 31;
		int result = 1;
		result = prime * result + ((accessPath == null) ? 0 : accessPath.hashCode());
		result = prime * result + ((domainElementType == null) ? 0 : domainElementType.hashCode());
		result = prime * result + ((reachableSource == null) ? 0 : reachableSource.hashCode());
		hashCode = result;
		return result;
	}

	/**
	 * Determines whether this domain element is equal to another object.
	 *
	 * @param obj The object to compare with.
	 * @return {@code true} if the specified object is equal to this domain element, {@code false} otherwise.
	 */
	@Override
	public boolean equals(Object obj) {
		if (this == obj) {
			return true;
		}
		if (obj == null) {
			return false;
		}
		if (getClass() != obj.getClass()) {
			return false;
		}
		DomainElement other = (DomainElement) obj;
		if (accessPath == null) {
			if (other.accessPath != null) {
				return false;
			}
		} else if (!accessPath.equals(other.accessPath)) {
			return false;
		}
		if (domainElementType != other.domainElementType) {
			return false;
		}
		if (reachableSource == null) {
			return other.reachableSource == null;
		} else return reachableSource.equals(other.reachableSource);
	}

	/**
	 * Returns a string representation of this domain element.
	 *
	 * @return A string describing the access path, reachable source, and domain element type.
	 */
	@Override
	public String toString() {
		return "DomainElement [accessPath=" + accessPath + ", reachableSource=" + reachableSource
			+ ", domainElementType=" + domainElementType + "]";
	}

	@Override
	public String getValueName(int index, Info info) {
		if (isReturnType()) {
			index--;
		}

		if (isReturnType() || isExceptionType()) {
			return "null";
		}

		if (accessPath.isStatic()) {
			return buildStaticAccessPathName();
		}

		return buildInstanceAccessPathName(index, info);
	}


	private String buildStaticAccessPathName() {
		StringBuilder result = new StringBuilder(accessPath.getBaseType().toString());

		for (FieldReference fr : accessPath.getFieldRefs()) {
			result.append('.').append(fr.getName());
		}

		return cleanResult(result.toString());
	}

	private String buildInstanceAccessPathName(int index, Info info) {
		int base = accessPath.getBase();
		SSAInstruction instruction = info.getGenInst();

		if (instruction instanceof SSAInvokeInstruction && accessPath.isLocal()) {
			String result = handleInvokeInstruction(index, base, (SSAInvokeInstruction) instruction, info);
			if (result != null) {
				return result;
			}
		}

		return buildFieldAccessName(index, base, info);
	}

	private String handleInvokeInstruction(int index, int base, SSAInvokeInstruction invokeInstruction, Info info) {
		if (!accessPath.getCGNode().equals(info.getNode())) {
			return handleDifferentNodes(invokeInstruction, info);
		} else if (info.getPredecessor() != null
			&& !((DomainElement) info.getPredecessor()).getAccessPath().getCGNode().equals(info.getNode())) {

			DomainElement predecessorElement = (DomainElement) info.getPredecessor();
			if (predecessorElement.isReturnType()) {
				String result = getSourceCodeName(info.getNode().getIR(), index, base);
				return cleanResult(result);
			}
		}

		return null;
	}

	private String handleDifferentNodes(SSAInvokeInstruction invokeInstruction, Info info) {
		for (int i = 0; i < invokeInstruction.getNumberOfUses(); ++i) {
			AbstractDomainElement preDE = info.getPredecessor();
			if (!(preDE instanceof DomainElement domainElement)) {
				continue;
			}

			if (!domainElement.accessPath.isLocal()) {
				continue;
			}

			int useValue = invokeInstruction.getUse(i);
			if (useValue == domainElement.accessPath.getBase()) {
				String result = getSourceCodeName(accessPath.getCGNode().getIR(), 1, i + 1);
				return cleanResult(result);
			}
		}
		return null;
	}

	private String buildFieldAccessName(int index, int base, Info info) {
		String baseVarName = getSourceCodeName(info.getNode().getIR(), index, base);

		if (accessPath.getFieldLength() != 0) {
			if (!accessPath.isLocal()) {
				StringBuilder fieldPath = new StringBuilder();
				for (FieldReference field : accessPath.getFieldRefs()) {
					fieldPath.append('.').append(field.getName());
				}
				return cleanResult(baseVarName + fieldPath);
			}
		}

		return cleanResult(baseVarName);
	}

	private String getSourceCodeName(IR ir, int index, int value) {
		return getSourceCodeVariableName(ir, index, value);
	}

	private String cleanResult(String result) {
		return result != null && result.contains(",null") ?
			result.replace(",null", "") : result;
	}

	/**
	 * Retrieves the control flow graph (CG) node associated with this domain element.
	 *
	 * @return The {@code CGNode} related to this domain element.
	 */
	@Override
	public CGNode getCGNode() {
		return accessPath.getCGNode();
	}
}
