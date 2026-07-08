package com.repograph.taint.support.framework.spring.util;

import com.repograph.taint.support.framework.constant.Annotations;
import com.repograph.taint.support.framework.spring.annotations.Component;
import com.repograph.taint.support.framework.spring.annotations.Configuration;
import com.repograph.taint.support.framework.spring.annotations.Controller;
import com.repograph.taint.support.framework.spring.annotations.CookieValue;
import com.repograph.taint.support.framework.spring.annotations.DeleteMapping;
import com.repograph.taint.support.framework.spring.annotations.GetMapping;
import com.repograph.taint.support.framework.spring.annotations.IAnnotation;
import com.repograph.taint.support.framework.spring.annotations.ModelAttribute;
import com.repograph.taint.support.framework.spring.annotations.PatchMapping;
import com.repograph.taint.support.framework.spring.annotations.PathVariable;
import com.repograph.taint.support.framework.spring.annotations.PostMapping;
import com.repograph.taint.support.framework.spring.annotations.PutMapping;
import com.repograph.taint.support.framework.spring.annotations.Repository;
import com.repograph.taint.support.framework.spring.annotations.RequestBody;
import com.repograph.taint.support.framework.spring.annotations.RequestHeader;
import com.repograph.taint.support.framework.spring.annotations.RequestMapping;
import com.repograph.taint.support.framework.spring.annotations.RequestParam;
import com.repograph.taint.support.framework.spring.annotations.RestController;
import com.repograph.taint.support.framework.spring.annotations.Service;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ElementValue;
import com.ibm.wala.types.annotations.Annotation;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class Utils {
	public static boolean isClassInPlatform(String className) {
		if (className.contains("/"))
			className = className.substring(1).replaceAll("/", ".");
		return className.startsWith("org.springframework");
	}

	public static boolean hasControllerAnno(IClass clazz) {
		for (Annotation anno : clazz.getAnnotations()) {
			IAnnotation annotation = reBuildAnno(anno);
			if ((annotation instanceof Controller || annotation instanceof RestController)) {
				return true;
			}
		}
		return false;
	}

	public static Annotation getComponentAnno(IClass clazz) {
		for (Annotation anno : clazz.getAnnotations()) {
			IAnnotation annotation = reBuildAnno(anno);
			if ((annotation instanceof Controller || annotation instanceof RestController
				|| annotation instanceof Service || annotation instanceof Repository
				|| annotation instanceof Component || annotation instanceof Configuration)) {
				return anno;
			}
		}
		return null;
	}

	public static Set<String> AnnoSets(IClass clazz) {
		Set<String> annoSet = new HashSet<String>();
		for (Annotation anno : clazz.getAnnotations()) {
			annoSet.add(anno.getType().getName().toString());
		}
		return annoSet;
	}

	public static boolean hasRequestMappingAnno(IMethod method) {
		for (Annotation anno : method.getAnnotations()) {
			IAnnotation annotation = reBuildAnno(anno);
			if ((annotation instanceof RequestMapping || annotation instanceof GetMapping
				|| annotation instanceof PostMapping || annotation instanceof PutMapping
				|| annotation instanceof DeleteMapping || annotation instanceof PatchMapping)) {
				return true;
			}
		}
		return false;
	}

	public static boolean hasTestAnno(IMethod method) {
		for (Annotation anno : method.getAnnotations()) {
			if (anno.getType().getName().toString().equals("Lorg/junit/Test")) {
				return true;
			}
		}
		return false;
	}

	public static Annotation hasBeanAnno(IMethod method) {
		for (Annotation anno : method.getAnnotations()) {
			if (anno.getType().getName().toString().equals("Lorg/springframework/context/annotation/Bean")) {
				return anno;
			}
		}
		return null;
	}

	public static IAnnotation reBuildAnno(Annotation anno) {
		if (anno.getType().getName().toString().equals(Annotations.CONTROLLER)) {
			return new Controller(anno.getNamedArguments().get("value"));
		} else if (anno.getType().getName().toString().equals(Annotations.RESTCONTROLLER)) {
			return new Controller(anno.getNamedArguments().get("value"));
		} else if (anno.getType().getName().toString().equals(Annotations.COOKIEVALUE)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new CookieValue(namedArg.get("value"), namedArg.get("name"), namedArg.get("required"),
				namedArg.get("defaultValue"));
		} else if (anno.getType().getName().toString().equals(Annotations.MODELATTRIBUTE)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new ModelAttribute(namedArg.get("value"));
		} else if (anno.getType().getName().toString().equals(Annotations.PATHVARIABLE)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new PathVariable(namedArg.get("value"));
		} else if (anno.getType().getName().toString().equals(Annotations.REQUESTBODY)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new RequestBody(namedArg.get("required"));
		} else if (anno.getType().getName().toString().equals(Annotations.REQUESTHEADER)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new RequestHeader(namedArg.get("value"), namedArg.get("name"), namedArg.get("required"),
				namedArg.get("defaultValue"));
		} else if (anno.getType().getName().toString().equals(Annotations.REQUESTMAPPING)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new RequestMapping(namedArg.get("name"), namedArg.get("value"), namedArg.get("path"),
				namedArg.get("method"), namedArg.get("params"), namedArg.get("headers"), namedArg.get("consumes"),
				namedArg.get("produces"));
		} else if (anno.getType().getName().toString().equals(Annotations.GETMAPPING)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new GetMapping(namedArg.get("name"), namedArg.get("value"), namedArg.get("path"),
				namedArg.get("params"), namedArg.get("headers"), namedArg.get("consumes"),
				namedArg.get("produces"));
		} else if (anno.getType().getName().toString().equals(Annotations.POSTMAPPING)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new PostMapping(namedArg.get("name"), namedArg.get("value"), namedArg.get("path"),
				namedArg.get("params"), namedArg.get("headers"), namedArg.get("consumes"),
				namedArg.get("produces"));
		} else if (anno.getType().getName().toString().equals(Annotations.PUTMAPPING)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new PutMapping(namedArg.get("name"), namedArg.get("value"), namedArg.get("path"),
				namedArg.get("params"), namedArg.get("headers"), namedArg.get("consumes"),
				namedArg.get("produces"));
		} else if (anno.getType().getName().toString().equals(Annotations.DELETEMAPPING)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new DeleteMapping(namedArg.get("name"), namedArg.get("value"), namedArg.get("path"),
				namedArg.get("params"), namedArg.get("headers"), namedArg.get("consumes"),
				namedArg.get("produces"));
		} else if (anno.getType().getName().toString().equals(Annotations.PATCHMAPPING)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new PatchMapping(namedArg.get("name"), namedArg.get("value"), namedArg.get("path"),
				namedArg.get("params"), namedArg.get("headers"), namedArg.get("consumes"),
				namedArg.get("produces"));
		} else if (anno.getType().getName().toString().equals(Annotations.REQUESTPARA)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new RequestParam(namedArg.get("value"), namedArg.get("name"), namedArg.get("required"),
				namedArg.get("defaultValue"));
		} else if (anno.getType().getName().toString().equals(Annotations.SERVICE)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new Service(namedArg.get("value"));
		} else if (anno.getType().getName().toString().equals(Annotations.REPOSITORY)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new Repository(namedArg.get("value"));
		} else if (anno.getType().getName().toString().equals(Annotations.COMPONENT)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new Component(namedArg.get("value"));
		} else if (anno.getType().getName().toString().equals(Annotations.CONFIGURATION)) {
			Map<String, ElementValue> namedArg = anno.getNamedArguments();
			return new Configuration(namedArg.get("value"));
		}
		return null;
	}
}
