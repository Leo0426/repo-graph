package com.repograph.taint.sourcesink;

import com.alibaba.fastjson2.JSONObject;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.Descriptor;
import com.ibm.wala.types.FieldReference;
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

import static com.repograph.taint.sourcesink.XMLDocumentProvider.buildField;

public class KillDefinition implements IKillDefinition {
	private static final Logger logger = LoggerFactory.getLogger(KillDefinition.class);
	private final String declaringClass;
	private final String returnType;
	private final String methodName;
	private final String paraStr;
	private final int parameterIndex;
	private final List<FieldReference> fields;
	private final String belongTo;

	public KillDefinition(String declaringClass, String returnType, String methodName, String paraStr,
						  int parameterIndex, List<FieldReference> fields, String belongTo) {
		this.declaringClass = declaringClass;
		this.returnType = returnType;
		this.methodName = methodName;
		this.paraStr = paraStr;
		this.parameterIndex = parameterIndex;
		this.fields = fields;
		this.belongTo = belongTo;
	}

	public static KillDefinition fromJSONObject(JSONObject kill) {
		String declaringClass = kill.getString("DeclaringClass");
		String returnType = kill.getString("ReturnType");
		String methodName = kill.getString("MethodName");
		String argTypes = kill.getString("ArgTypes");
		String idx = kill.getString("ParameterIndex");
		if (idx.isEmpty())
			throw new RuntimeException("Parameter index not specified");
		String fieldString = kill.getString("Fields");
		String belongTo = kill.getString("BelongTo");
		return new KillDefinition(declaringClass, returnType, methodName, argTypes, Integer.parseInt(idx),
			getFields(fieldString), belongTo);
	}

	public static KillDefinition fromJSONObject(JSONObject kill, String belongTo) {
		String declaringClass = kill.getString("DeclaringClass");
		String returnType = kill.getString("ReturnType");
		String methodName = kill.getString("MethodName");
		String argTypes = kill.getString("ArgTypes");
		String idx = kill.getString("ParameterIndex");
		if (idx.isEmpty())
			throw new RuntimeException("Parameter index not specified");
		String fieldString = kill.getString("Fields");
		return new KillDefinition(declaringClass, returnType, methodName, argTypes, Integer.parseInt(idx),
			getFields(fieldString), belongTo);
	}

	private static List<FieldReference> getFields(String fieldString) {
		if (fieldString != null) {
			if (fieldString.length() > 3) {
				String[] res = fieldString.substring(1, fieldString.length() - 1).split(",");
				List<FieldReference> ret = new ArrayList<FieldReference>();
				for (String re : res) {
					String curElement = re.trim();
					ret.add(buildField(curElement));
				}
				return ret;
			}
		}
		return null;
	}

	@Override
	public MethodReference getMethodReference() {
		TypeReference classType = TypeReference.findOrCreate(ClassLoaderReference.Application,
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
		jsonObject.put("ParameterIndex", "" + parameterIndex);
		jsonObject.put("BelongTo", belongTo);
		StringBuilder fieldString = new StringBuilder();
		if (fields != null && !fields.isEmpty()) {
			fieldString = new StringBuilder("[");
			for (FieldReference field : fields) {
				fieldString.append(field.getDeclaringClass().getName().toString()).append(": ");
				fieldString.append(field.getFieldType().getName().toString()).append(" ");
				fieldString.append(field.getName().toString());
				fieldString.append(",");
			}
			fieldString = new StringBuilder(fieldString.substring(0, fieldString.length() - 1));
			fieldString.append("]");
		}
		jsonObject.put("Fields", fieldString.toString());
		return jsonObject;
	}

	public int getParameterIndex() {
		return parameterIndex;
	}

	public List<FieldReference> getFields() {
		return fields;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + ((declaringClass == null) ? 0 : declaringClass.hashCode());
		result = prime * result + ((methodName == null) ? 0 : methodName.hashCode());
		result = prime * result + ((paraStr == null) ? 0 : paraStr.hashCode());
		result = prime * result + ((returnType == null) ? 0 : returnType.hashCode());
		result = prime * result + parameterIndex;
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
		KillDefinition other = (KillDefinition) obj;
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
		return true;
	}
}
