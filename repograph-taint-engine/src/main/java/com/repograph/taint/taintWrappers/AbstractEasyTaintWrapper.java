package com.repograph.taint.taintWrappers;

import com.repograph.taint.sourcesink.IKillDefinition;
import com.repograph.taint.sourcesink.KillDefinition;
import com.ibm.wala.types.MethodReference;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static com.repograph.taint.extutil.DFAUtils.buildMethodReference;
import static com.repograph.taint.extutil.DFAUtils.formatFromSootToWala;

public abstract class AbstractEasyTaintWrapper {
	private final Set<String> classSet = new HashSet<>();
	private final Set<String> excludeSet = new HashSet<>();
	private final Set<String> killSet = new HashSet<>();
	private final Set<String> includeSet = new HashSet<>();

	public AbstractEasyTaintWrapper(String f) throws IOException {
		this(new File(f));
	}

	public AbstractEasyTaintWrapper(File f) throws IOException {
		BufferedReader reader = null;
		try {
			FileReader freader = new FileReader(f);
			reader = new BufferedReader(freader);
			String line = reader.readLine();
			List<String> methodList = new LinkedList<>();
			List<String> excludeList = new LinkedList<>();
			List<String> killList = new LinkedList<>();
			while (line != null) {
				if (!line.isEmpty() && !line.startsWith("%"))
					if (line.startsWith("~"))
						excludeList.add(line.substring(1));
					else if (line.startsWith("-"))
						killList.add(line.substring(1));
					else if (line.startsWith("^"))
						includeSet.add(line.substring(1));
					else
						methodList.add(line);
				line = reader.readLine();
			}
			internalParse(methodList, SetType.ClassSet);
			internalParse(excludeList, SetType.ExcludeSet);
			internalParse(killList, SetType.KillSet);
		} finally {
			if (reader != null) {
				reader.close();
			}
		}
	}

	private boolean internalParse(List<String> lines, SetType setType) {
		final String regex = "^<(.+):\\s*(.+)\\s+(.+)\\s*\\((.*)\\)>\\s*(.*?)$";
		final String regexNoRet = "^<(.+):\\s*(.+)\\s*\\((.*)\\)>\\s*(.*?)?$";

		Pattern p = Pattern.compile(regex);
		Pattern pNoRet = Pattern.compile(regexNoRet);

		for (String line : lines) {
			if (line.isEmpty() || line.startsWith("#"))
				continue;
			Matcher m = p.matcher(line);
			if (m.find()) {
				parseMethod(m, true, setType);
			} else {
				Matcher mNoRet = pNoRet.matcher(line);
				if (mNoRet.find()) {
					parseMethod(mNoRet, false, setType);
				} else {
					System.err.println("Line does not match: " + line);
					return false;
				}
			}
		}
		return true;
	}

	private void parseMethod(Matcher m, boolean hasReturnType, SetType setType) {
		assert (m.group(1) != null && m.group(2) != null && m.group(3) != null && m.group(4) != null);
		int groupIdx = 1;

		// build method reference
		// String loader = m.group(groupIdx++).trim();
		String className = m.group(groupIdx++).trim();
		String returnType = "V";
		if (hasReturnType) {
			returnType = formatFromSootToWala(m.group(groupIdx++).trim());
		}
		String methodName = m.group(groupIdx++).trim();
		String paramsStr = m.group(groupIdx++).trim();
		MethodReference mr = buildMethodReference(className, returnType, methodName, paramsStr);

		String methodSig = mr.getSignature().toString();
		if (setType == SetType.ExcludeSet) {
			excludeSet.add(methodSig);
		} else if (setType == SetType.ClassSet) {
			classSet.add(methodSig);
		} else if (setType == SetType.KillSet) {
			killSet.add(methodSig);
		} else if (setType == SetType.IncludeSet) {
			includeSet.add(methodSig);
		}
	}

	protected boolean isSupported(MethodReference mr) {
		String declaringClazz = mr.getDeclaringClass().getName().toString();
		String sootifyNameStr = declaringClazz.substring(1).replaceAll("/", ".");
		for (String supportedPackage : this.includeSet) {
			if (sootifyNameStr.startsWith(supportedPackage)) {
				return true;
			}
		}
		return false;
	}

	protected MethodWrapType getMethodWrapType(MethodReference mr) {
		String methodName = mr.getName().toString();
		String methodDesc = mr.getDescriptor().toString();
		String methodSig = mr.getSignature().toString();

		if ((methodName.equals("equals") && methodDesc.equals("(Ljava.lang.Object;)B"))
			|| (methodName.equals("hashCode") && methodDesc.equals("()I"))) {
			return MethodWrapType.CreateTaint;
		}

		if (isSupported(mr)) {
			if (classSet.contains(methodSig)) {
				return MethodWrapType.CreateTaint;
			} else if (excludeSet.contains(methodSig)) {
				return MethodWrapType.Exclude;
			} else if (killSet.contains(methodSig)) {
				return MethodWrapType.KillTaint;
			}
		}
		return MethodWrapType.NotRegistered;
	}

	public void addKillSet(Set<IKillDefinition> killDefinitions) {
		for (IKillDefinition ikill : killDefinitions) {
			if (ikill instanceof KillDefinition) {
				KillDefinition kill = (KillDefinition) ikill;
				String sig = kill.getMethodReference().getSignature();
				killSet.add(sig);
			}
		}
	}

	protected enum SetType {
		ClassSet, ExcludeSet, KillSet, IncludeSet
	}

	/**
	 * The possible effects this taint wrapper can have on a method invocation
	 */
	protected enum MethodWrapType {
		/**
		 * This method can create a new taint
		 */
		CreateTaint,
		/**
		 * This method can kill a taint
		 */
		KillTaint,
		/**
		 * This method has been explicitly excluded from taint wrapping, i.e., it
		 * neither creates nor kills taints even if the same method in the parent class
		 * or an interfaces does.
		 */
		Exclude,
		/**
		 * This method has not been named in the taint wrapper configuration
		 */
		NotRegistered
	}
}
