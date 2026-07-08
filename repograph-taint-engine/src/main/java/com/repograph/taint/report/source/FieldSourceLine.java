package com.repograph.taint.report.source;

import com.repograph.taint.api.IContext;
import com.repograph.taint.api.cache.GlobalCache;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.stream.Stream;

import static java.nio.charset.StandardCharsets.UTF_8;
import static java.util.Objects.isNull;

public class FieldSourceLine {

	protected static final SourceJavaLineCacheUtil SOURCE_JAVA_LINE_CACHE = SourceJavaLineCacheUtil.getInstance();

	/**
	 * if exception return 0 (default is 0)
	 * else return field line which has access modifier private/protected/public/default
	 *
	 * @param filePath  java source path
	 * @param fieldName field name
	 * @return line num
	 */
	public static int getFieldLineFormSourceJava(String filePath, String fieldName) {
		// first, get info from cache
		String key = assemblerFieldCacheKey(filePath, fieldName);
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
				if (isJavaDoc(lineTxt) || lineTxt.trim().isEmpty() || isBetweenMethodHandler(lineTxt, fieldName)) {
					continue;
				}

				String withSpaces = lineTxt.trim()
					.replaceAll(",", " ")
					.replaceAll(";", " ")
					.replaceAll("=", " ");
				String[] tokens = withSpaces.split(" ");
				for (String token : tokens) {
					if (token.equals(fieldName)) {
						SOURCE_JAVA_LINE_CACHE.doCache(key, lineNum);
						return lineNum;
					}
				}
			}
			bufferedReader.close();
			read.close();
		} catch (IOException e) {
			return 0;
		}
		return 0;
	}

	protected static File getJavaFile(String filePath) {
		IContext completeContext = GlobalCache.INSTANCE.get(GlobalCache.DEFAULT_KEY);
		try (Stream<Path> stream = Files.walk(Paths.get(completeContext.getTargetPath().toString()))) {
			return stream.map(Path::toFile)
				.filter(e -> !e.isHidden() && e.getPath().contains(filePath))
				.findFirst()
				.orElse(null);
		} catch (IOException ignored) {
		}
		return null;
	}

	protected static String assemblerFieldCacheKey(String filePath, String fieldName) {
		return filePath.concat("|").concat(fieldName);
	}

	protected static boolean isJavaDoc(String lineTxt) {
		String trim = lineTxt.trim();
		return trim.startsWith("//") || trim.startsWith("/*") || trim.startsWith("*")
			|| trim.endsWith("*/");
	}

	protected static boolean isBetweenMethodHandler(String lineTxt, String fieldName) {
		if (lineTxt.contains("(")) {
			String after = lineTxt.substring(lineTxt.lastIndexOf("(") + 1);
			return after.contains(fieldName);
		} else if (lineTxt.contains(")")) {
			String before = lineTxt.substring(0, lineTxt.lastIndexOf(")"));
			return before.contains(fieldName);
		}
		return false;
	}

	protected static int getSourceJavaLineFromCache(String key) {
		Integer sourceJavaInfos = SOURCE_JAVA_LINE_CACHE.doGet(key);
		if (isNull(sourceJavaInfos)) {
			return -1;
		}
		return sourceJavaInfos;
	}
}
