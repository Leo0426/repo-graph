

package com.repograph.taint.sourcesink;

import com.alibaba.fastjson2.JSONObject;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.TypeName;
import com.ibm.wala.types.TypeReference;

import java.util.Collections;
import java.util.Set;

public class FieldSourceDef implements ISourceDef {
	private final String declaringClass;
	private final String fieldTypeStr;
	private final String fieldName;
	private final String belongTo;

	public static FieldSourceDef fromJSONObject(JSONObject source) {
		String declaringClass = source.getString("DeclaringClass");
		String fieldTypeStr = source.getString("FieldType");
		String fieldName = source.getString("FieldName");
		String belongTo = source.getString("BelongTo");
		return new FieldSourceDef(declaringClass, fieldTypeStr, fieldName, belongTo);
	}

	public static FieldSourceDef fromJSONObject(JSONObject source, String belongTo) {
		String declaringClass = source.getString("DeclaringClass");
		String fieldTypeStr = source.getString("FieldType");
		String fieldName = source.getString("FieldName");
		return new FieldSourceDef(declaringClass, fieldTypeStr, fieldName, belongTo);
	}

	public FieldSourceDef(String declaringClass, String fieldTypeStr, String fieldName, String belongTo) {
		this.declaringClass = declaringClass;
		this.fieldTypeStr = fieldTypeStr;
		this.fieldName = fieldName;
		this.belongTo = belongTo;
	}

	public FieldReference getFieldReference() {
		TypeReference classType = TypeReference.findOrCreate(ClassLoaderReference.Primordial,
			TypeName.string2TypeName(declaringClass));
		Atom name = Atom.findOrCreateUnicodeAtom(fieldName);
		TypeReference fieldType = TypeReference.findOrCreate(ClassLoaderReference.Primordial,
			TypeName.string2TypeName(fieldTypeStr));
		return FieldReference.findOrCreate(classType, name, fieldType);
	}

	public Set<String> getBelongTo() {
		return Collections.singleton(belongTo);
	}

	public JSONObject toJSONObject() {
		JSONObject jsonObject = new JSONObject();
		jsonObject.put("DeclaringClass", declaringClass);
		jsonObject.put("FieldType", fieldTypeStr);
		jsonObject.put("FieldName", fieldName);
		return jsonObject;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + ((declaringClass == null) ? 0 : declaringClass.hashCode());
		result = prime * result + ((fieldName == null) ? 0 : fieldName.hashCode());
		result = prime * result + ((fieldTypeStr == null) ? 0 : fieldTypeStr.hashCode());
		result = prime * result + ((belongTo == null) ? 0 : belongTo.hashCode());
		return result;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		FieldSourceDef other = (FieldSourceDef) obj;
		if (declaringClass == null) {
			if (other.declaringClass != null)
				return false;
		} else if (!declaringClass.equals(other.declaringClass))
			return false;
		if (fieldName == null) {
			if (other.fieldName != null)
				return false;
		} else if (!fieldName.equals(other.fieldName))
			return false;
		if (fieldTypeStr == null) {
			if (other.fieldTypeStr != null)
				return false;
		} else if (!fieldTypeStr.equals(other.fieldTypeStr))
			return false;
		if (belongTo == null) {
			if (other.belongTo != null)
				return false;
		} else if (!belongTo.equals(other.belongTo))
			return false;
		return true;
	}
}
