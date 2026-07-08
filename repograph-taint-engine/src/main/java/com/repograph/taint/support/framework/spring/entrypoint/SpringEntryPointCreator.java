package com.repograph.taint.support.framework.spring.entrypoint;

import com.repograph.taint.support.framework.spring.util.Utils;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.ipa.callgraph.AnalysisScope;
import com.ibm.wala.ipa.callgraph.Entrypoint;
import com.ibm.wala.ipa.callgraph.impl.DefaultEntrypoint;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.types.ClassLoaderReference;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class SpringEntryPointCreator {
	public Set<Entrypoint> getEntryPoints(AnalysisScope scope, IClassHierarchy cha) {
		Set<Entrypoint> result = new HashSet<>();
		List<IMethod> entries = searchEntriesByController(cha);
		if (entries.isEmpty()) {
			return result;
		}
		entries.forEach(entry -> {
			Entrypoint ep = new DefaultEntrypoint(entry.getReference(), cha);
			result.add(ep);
		});
		return result;
	}

	private boolean implController(IClass clazz) {
		IClass supperClazz = clazz.getSuperclass();
		if (supperClazz != null) {
			String superClassName = supperClazz.getName().toString();
			if (superClassName.equals("Lorg/springframework/web/servlet/mvc/AbstractController")
				|| superClassName.equals("Lorg/springframework/web/servlet/mvc/AbstractUrlViewController")
				|| superClassName.equals("Lorg/springframework/web/servlet/mvc/ParameterizableViewController")
				|| superClassName.equals("Lorg/springframework/web/servlet/mvc/ServletForwardingController")
				|| superClassName.equals("Lorg/springframework/web/servlet/mvc/ServletWrappingController")) {
				return true;
			}
		}
		for (IClass implInterface : clazz.getAllImplementedInterfaces()) {
			if (implInterface.getName().toString().equals("Lorg/springframework/web/servlet/mvc/Controller"))
				return true;
		}
		return false;
	}

	private boolean isHandleRequest(IMethod method) {
		String selector = method.getSelector().toString();
		return selector.equals(
			"handleRequest(Ljavax/servlet/http/HttpServletRequest;Ljavax/servlet/http/HttpServletResponse;)Lorg/springframework/web/servlet/ModelAndView;")
			|| selector.equals(
			"handleRequestInternal(Ljavax/servlet/http/HttpServletRequest;Ljavax/servlet/http/HttpServletResponse;)Lorg/springframework/web/servlet/ModelAndView;");
	}

	private List<IMethod> searchEntriesByController(IClassHierarchy cha) {
		List<IMethod> result = new ArrayList<>();
		cha.getLoader(ClassLoaderReference.Application).iterateAllClasses().forEachRemaining(clazz -> {
			if (Utils.isClassInPlatform(clazz.getName().toString())) {
				return;
			}
			if (Utils.hasControllerAnno(clazz)) {
				clazz.getDeclaredMethods()
					.forEach(method -> {
						if (Utils.hasRequestMappingAnno(method)) {
							result.add(method);
						}
					});
			} else {
				clazz.getDeclaredMethods().forEach(method -> {
					if (isHandleRequest(method)) {
						result.add(method);
					}
					if (Utils.hasTestAnno(method)) {
						result.add(method);
					}
				});
			}
		});
		return result;
	}
}
