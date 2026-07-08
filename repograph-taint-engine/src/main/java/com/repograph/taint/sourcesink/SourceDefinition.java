
package com.repograph.taint.sourcesink;

import com.alibaba.fastjson2.JSONObject;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.Descriptor;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.types.TypeName;
import com.ibm.wala.types.TypeReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class SourceDefinition implements ISourceDef {
	// CHECKSTYLE:OFF
	private static final Logger logger = LoggerFactory.getLogger(SourceDefinition.class);
	private final String declaringClass;
	private final String returnType;
	private final String methodName;
	private final String paraStr;
	private final int paraIdx;
	private final String belongTo;
	public final String bugLevel;

	public static SourceDefinition fromJSONObject(JSONObject source) {
		String declaringClass = source.getString("DeclaringClass");
		String returnType = source.getString("ReturnType");
		String methodName = source.getString("MethodName");
		String argTypes = source.getString("ArgTypes");
		int paraIdx = !source.containsKey("ParameterIndex") ? -1 : source.getIntValue("ParameterIndex");
		String belongTo = source.getString("BelongTo");
		String bugLevel = "HIGH";
		if (source.containsKey("BugLevel")) {
			bugLevel = source.getString("BugLevel");
		}
		return new SourceDefinition(declaringClass, returnType, methodName, argTypes, paraIdx, belongTo, bugLevel);
	}

	public static SourceDefinition fromJSONObject(JSONObject source, String belongTo) {
		String declaringClass = source.getString("DeclaringClass");
		String returnType = source.getString("ReturnType");
		String methodName = source.getString("MethodName");
		String argTypes = source.getString("ArgTypes");
		String bugLevel = source.getString("BugLevel");
		int paraIdx = source.containsKey("paraIdx") ? -1 : source.getIntValue("paraIdx");
		return new SourceDefinition(declaringClass, returnType, methodName, argTypes, paraIdx, belongTo, bugLevel);
	}

	public SourceDefinition(String declaringClass, String returnType, String methodName, String paraStr, int paraIdx,
							String belongTo) {
		this(declaringClass, returnType, methodName, paraStr, paraIdx, belongTo, "null");
	}

	public SourceDefinition(String declaringClass, String returnType, String methodName, String paraStr, int paraIdx,
							String belongTo, String bugLevel) {
		this.declaringClass = declaringClass;
		this.returnType = returnType;
		this.methodName = methodName;
		this.paraStr = paraStr;
		this.paraIdx = paraIdx;
		this.belongTo = belongTo;
		this.bugLevel = bugLevel;
	}

	public MethodReference getMethodReference() {
		TypeReference classType = TypeReference.findOrCreate(ClassLoaderReference.Primordial,
			TypeName.string2TypeName(declaringClass));
		Atom name = Atom.findOrCreateUnicodeAtom(methodName);
		TypeName[] paraTypes;
		if (paraStr.equals(""))
			paraTypes = null;
		else {
			String argTypes[] = paraStr.split(",");
			paraTypes = new TypeName[argTypes.length];
			for (int i = 0; i < argTypes.length; i++) {
				paraTypes[i] = TypeName.string2TypeName(argTypes[i]);
			}
		}
		Descriptor descriptor = Descriptor.findOrCreate(paraTypes, TypeName.string2TypeName(returnType));
		return MethodReference.findOrCreate(classType, name, descriptor);
	}

	public Set<String> getBelongTo() {

		String[] split = belongTo.split(",");
		List<String> passes = new ArrayList<>();
		Collections.addAll(passes, split);
		return new HashSet<>(passes);
	}

	public JSONObject toJSONObject() {
		JSONObject jsonObject = new JSONObject();
		jsonObject.put("DeclaringClass", declaringClass);
		jsonObject.put("ReturnType", returnType);
		jsonObject.put("MethodName", methodName);
		jsonObject.put("ArgTypes", paraStr);
		jsonObject.put("BelongTo", belongTo);
		jsonObject.put("BugLevel", bugLevel);
		return jsonObject;
	}

	public int getParaIdx() {
		return paraIdx;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + ((declaringClass == null) ? 0 : declaringClass.hashCode());
		result = prime * result + ((methodName == null) ? 0 : methodName.hashCode());
		result = prime * result + paraIdx;
		result = prime * result + ((paraStr == null) ? 0 : paraStr.hashCode());
		result = prime * result + ((returnType == null) ? 0 : returnType.hashCode());
		result = prime * result + ((belongTo == null) ? 0 : belongTo.hashCode());
		result = prime * result + ((bugLevel == null) ? 0 : bugLevel.hashCode());
		return result;
	}

	public String getBugLevel() {
		return bugLevel;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		SourceDefinition other = (SourceDefinition) obj;
		if (declaringClass == null) {
			if (other.declaringClass != null)
				return false;
		} else if (!declaringClass.equals(other.declaringClass))
			return false;
		if (methodName == null) {
			if (other.methodName != null)
				return false;
		} else if (!methodName.equals(other.methodName))
			return false;
		if (paraIdx != other.paraIdx)
			return false;
		if (paraStr == null) {
			if (other.paraStr != null)
				return false;
		} else if (!paraStr.equals(other.paraStr))
			return false;
		if (returnType == null) {
			if (other.returnType != null)
				return false;
		} else if (!returnType.equals(other.returnType))
			return false;
		if (belongTo == null) {
			if (other.belongTo != null)
				return false;
		} else if (!belongTo.equals(other.belongTo))
			return false;
		if (bugLevel == null) {
			if (other.bugLevel != null)
				return false;
		} else if (!bugLevel.equals(other.bugLevel))
			return false;
		return true;
	}
}
