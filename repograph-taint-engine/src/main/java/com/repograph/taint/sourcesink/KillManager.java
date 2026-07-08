package com.repograph.taint.sourcesink;

import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IField;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.classLoader.ShrikeCTMethod;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.types.annotations.Annotation;
import com.ibm.wala.util.collections.HashSetMultiMap;
import com.ibm.wala.util.collections.MultiMap;

import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

public class KillManager {

	public static String PATTERN = "Ljavax/validation/constraints/Pattern";

	private final CallGraph cg;

	private MultiMap<String, KillFieldDefinition> killedField = new HashSetMultiMap<>();
	private MultiMap<String, KillParameterDefinition> killedParam = new HashSetMultiMap<>();
	private Set<String> killedReturnValue = new HashSet<String>();
	private Set<MethodReference> invokeKills = new HashSet<>();

	public KillManager(CallGraph cg, Set<IKillDefinition> kills) {
		this.cg = cg;
		initkilledField();
		initKillParameter();
		if (kills != null) {
			for (IKillDefinition kill : kills) {
				invokeKills.add(kill.getMethodReference());
			}
		}
	}

	public Set<MethodReference> getInvokeKills() {
		return invokeKills;
	}

	public MultiMap<String, KillParameterDefinition> getKilledParam() {
		return killedParam;
	}

	public void initkilledField() {
		cg.iterator().forEachRemaining(cgNode -> {
			IClass clazz = cgNode.getMethod().getDeclaringClass();

			for (IField field : clazz.getAllFields()) {
				Collection<Annotation> annotations = field.getAnnotations();
				if (annotations == null)
					continue;
				for (Annotation anno : annotations) {
					if (anno.getType().getName().toString().equals(PATTERN)) {
						String declaringClass = clazz.getName().toString();
						String fieldName = field.getName().toString();
						String fieldType = field.getFieldTypeReference().getName().toString();
						boolean put = true;
						if (killedField.containsKey(declaringClass))
							for (KillFieldDefinition obj : killedField.get(declaringClass))
								if (fieldName.equals(obj.getFieldName()) && fieldType.equals(obj.getFieldType())) {
									put = false;
									break;
								}
						if (put)
							killedField.put(declaringClass,
								new KillFieldDefinition(declaringClass, fieldName, fieldType));

						break;
					}
				}
			}
		});

	}

	public void initKillParameter() {
		cg.iterator().forEachRemaining(cgNode -> {
			IMethod method = cgNode.getMethod();
			try {
				// method annotations
				Collection<Annotation> allAnnotations = ((ShrikeCTMethod) method).getAnnotations();
				for (Annotation anno : allAnnotations) {
					if (anno.getType().getName().toString().equals(PATTERN)) {
						if (!killedReturnValue.contains(method.getSignature().toString()))
							killedReturnValue.add(method.getSignature().toString());
						break;
					}

				}

				// parameter annotations
				Collection<Annotation>[] annotationsArray = ((ShrikeCTMethod) method).getParameterAnnotations();
				for (int i = 0; i < annotationsArray.length; i++) {
					Collection<Annotation> annotations = annotationsArray[i];
					for (Annotation anno : annotations) {
						if (anno.getType().getName().toString().equals(PATTERN)) {
							String methodName = method.getSignature().toString();
							int position = i;
							boolean put = true;
							if (killedParam.containsKey(methodName))
								for (KillParameterDefinition obj : killedParam.get(methodName))
									if (position == obj.getPosition()) {
										put = false;
										break;
									}
							if (put)
								killedParam.put(methodName, new KillParameterDefinition(methodName, position));

							break;
						}
					}
				}
			} catch (Exception e) {
			}
		});

	}

	public boolean needKillReturnValue(String checkObj) {
		if (killedReturnValue.contains(checkObj))
			return true;
		return false;
	}

	public boolean needKillField(KillFieldDefinition checkObj) {
		if (killedField.containsKey(checkObj.getDeclaringClass())) {
			for (KillFieldDefinition killobj : killedField.get(checkObj.getDeclaringClass()))
				if (checkObj.getFieldName().equals(killobj.getFieldName())
					&& checkObj.getFieldType().equals(killobj.getFieldType()))
					return true;
		}
		return false;
	}

	public boolean needKillParam(KillParameterDefinition checkObj) {
		if (killedParam.containsKey(checkObj.getMethodName())) {
			for (KillParameterDefinition killobj : killedParam.get(checkObj.getMethodName()))
				if (checkObj.getPosition() == killobj.getPosition())
					return true;
		}
		return false;
	}
}
