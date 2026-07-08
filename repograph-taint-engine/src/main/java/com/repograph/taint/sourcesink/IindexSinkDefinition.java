package com.repograph.taint.sourcesink;

import com.repograph.taint.sourcesink.type.AnySource2AnyArg;
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

public class IindexSinkDefinition implements ISinkDefinition {

	private static final Logger logger = LoggerFactory.getLogger(IindexSinkDefinition.class);
	private final String declaringClass;
	private final String methodName;
	private final String descriptor;
	private final int iindex;
	private final String belongTo;
	private final List<TaintedType> taintedTypes = new ArrayList<>();

	public IindexSinkDefinition(String declaringClass, String methodName, String descriptor, int iindex,
								String belongTo) {
		this.declaringClass = declaringClass;
		this.methodName = methodName;
		this.descriptor = descriptor;
		this.iindex = iindex;
		this.belongTo = belongTo;
		taintedTypes.add(new AnySource2AnyArg());
	}

	public IindexSinkDefinition(MethodReference mr, int iindex, String belongTo) {
		this.declaringClass = mr.getDeclaringClass().getName().toString();
		this.methodName = mr.getName().toString();
		this.descriptor = mr.getDescriptor().toString();
		this.iindex = iindex;
		this.belongTo = belongTo;
		taintedTypes.add(new AnySource2AnyArg());
	}

	public MethodReference getMethodReference() {
		TypeReference T = TypeReference.findOrCreate(ClassLoaderReference.Application,
			TypeName.string2TypeName(declaringClass));
		return MethodReference.findOrCreate(T, Atom.findOrCreateAsciiAtom(methodName),
			Descriptor.findOrCreateUTF8(descriptor));
	}

	public void addTaintedTypes(List<TaintedType> taintedTypes) {
		this.taintedTypes.addAll(taintedTypes);
	}

	public void addTaintedType(TaintedType taintedType) {
		this.taintedTypes.add(taintedType);
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

	public int getIindex() {
		return iindex;
	}

	@Override
	public String toString() {
		return "SinkDefinition [declaringClass=" + declaringClass + ", methodName="
			+ methodName + ", descriptor=" + descriptor + ", taintedTypes=" + taintedTypes + "]";
	}
}
