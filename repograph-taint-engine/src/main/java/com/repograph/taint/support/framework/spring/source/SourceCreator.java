package com.repograph.taint.support.framework.spring.source;

import com.repograph.taint.support.framework.spring.util.Utils;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.classLoader.ShrikeCTMethod;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

import java.util.ArrayList;

public class SourceCreator {

	public static ArrayList<Integer> getSourcePara(BasicBlockInContext<IExplodedBasicBlock> callsite,
												   BasicBlockInContext<IExplodedBasicBlock> callee) {
		ArrayList<Integer> result = new ArrayList<>();
		IMethod method = callee.getMethod();
		// if this class is not controller, then pass
		if (!Utils.hasControllerAnno(method.getDeclaringClass()))
			return null;
		if (!Utils.hasRequestMappingAnno(method))
			return null;

		assert method instanceof ShrikeCTMethod;
		for (int i = 0; i < method.getNumberOfParameters(); i++) {
			if (method.isStatic() || i != 0) {
				String paraType = method.getParameterType(i).getName().toString();
				if (!paraType.equals("Ljavax/servlet/http/HttpServletRequest") && !paraType.equals("Ljavax/servlet/http/HttpServletResponse")) {
					result.add(i + 1);
				}
			}
		}
		return result;
	}
}
