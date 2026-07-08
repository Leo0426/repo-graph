package com.repograph.taint.api.report.taint;

import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.google.common.base.MoreObjects;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.ssa.SSAInvokeInstruction;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Flows definition.
 *
 * @author leolu
 * @since 2024/1/22
 */
public class Flow {

	private final BugMateInfo source;
	private final BugMateInfo sink;
	private final List<BugMateInfo> paths;
	private final SourceDefinition sourceDefinition;
	private int hashCode = 0;
	private String currentVar;
	private String currentFileString;
	private String currentMethodString;

	public Flow(BugMateInfo source, BugMateInfo sink, List<BugMateInfo> paths, SourceDefinition sourceDefinition) {
		this.source = source;
		this.sink = sink;
		if (paths == null) {
			this.paths = new ArrayList<>();
		} else {
			this.paths = paths;
		}
		this.sourceDefinition = sourceDefinition;
	}

	public Iterator<BugMateInfo> stepIterator() {
		return paths.iterator();
	}

	public List<BugMateInfo> getStep() {
		return paths;
	}

	public SourceDefinition getSourceDefinition() {
		return sourceDefinition;
	}

	public String getMethod(BugMateInfo md) {
		String[] arr = md.getMethodSignature().split(",");
		return arr[2].replace(">", "");
	}

	public String getFile(BugMateInfo md) {
		IClass clazz = md.getMethod().getDeclaringClass();
		return clazz.getSourceFileName();
	}

	public int getSourceLineNumber() {
		BugMateInfo firstMd = paths.get(paths.size() - 2);
		if (source.getMethodSignature().equals("synthetic < Primordial, Ljava/lang/System, initializeSystemClass()V >")
			&& ((SSAInvokeInstruction) (source.getBb().getDelegate().getInstruction()))
			.getCallSite().getDeclaredTarget().toString()
			.equals("< Primordial, Ljava/io/FileInputStream, <init>()V >")
			&& firstMd.getSsaInstruction().toString().contains(
			"putstatic < Primordial, Ljava/lang/System, in, <Primordial,Ljava/io/InputStream> >")) {
			BugMateInfo secndoMd = paths.get(paths.size() - 3);
			return secndoMd.getLineNumber();
		} else {
			return source.getLineNumber();
		}
	}

	private String getFilePath(BugMateInfo md) {
		StringBuilder str = new StringBuilder("/");
		IClass clazz = md.getMethod().getDeclaringClass();
		String[] arr = md.getMethodSignature().split(",");
		String strPrefix = arr[1].substring(2);
		String[] strPrefixArray = strPrefix.split("/");
		for (int i = 0; i < strPrefixArray.length - 1; i++) {
			str.append(strPrefixArray[i]).append("/");
		}
		str.append(clazz.getSourceFileName());
		return str.toString();
	}

	public BugMateInfo getFrom() {
		return source;
	}

	public BugMateInfo getTo() {
		return sink;
	}

	@Override
	public int hashCode() {
		if (hashCode != 0)
			return hashCode;
		final int prime = 31;
		int result = 1;
		result = prime * result + ((paths.isEmpty()) ? 0 : paths.hashCode());
		result = prime * result + ((sink == null) ? 0 : sink.hashCode());
		result = prime * result + ((source == null) ? 0 : source.hashCode());
		hashCode = result;
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
		Flow other = (Flow) obj;
		if (paths.isEmpty()) {
			if (!other.paths.isEmpty())
				return false;
		} else if (!paths.equals(other.paths))
			return false;
		if (sink == null) {
			if (other.sink != null)
				return false;
		} else if (!sink.equals(other.sink))
			return false;
		if (source == null) {
			return other.source == null;
		} else return source.equals(other.source);
	}

	@Override
	public String toString() {
		return MoreObjects.toStringHelper(this)
			.add("hashCode", hashCode)
			.add("source", source)
			.add("sink", sink)
			.add("paths", paths)
			.add("currentVar", currentVar)
			.add("currentFileString", currentFileString)
			.add("currentMethodString", currentMethodString)
			.add("sourceDefinition", sourceDefinition)
			.toString();
	}
}
