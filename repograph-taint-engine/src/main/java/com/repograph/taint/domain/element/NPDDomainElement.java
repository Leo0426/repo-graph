package com.repograph.taint.domain.element;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.domain.AbstractDomainElement;
import com.repograph.taint.domain.SourceContext;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;

import static com.repograph.taint.extutil.DFAUtils.getSourceCodeVariableName;


/**
 * Represents an element in the Null Pointer Dereference (NPD) domain for taint analysis.
 * <p>
 * This class is a concrete implementation of {@link AbstractDomainElement} and models a specific
 * program state in the context of taint analysis, particularly focusing on potential null pointer
 * dereferences. It encapsulates a code element, source context, and information about its
 * predecessors to track taint propagation.
 * </p>
 */
public class NPDDomainElement extends AbstractDomainElement {
	public static NPDDomainElement ZERO = new NPDDomainElement(null,
		new LocalElement(-1, null), null, null, null);
	private final ICodeElement codeElement;
	private int hashCode = 0;

	/**
	 * Constructs a new {@link NPDDomainElement} with the provided parameters.
	 *
	 * @param node        the call graph node representing the context of this domain element
	 * @param ce          the code element associated with this domain element
	 * @param source      the source context of this domain element
	 * @param currentInst the current SSA instruction being analyzed
	 * @param predecessor the previous domain element in the analysis flow
	 */
	public NPDDomainElement(CGNode node, ICodeElement ce, SourceContext source,
							SSAInstruction currentInst, AbstractDomainElement predecessor) {
		super(node, source, currentInst, predecessor);
		this.codeElement = ce;
	}

	/**
	 * Retrieves the code element associated with this domain element.
	 *
	 * @return the {@link ICodeElement} representing the underlying code structure of this element
	 */
	public ICodeElement getCodeElement() {
		return this.codeElement;
	}

	/**
	 * Computes a hash code for this domain element to support equality checks.
	 *
	 * @return a computed hash code value
	 */
	public int hashCode() {
		if (this.hashCode != 0) {
			return this.hashCode;
		} else {
			int prime = 31;
			int result = super.hashCode();
			result = 31 * result + (this.codeElement == null ? 0 : this.codeElement.hashCode());
			this.hashCode = result;
			return result;
		}
	}

	/**
	 * Determines whether this domain element is equal to another object.
	 *
	 * @param obj the object to compare with this domain element
	 * @return {@code true} if the objects are equal, {@code false} otherwise
	 */
	public boolean equals(Object obj) {
		if (this == obj) {
			return true;
		} else if (!super.equals(obj)) {
			return false;
		} else if (this.getClass() != obj.getClass()) {
			return false;
		} else {
			NPDDomainElement other = (NPDDomainElement) obj;
			if (this.codeElement == null) {
				if (other.codeElement != null) {
					return false;
				}
			} else if (!this.codeElement.equals(other.codeElement)) {
				return false;
			}

			if (this.reachableSource == null) {
				if (other.reachableSource != null) {
					return false;
				}
			} else if (!this.reachableSource.equals(other.reachableSource)) {
				return false;
			}

			return true;
		}
	}

	/**
	 * Returns a string representation of this domain element.
	 *
	 * @return a string describing the associated {@link ICodeElement}
	 */
	public String toString() {
		return this.codeElement.toString();
	}

	/**
	 * Retrieves the type of this domain element (e.g., RETURN, EXCEPTION, NORMAL).
	 *
	 * @return the {@link DomainElementType} associated with this domain element
	 */
	public DomainElementType getElementType() {
		if (this.codeElement instanceof ReturnElement) {
			return DomainElementType.RETURN;
		} else {
			return this.codeElement instanceof ExceptionElement ? DomainElementType.EXCEPTION : DomainElementType.NORMAL;
		}
	}

	/**
	 * Determines whether this domain element represents a return type.
	 *
	 * @return {@code true} if this element is a return type, {@code false} otherwise
	 */
	public boolean isReturnType() {
		return this.getElementType() == DomainElementType.RETURN;
	}

	/**
	 * Determines whether this domain element represents an exception type.
	 *
	 * @return {@code true} if this element is an exception type, {@code false} otherwise
	 */
	public boolean isExceptionType() {
		return this.getElementType() == DomainElementType.EXCEPTION;
	}

	/**
	 * Generates a name or description for the value associated with this domain element.
	 * <p>
	 * The result reflects the specific variable or field referenced by this domain element
	 * in the context of source code analysis, adjusted based on its type (e.g., StaticFieldElement,
	 * ReturnFieldElement).
	 * </p>
	 *
	 * @param index the code index used for locating the variable or field
	 * @param info  additional analysis information provided by the {@link AbstractDomainElement.Info}
	 * @return a string representation of the value name
	 */
	public String getValueName(int index, AbstractDomainElement.Info info) {
		if (this.codeElement instanceof ReturnElement) {
			--index;
		} else if (this.codeElement instanceof ReturnFieldElement) {
			--index;
		}

		String result = "null";
		if (!this.isReturnType() && !this.isExceptionType()) {
			if (this.codeElement instanceof StaticFieldElement) {
				StaticFieldElement staticFieldElement = (StaticFieldElement) this.codeElement;
				result = staticFieldElement.getFieldRef().getDeclaringClass().toString() + "." + staticFieldElement.getFieldRef().getName();
				if (result != null && result.contains(",null")) {
					result = result.replace(",null", "");
				}

				return result;
			}

			if (this.codeElement instanceof AbsLocalElement) {
				AbsLocalElement localElement = (AbsLocalElement) this.getCodeElement();
				if (localElement instanceof NormalFieldElement) {
					NormalFieldElement normalFieldElement = (NormalFieldElement) localElement;
					result = getSourceCodeVariableName(info.getNode().getIR(), index, localElement.getValueNumber()) + "." + normalFieldElement.getFieldRef().getName();
					if (result != null && result.contains(",null")) {
						result = result.replace(",null", "");
					}

					return result;
				}

				SSAInstruction instruction = info.getGenInst();
				if (instruction instanceof SSAInvokeInstruction) {
					SSAInvokeInstruction invokeInstruction = (SSAInvokeInstruction) instruction;
					if (this.getCodeElement() instanceof LocalElement) {
						LocalElement calleeElement = (LocalElement) this.getCodeElement();
						if (!calleeElement.getCGNode().equals(info.getNode())) {
							for (int i = 0; i < instruction.getNumberOfUses(); ++i) {
								AbstractDomainElement preDE = info.getPredecessor();
								NPDDomainElement NPDDomainElement = (NPDDomainElement) preDE;
								if (NPDDomainElement.getCodeElement() instanceof LocalElement && instruction.getUse(i) == ((AbsLocalElement) NPDDomainElement.getCodeElement()).getValueNumber() && !invokeInstruction.isStatic()) {
									String number = "th";
									if (i == 2) {
										number = "nd";
									}

									if (i == 3) {
										number = "rd";
									}

									if (i == 1) {
										number = "st";
									}

									result = "the " + i + number + " argument " + getSourceCodeVariableName(calleeElement.getCGNode().getIR(), 1, i + 1) == null ? "" : getSourceCodeVariableName(calleeElement.getCGNode().getIR(), 1, i + 1);
									if (result != null && result.contains(",null")) {
										result = result.replace(",null", "");
									}

									return result;
								}

								if (NPDDomainElement.getCodeElement() instanceof LocalElement && instruction.getUse(i) == ((AbsLocalElement) NPDDomainElement.getCodeElement()).getValueNumber() && invokeInstruction.isStatic()) {
									String number = "th";
									if (i == 0) {
										number = "st";
									}

									if (i == 1) {
										number = "nd";
									}

									if (i == 2) {
										number = "rd";
									}

									result = "the " + (i + 1) + number + " argument  " + getSourceCodeVariableName(calleeElement.getCGNode().getIR(), 1, i + 1) == null ? "" : getSourceCodeVariableName(calleeElement.getCGNode().getIR(), 1, i + 1);
									if (result != null && result.contains(",null")) {
										result = result.replace(",null", "");
									}

									return result;
								}
							}
						} else if (instruction.getDef() == -1 && info.getPredecessor() != null) {
							AbstractDomainElement preDE = info.getPredecessor();
							NPDDomainElement NPDDomainElement = (NPDDomainElement) preDE;
							if (NPDDomainElement.getCodeElement() instanceof ReturnElement) {
								ReturnElement returnElement = (ReturnElement) NPDDomainElement.getCodeElement();
								if (!returnElement.getCGNode().equals(localElement.getCGNode())) {
									result = getSourceCodeVariableName(localElement.getCGNode().getIR(), index, localElement.getValueNumber()) + " tainted by the return value of " + returnElement.getCGNode().getMethod().toString();
									if (result.contains(",null")) {
										result = result.replace(",null", "");
									}

									return result;
								}
							}
						}
					}
				}

				result = getSourceCodeVariableName(localElement.getCGNode().getIR(), index, localElement.getValueNumber());
			}
		}

		if (result.contains(",null")) {
			result = result.replace(",null", "");
		}

		return result;
	}

	/**
	 * Retrieves the call graph node (CGNode) associated with this domain element.
	 *
	 * @return the {@link CGNode} representing the method/context to which this element belongs
	 */
	public CGNode getCGNode() {
		return this.codeElement.getCGNode();
	}
}
