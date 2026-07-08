package com.repograph.taint.report.source;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;

import static java.nio.charset.StandardCharsets.UTF_8;
import static java.util.Objects.isNull;

public class ClassNameSourceLine extends FieldSourceLine {

	/**
	 * if exception return 0 (default is 0)
	 * else return class name source line : class Demo{}
	 *
	 * @param filePath  java source path
	 * @param clazzName clazzName
	 * @return line num
	 */
	public static int getClassNameLineFormSourceJava(String filePath, String clazzName) {
		// first, get info from cache
		String key = assemblerClazzCacheKey(filePath, clazzName);
		int lineNumber = getSourceJavaLineFromCache(key);
		if (lineNumber != -1) {
			return lineNumber;
		}
		// find java file.
		File javaFile = getJavaFile(filePath);
		if (isNull(javaFile) || !javaFile.isFile() || !javaFile.exists()) {
			return 0;
		}
		try {
			InputStreamReader read = new InputStreamReader(new FileInputStream(javaFile), UTF_8);
			BufferedReader bufferedReader = new BufferedReader(read);
			String lineTxt;
			int lineNum = 0;
			while ((lineTxt = bufferedReader.readLine()) != null) {
				lineNum++;
				if (lineTxt.contains("class") && lineTxt.contains(clazzName)) {
					SOURCE_JAVA_LINE_CACHE.doCache(key, lineNum);
					return lineNum;
				}
			}
			bufferedReader.close();
			read.close();
		} catch (IOException e) {
			return 0;
		}
		return 0;
	}

	protected static String assemblerClazzCacheKey(String filePath, String fieldName) {
		return filePath.concat("&").concat(fieldName);
	}
}
