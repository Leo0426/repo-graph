package com.repograph.taint.report.util;

import com.repograph.taint.api.report.BugMateInfo;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.ssa.SSAFieldAccessInstruction;
import com.ibm.wala.ssa.SSAGetInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAPutInstruction;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.Selector;
import com.ibm.wala.types.TypeName;

import static com.repograph.taint.report.source.ClassNameSourceLine.getClassNameLineFormSourceJava;
import static com.repograph.taint.report.source.FieldSourceLine.getFieldLineFormSourceJava;
import static com.repograph.taint.extutil.FileUtils.getFilePath;
import static com.google.common.base.Strings.isNullOrEmpty;
import static java.util.Objects.isNull;

/**
 * @author leolu
 * @since 2022/6/1
 */
public class ExporterFilter {

	/**
	 * filter metadata
	 *
	 * @param md meta
	 * @return ExportMetaDataInfo
	 */
	public static BugMateInfo analysisExportMetaInfo(BugMateInfo md) {
		if (isNull(md)) {
			return BugMateInfo.builder().build();
		}

		String filePath = md.getFilePath();
		IMethod method = md.getMethod();
		String filePathName = beforeAssemblerName(method, method.getDeclaringClass().getSourceFileName());
		if (filePathName.isEmpty()) {
			filePathName = filePath.substring(filePath.lastIndexOf("/") + 1);
		}

		String methodName = filterMethodName(md.getMethod().getName().toString());
		SSAInstruction ssaInstruction = md.getSsaInstruction();

		int lineNumber = md.getLineNumber();
		if (lineNumber == -1 || lineNumber == 0) {
			lineNumber = tryFindLineFromSourceFile(md, ssaInstruction);
		}

		return BugMateInfo.builder()
			.withFileName(filePathName)
			.withSsaInstruction(ssaInstruction)
			.withLineNumber(lineNumber)
			.withMethodName(methodName)
			.withVariable(md.getVariable())
			.withFieldName(md.getFieldName())
			.withAttributes(md.getAttributes())
			.build();
	}

	private static String beforeAssemblerName(IMethod method, String sourceFileName) {
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

	private static String filterMethodName(String methodName) {
		if (methodName.equals("<clinit>") || methodName.equals("<init>")) {
			methodName = "Constructor";
		}
		if (methodName.contains("lambda$")) {
			methodName = "Anonymous function : ".concat(methodName.replace("lambda$", ""));
		}
		return methodName;
	}

	public static int tryFindLineFromSourceFile(BugMateInfo md, SSAInstruction ssaInstruction) {
		int lineNumber;
		IClass clazz = md.getMethod().getDeclaringClass();
		IMethod classInitializer = clazz.getMethod(Selector.make("<clinit>()V"));
		if (isNull(classInitializer)) {
			return 0;
		}
		String clazzName = clazz.getSourceFileName().replace(".java", "");
		String sourceFilePath = getFilePath(classInitializer);
		if (ssaInstruction instanceof SSAPutInstruction || ssaInstruction instanceof SSAGetInstruction) {
			FieldReference declaredField = ((SSAFieldAccessInstruction) ssaInstruction).getDeclaredField();
			String fieldName = declaredField.getName().toString();
			lineNumber = getFieldLineFormSourceJava(sourceFilePath, fieldName);
		} else {
			lineNumber = getClassNameLineFormSourceJava(sourceFilePath, clazzName);
		}
		return lineNumber;
	}
}
