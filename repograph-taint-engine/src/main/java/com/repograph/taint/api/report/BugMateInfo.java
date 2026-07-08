package com.repograph.taint.api.report;

import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.TypeName;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import static com.google.common.base.Strings.isNullOrEmpty;
import static java.util.Objects.nonNull;

/**
 * metadata
 *
 * @author leolu
 * @since 2023/11/2
 */
public class BugMateInfo {

	private BasicBlockInContext<IExplodedBasicBlock> bb;
	private int lineNumber;
	private IMethod method;
	private String fileName;
	private String variable;
	private String fieldName;
	private String methodName;
	private CGNode cgNode;
	private SSAInstruction ssaInstruction;
	private String signature;
	private String abstractFilePath;
	private List<String> attributes;

	public static String beforeAssemblerName(IMethod method, String sourceFileName) {
		if (isNullOrEmpty(sourceFileName)) {
			TypeName name = method.getDeclaringClass().getName();
			Atom className = name.getClassName();
			if (className.toString().contains("$")) {
				String[] strings = className.toString().split("\\$");
				String[] sourceName = strings[0].split("/");
				sourceFileName = sourceName[sourceName.length - 1];
			} else {
				sourceFileName = className.toString();
			}
			sourceFileName = sourceFileName.concat(".java");
		}
		return sourceFileName;
	}

	public static Builder builder() {
		return new Builder();
	}

	public String getMethodName() {
		return methodName;
	}

	public void setMethodName(String methodName) {
		this.methodName = methodName;
	}

	public String extractFilePath() {
		String[] splits = method.toString().split(",");
		return splits[1].substring(1) + ".java";
	}

	public String getFilePath() {
		StringBuilder str = new StringBuilder("/");
		IClass clazz = this.getMethod().getDeclaringClass();
		String[] arr = this.getMethod().toString().split(",");
		String strPrefix = arr[1].substring(2);
		String[] strPrefixArray = strPrefix.split("/");
		for (int i = 0; i < strPrefixArray.length - 1; i++) {
			str.append(strPrefixArray[i]).append("/");
		}
		str.append(beforeAssemblerName(this.getMethod(), clazz.getSourceFileName()));
		return str.toString();
	}

	public String getFileName() {
		return fileName;
	}

	public void setFileName(String fileName) {
		this.fileName = fileName;
	}

	public String getMethodSignature() {
		return method.toString();
	}

	public BasicBlockInContext<IExplodedBasicBlock> getBb() {
		return bb;
	}

	public void setBb(BasicBlockInContext<IExplodedBasicBlock> bb) {
		this.bb = bb;
	}

	public int getLineNumber() {
		return lineNumber;
	}

	public void setLineNumber(int lineNumber) {
		this.lineNumber = lineNumber;
	}

	public IMethod getMethod() {
		return method;
	}

	public void setMethod(IMethod method) {
		this.method = method;
	}

	public String getVariable() {
		return variable;
	}

	public void setVariable(String variable) {
		this.variable = variable;
	}

	public String getFieldName() {
		return fieldName;
	}

	public void setFieldName(String fieldName) {
		this.fieldName = fieldName;
	}

	public CGNode getCgNode() {
		return cgNode;
	}

	public void setCgNode(CGNode cgNode) {
		this.cgNode = cgNode;
	}

	public SSAInstruction getSsaInstruction() {
		return ssaInstruction;
	}

	public void setSsaInstruction(SSAInstruction ssaInstruction) {
		this.ssaInstruction = ssaInstruction;
	}

	public String getAbstractFilePath() {
		return abstractFilePath;
	}

	public void setAbstractFilePath(String abstractFilePath) {
		this.abstractFilePath = abstractFilePath;
	}

	public List<String> getAttributes() {
		return attributes;
	}

	public void setAttributes(List<String> attributes) {
		this.attributes = attributes;
	}

	public String getSignature() {
		return signature;
	}

	public void setSignature(String signature) {
		this.signature = signature;
	}

	public Builder toBuilder() {
		return builder().withBb(bb)
			.withLineNumber(lineNumber)
			.withMethod(method)
			.withVariable(variable)
			.withFieldName(fieldName)
			.withCgNode(cgNode)
			.withSsaInstruction(ssaInstruction)
			.withAbstractFilePath(abstractFilePath)
			.withAttributes(attributes)
			.withSignature(signature);
	}


	public static final class Builder {
		private BasicBlockInContext<IExplodedBasicBlock> bb;
		private int lineNumber;
		private IMethod method;
		private String fileName;
		private String variable;
		private String fieldName;
		private String methodName;
		private CGNode cgNode;
		private SSAInstruction ssaInstruction;
		private String signature;
		private String abstractFilePath;
		private List<String> attributes;

		private Builder() {
		}

		public static Builder builder() {
			return new Builder();
		}

		public Builder withBb(BasicBlockInContext<IExplodedBasicBlock> bb) {
			this.bb = bb;
			return this;
		}

		public Builder withLineNumber(int lineNumber) {
			this.lineNumber = lineNumber;
			return this;
		}

		public Builder withMethod(IMethod method) {
			this.method = method;
			return this;
		}

		public Builder withFileName(String fileName) {
			this.fileName = fileName;
			return this;
		}

		public Builder withVariable(String variable) {
			this.variable = variable;
			return this;
		}

		public Builder withFieldName(String fieldName) {
			this.fieldName = fieldName;
			return this;
		}

		public Builder withMethodName(String methodName) {
			this.methodName = methodName;
			return this;
		}

		public Builder withCgNode(CGNode cgNode) {
			this.cgNode = cgNode;
			return this;
		}

		public Builder withSsaInstruction(SSAInstruction ssaInstruction) {
			this.ssaInstruction = ssaInstruction;
			return this;
		}

		public Builder withSignature(String signature) {
			this.signature = signature;
			return this;
		}

		public Builder withAbstractFilePath(String abstractFilePath) {
			this.abstractFilePath = abstractFilePath;
			return this;
		}

		public Builder withAttributes(List<String> attributes) {
			this.attributes = attributes;
			return this;
		}

		public BugMateInfo build() {
			BugMateInfo bugMateInfo = new BugMateInfo();
			bugMateInfo.setBb(bb);
			bugMateInfo.setLineNumber(lineNumber);
			bugMateInfo.setMethod(method);
			bugMateInfo.setFileName(fileName);
			bugMateInfo.setVariable(variable);
			bugMateInfo.setFieldName(fieldName);
			bugMateInfo.setMethodName(methodName);
			bugMateInfo.setCgNode(cgNode);
			bugMateInfo.setSsaInstruction(ssaInstruction);
			bugMateInfo.setSignature(signature);
			bugMateInfo.setAbstractFilePath(abstractFilePath);
			bugMateInfo.setAttributes(attributes);
			return bugMateInfo;

		}
	}

	public Object[] assemblerStepsArray(BugMateInfo ex) {
		List<Object> result = new ArrayList<>();
		if (nonNull(ex.getMethod())) {
			String methodName = ex.getMethod().getName().toString();
			result.add(methodName);
		}
		result.add(ex.getLineNumber());
		if (isNullOrEmpty(ex.getVariable())
			|| Objects.equals(ex.getVariable(), "null")) {
			result.add("匿名变量");
		} else {
			result.add(ex.getVariable());
		}
		return result.toArray(new Object[0]);
	}

	public Object[] assemblerArray(BugMateInfo ex) {
		List<Object> result = new ArrayList<>();
		if (!isNullOrEmpty(ex.getFileName())) {
			result.add(ex.getFileName());
		} else {
			result.add(beforeAssemblerName(ex.getMethod(), ex.getMethod().getDeclaringClass().getSourceFileName()));
		}

		result.add(ex.getLineNumber());

		if (nonNull(ex.getMethod())) {
			String methodName = ex.getMethod().getName().toString();
			result.add(methodName);
		} else {
			if (!isNullOrEmpty(ex.getMethodName())) {
				result.add(ex.getMethodName());
			}
		}

		if (isNullOrEmpty(ex.getVariable())
			|| Objects.equals(ex.getVariable(), "null")) {
			result.add("匿名变量");
		} else {
			result.add(ex.getVariable());
		}

		if (!isNullOrEmpty(ex.getFieldName())) {
			result.add(ex.getFieldName());
		}

		if (nonNull(ex.getAttributes()) && !ex.getAttributes().isEmpty()) {
			result.addAll(ex.getAttributes());
		}

		return result.toArray(new Object[0]);
	}
}
