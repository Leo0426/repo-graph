package com.repograph.taint.extutil;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.repograph.taint.api.FileTypeEnum;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.IntSetAction;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.URL;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

import static com.repograph.taint.api.report.BugMateInfo.beforeAssemblerName;

@SuppressWarnings("all")
public class FileUtils {

	private static final Logger LOGGER = LoggerFactory.getLogger(FileUtils.class);

	private static JSONObject metaInfo;

	public static FileTypeEnum getTypeBySuffix(String filePath) {
		if (!filePath.contains(".")) {
			return FileTypeEnum.UN_KNOWN;
		}
		String extension = filePath.substring(filePath.lastIndexOf("."));
		return switch (extension) {
			case ".xml" -> FileTypeEnum.XML;
			case ".txt" -> FileTypeEnum.TXT;
			case ".jar" -> FileTypeEnum.JAR;
			case ".war" -> FileTypeEnum.WAR;
			case ".json" -> FileTypeEnum.JSON;
			case ".class" -> FileTypeEnum.CLASS;
			case ".java" -> FileTypeEnum.JAVA;
			case ".apk" -> FileTypeEnum.APK;
			default -> FileTypeEnum.UN_KNOWN;
		};
	}

	public static List<URL> iterXMLFileInJar(String jarPath) throws IOException {
		List<URL> result = new ArrayList<URL>();
		JarFile jarFile = null;
		try {
			jarFile = new JarFile(new File(jarPath));
			Enumeration<JarEntry> entries = jarFile.entries();
			while (entries.hasMoreElements()) {
				JarEntry entry = entries.nextElement();
				String entryName = entry.getName();
				if (!entry.isDirectory() && entryName.endsWith(".xml")) {
					URL url = new URL("jar:file:" + jarPath + "!/" + entry.toString());
					result.add(url);
				}
			}
		} finally {
			try {
				if (jarFile != null) {
					jarFile.close();
				}
			} catch (IOException e) {
			}
		}
		return result;
	}

	public static Set<URL> iterXMLFile(Set<URL> result, String filePath) throws IOException {
		File file = new File(filePath);
		if (file.exists()) {
			if (file.isDirectory()) {
				File[] files = file.listFiles();
				for (File subFile : files) {
					iterXMLFile(result, subFile.getAbsolutePath());
				}
			} else {
				switch (getTypeBySuffix(filePath)) {
					case JAR:
					case WAR:
						try {
							result.addAll(iterXMLFileInJar(filePath));
						} catch (Exception e) {
							LOGGER.error("xml in File Path fail: {}", filePath);
						}
						break;
					case XML:
						result.add((new File(filePath)).toURI().toURL());
						break;
					default:
						break;
				}
			}
		}
		return result;
	}

	public static boolean isFile(String filePath) {
		File file = new File(filePath);
		return file.isFile();
	}

	public static URI pathToURI(String path) {
		if (path == null) {
			return null;
		} else {
			return new File(path).toURI();
		}
	}

	public static boolean isTXTFile(String f) {
		return getTypeBySuffix(f) == FileTypeEnum.TXT;
	}

	public static boolean isDir(String f) {
		return new File(f).isDirectory();
	}

	public static boolean isXMLFile(String f) {
		return getTypeBySuffix(f) == FileTypeEnum.XML;
	}


	public static void dumpFactInfoBeforeProcessing(@SuppressWarnings("rawtypes") TabulationDomain domain,
													BasicBlockInContext<IExplodedBasicBlock> bb, int fact, Logger logger) {
		logger.debug("");
		logger.debug("preprocess " + bb.getMethod().getName() + "@" + bb.getDelegate().getInstruction() + " : ");
		bb.iteratePhis().forEachRemaining(phi -> {
			logger.debug("phi " + phi);
		});
		if (bb.isCatchBlock()) {
			logger.debug("catch " + bb.getDelegate().getCatchInstruction());
		}
		if (fact == 0) {
			logger.debug("<fact 0>");
		} else {
			logger.debug(domain.getMappedObject(fact).toString());
		}
	}

	public static void dumpFactsInfoAfterProcessing(@SuppressWarnings("rawtypes") TabulationDomain domain,
													BasicBlockInContext<IExplodedBasicBlock> bb, IntSet facts, Logger logger) {
		logger.debug("postprocess : ");
		facts.foreach(new IntSetAction() {
			@Override
			public void act(int x) {
				if (x == 0) {
//					logger.debug("<fact 0>");
				} else {
					logger.debug(domain.getMappedObject(x).toString());
				}
			}
		});
	}

	protected static String rootOutputDir() {
		String outputDir = null;
		if (Objects.equals(outputDir, "")) {
			return System.getProperty("user.dir");
		} else {
			return outputDir;
		}
	}

	public static String graphsOutputDir() {
		return getOrCreateDir(rootOutputDir() + File.separator + "graphs_java");
	}

	protected static String getOrCreateDir(String dir) {
		File folder = new File(dir);
		if (!folder.exists() && !folder.isDirectory()) {
			folder.mkdirs();
		}
		return dir;
	}

	public static String getFilePath(IClass clazz) {
		StringBuilder str = new StringBuilder("/");
		String clazzStr = clazz.getName().toString();
		String[] strPrefixArray = clazzStr.substring(1, clazzStr.length()).split("/");
		for (int i = 0; i < strPrefixArray.length - 1; i++) {
			str.append(strPrefixArray[i]).append("/");
		}
		String sourceFile = clazz.getSourceFileName();
		if (sourceFile == null || sourceFile.equals("")) {
			return null;
		}
		str.append(sourceFile);
		return str.toString();
	}

	public static String getFilePath(IMethod method) {
		StringBuilder str = new StringBuilder("/");
		IClass clazz = method.getDeclaringClass();
		String[] arr = method.toString().split(",");
		String strPrefix = arr[1].substring(2);
		String[] strPrefixArray = strPrefix.split("/");
		for (int i = 0; i < strPrefixArray.length - 1; i++) {
			str.append(strPrefixArray[i]).append("/");
		}
		str.append(beforeAssemblerName(method, clazz.getSourceFileName()));
		return str.toString();
	}

	public static void appendMetaInfo(IClass clazz, String type, String name, int beginLine, int endLine, String nodeID) {
		String filePath = getFilePath(clazz);
		if (filePath == null)
			return;
		if (metaInfo == null)
			return;
		JSONObject fp = metaInfo.getJSONObject(filePath);
		if (fp == null) {
			fp = new JSONObject();
			metaInfo.put(filePath, fp);
			fp.put("nodeID", "");
		}
		JSONArray elements = fp.getJSONArray("element");
		if (elements == null) {
			elements = new JSONArray();
			fp.put("element", elements);
		}
		JSONObject element = new JSONObject();
		element.put("type", type);
		element.put("name", name);
		element.put("beginLine", beginLine);
		element.put("endLine", endLine);
		element.put("nodeID", nodeID);
		elements.add(element);
	}

	protected static boolean deleteDir(File dir) {
		if (dir.isDirectory()) {
			String[] children = dir.list();
			for (int i = 0; i < children.length; i++) {
				boolean success = deleteDir(new File(dir, children[i]));
				if (!success) {
					return false;
				}
			}
		}
		return dir.delete();
	}
}
