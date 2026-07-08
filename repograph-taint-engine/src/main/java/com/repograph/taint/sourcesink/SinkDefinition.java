
package com.repograph.taint.sourcesink;

import com.alibaba.fastjson2.JSONObject;
import com.repograph.taint.sourcesink.type.AnySource2AnyArg;
import com.repograph.taint.sourcesink.type.AnySource2CombArgs;
import com.repograph.taint.sourcesink.type.AnySource2SpecialArg;
import com.repograph.taint.sourcesink.type.SpecialSource2AnyArg;
import com.repograph.taint.sourcesink.type.SpecialSource2CombArgs;
import com.repograph.taint.sourcesink.type.SpecialSource2SpecialArg;
import com.repograph.taint.sourcesink.type.TaintedType;
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

public class SinkDefinition implements ISinkDefinition {

	private static final Logger logger = LoggerFactory.getLogger(SinkDefinition.class);
	private final String declaringClass;
	private final String returnType;
	private final String methodName;
	private final String paraStr;
	private final String belongTo;
	private List<TaintedType> taintedTypes = new ArrayList<TaintedType>();

	public static SinkDefinition fromJSONObject(JSONObject sink) {
		String declaringClass = sink.getString("DeclaringClass");
		String returnType = sink.getString("ReturnType");
		String methodName = sink.getString("MethodName");
		String argTypes = sink.getString("ArgTypes");
		String belongTo = sink.getString("BelongTo");
		return new SinkDefinition(declaringClass, returnType, methodName, argTypes, belongTo);
	}

	public static SinkDefinition fromJSONObject(JSONObject sink, String belongTo) {
		String declaringClass = sink.getString("DeclaringClass");
		String returnType = sink.getString("ReturnType");
		String methodName = sink.getString("MethodName");
		String argTypes = sink.getString("ArgTypes");
		return new SinkDefinition(declaringClass, returnType, methodName, argTypes, belongTo);
	}

	public SinkDefinition(String declaringClass, String returnType, String methodName, String paraStr,
						  String belongTo) {
		this.declaringClass = declaringClass;
		this.returnType = returnType;
		this.methodName = methodName;
		this.paraStr = paraStr;
		this.belongTo = belongTo;
	}

	public SinkDefinition(MethodReference mr, String belongTo) {
		this.declaringClass = mr.getDeclaringClass().getName().toString();
		this.returnType = mr.getReturnType().getName().toString();
		this.methodName = mr.getName().toString();
		String tmpString = "";
		for (int i = 0; i < mr.getNumberOfParameters(); i++) {
			tmpString = tmpString + mr.getParameterType(i) + ",";
		}
		if (tmpString.length() > 0)
			tmpString = tmpString.substring(0, tmpString.length() - 1);
		this.paraStr = tmpString;
		taintedTypes.add(new AnySource2AnyArg());
		this.belongTo = belongTo;
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

	public void addTaintedTypes(List<TaintedType> taintedTypes) {
		this.taintedTypes.addAll(taintedTypes);
	}

	public void addTaintedType(TaintedType taintedType) {
		this.taintedTypes.add(taintedType);
	}

	public JSONObject toJSONObject() {
		JSONObject jsonObject = new JSONObject();
		jsonObject.put("DeclaringClass", declaringClass);
		jsonObject.put("ReturnType", returnType);
		jsonObject.put("MethodName", methodName);
		jsonObject.put("ArgTypes", paraStr);
		jsonObject.put("BelongTo", belongTo);
		taintedTypes.forEach(taintedType -> {
			if (taintedType instanceof AnySource2AnyArg)
				jsonObject.put("AnySource2AnyArg", taintedType.toJSONObject());
			else if (taintedType instanceof AnySource2SpecialArg)
				jsonObject.put("AnySource2SpecialArg", taintedType.toJSONObject());
			else if (taintedType instanceof AnySource2CombArgs)
				jsonObject.put("AnySource2CombArgs", taintedType.toJSONObject());
			else if (taintedType instanceof SpecialSource2AnyArg)
				jsonObject.put("SpecialSource2AnyArg", taintedType.toJSONObject());
			else if (taintedType instanceof SpecialSource2SpecialArg)
				jsonObject.put("SpecialSource2SpecialArg", taintedType.toJSONObject());
			else if (taintedType instanceof SpecialSource2CombArgs)
				jsonObject.put("SpecialSource2CombArgs", taintedType.toJSONObject());
		});
		return jsonObject;
	}

	public Set<String> getBelongTo() {
		String[] split = belongTo.split(",");
		List<String> passes = new ArrayList<>();
		Collections.addAll(passes, split);
		return new HashSet<>(passes);
	}

	public List<TaintedType> getTaintedTypes() {
		return taintedTypes;
	}

	@Override
	public String toString() {
		return "SinkDefinition [declaringClass=" + declaringClass + ", returnType=" + returnType + ", methodName="
			+ methodName + ", paraStr=" + paraStr + ", taintedTypes=" + taintedTypes + "]";
	}
}
