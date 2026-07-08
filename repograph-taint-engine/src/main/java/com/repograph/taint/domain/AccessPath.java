package com.repograph.taint.domain;

import com.ibm.wala.analysis.typeInference.TypeInference;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.TypeReference;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;


/**
 * Represents an access path in a program, consisting of:
 * - A base identifier representing a local variable, static field, or `null` value.
 * - A call graph node for contextual information about the associated method.
 * - A sequence of field references representing object field accesses.
 * <p>
 * This class is widely used in program analysis tasks, including taint and dataflow analysis,
 * to identify, track, and manipulate program structures referencing memory or objects.
 *
 * @author leo
 */
public class AccessPath {


	private static final int maxFieldDepth = 3;

	/**
	 * An identifier representing the base variable or object in the access path.
	 * Special values:
	 * - -1: Indicates a static field.
	 * - -3: Represents a null base.
	 * Any other non-negative value represents a local variable.
	 */
	private final int base;

	/**
	 * Represents the call graph node in which this access path is analyzed.
	 * Provides context about the method and its instructions.
	 */
	private final CGNode node;
	private final List<FieldReference> fieldRefs = new ArrayList<>();
	private TypeReference baseType;


	/**
	 * Constructs an `AccessPath` with the specified base identifier, field references, and call graph node.
	 *
	 * @param id        the base identifier representing a variable or special meaning (-1: static, -3: null base)
	 * @param fieldRefs a list of field references forming the access path; truncated to a maximum depth
	 * @param node      the associated call graph node that provides contextual information
	 */
	public AccessPath(int id, List<FieldReference> fieldRefs, CGNode node) {
		this.base = id;
		this.node = node;
		if (fieldRefs != null) {
			if (fieldRefs.size() > maxFieldDepth) {
				for (int i = 0; i < maxFieldDepth; i++) {
					this.fieldRefs.add(fieldRefs.get(i));
				}
			} else {
				this.fieldRefs.addAll(fieldRefs);
			}
		}
	}

	/**
	 * Returns a new list of field references excluding the first field.
	 * If the access path has no fields, it returns an empty list. If the path
	 * contains only one field, the result is an empty list as well.
	 * exp: `obj.field1.field2.field3`
	 *
	 * @return a new list with the first field removed or an empty list if no fields are present.
	 */
	public List<FieldReference> cutFirstField() {
		if (fieldRefs.isEmpty()) {
			return List.of();
		}
		return new ArrayList<>(fieldRefs.subList(1, fieldRefs.size()));
	}

	/**
	 * Creates a new field reference list by prepending the given field to the start of the current list.
	 * This method is useful when extending the access path with a new initial field.
	 *
	 * @param field the field to be added at the beginning of the list.
	 * @return a new list with the provided field prepended.
	 */
	public List<FieldReference> appendFirstField(FieldReference field) {
		List<FieldReference> tmpList = new ArrayList<>(fieldRefs);
		tmpList.add(0, field);
		return tmpList;
	}

	/**
	 * Creates a new field reference list by appending the given field to the end of the current list.
	 * Allows extending the access path with a new trailing field.
	 *
	 * @param field the field to be added at the end of the list.
	 * @return a new list with the provided field appended.
	 */
	public List<FieldReference> appendLastField(FieldReference field) {
		List<FieldReference> tmpList = new ArrayList<>(fieldRefs);
		tmpList.add(field);
		return tmpList;
	}

	/**
	 * Returns the `TypeReference` of the base object in the access path.
	 * The base type is computed by inferring types from the call graph node's intermediate representation (IR).
	 * Supports both dynamic (e.g., local variables) and static fields.
	 *
	 * @return the base object's type as a `TypeReference`, or `TypeReference.Null` if unavailable.
	 */
	public TypeReference getBaseType() {
		if (baseType != null) {
			return baseType;
		}
		try {
			if (node != null) {
				TypeInference typeInference = TypeInference.make(node.getIR(), true);
				if (base >= 0) {
					baseType = typeInference.getType(base).getTypeReference();
				}
				// static
				else if (base == -1) {
					baseType = getFirstField().getDeclaringClass();
				} else if (base == -3) {
					baseType = TypeReference.Null;
				} else {
					baseType = TypeReference.Null;
				}
			} else {
				baseType = TypeReference.Null;
			}
		} catch (Exception e) {
			baseType = TypeReference.Null;
		}

		return baseType;
	}

	/**
	 * Retrieves the first field reference in the access path, if available.
	 *
	 * @return the first `FieldReference` in the list, or `null` if the list is empty.
	 */
	public FieldReference getFirstField() {
		if (fieldRefs.isEmpty()) {
			return null;
		}
		return fieldRefs.get(0);
	}

	public boolean isStatic() {
		return base == -1;
	}

	public int getBase() {
		return base;
	}

	public CGNode getCGNode() {
		return node;
	}

	public List<FieldReference> getFieldRefs() {
		return fieldRefs;
	}

	public int getFieldLength() {
		return fieldRefs.size();
	}

	public boolean isLocal() {
		return base > 0 && fieldRefs.isEmpty();
	}

	@Override
	public AccessPath clone() {
		return new AccessPath(base, List.copyOf(fieldRefs), node);
	}

	public List<FieldReference> cloneFieldRefs() {
		return List.copyOf(fieldRefs);
	}

	@Override
	public boolean equals(Object o) {
		if (this == o) return true;
		if (o == null || getClass() != o.getClass()) return false;
		AccessPath that = (AccessPath) o;
		return getBase() == that.getBase() && Objects.equals(node, that.node)
			&& Objects.equals(getFieldRefs(), that.getFieldRefs())
			&& Objects.equals(getBaseType(), that.getBaseType());
	}

	@Override
	public int hashCode() {
		return Objects.hash(getBase(), node, getFieldRefs(), getBaseType());
	}
}
