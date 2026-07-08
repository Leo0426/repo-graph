/*
 * MIT License
 *
 * Copyright (c) 2023 Leo Lu.  All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

package com.repograph.taint.report.util;

import com.ibm.wala.classLoader.ClassFileURLModule;
import com.ibm.wala.classLoader.Module;
import com.ibm.wala.ipa.callgraph.AnalysisScope;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.types.ClassLoaderReference;

import java.io.File;
import java.io.IOException;
import java.net.URL;
import java.util.Enumeration;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

import static com.repograph.taint.api.FileTypeEnum.getTypeBySuffix;

public class FileLoaderUtil {

	private static boolean isDirectory = false;

	private FileLoaderUtil() {
	}

	public static void assemblerFiles(AnalysisScope scope, String filePath) throws IOException {
		File file = new File(filePath);
		if (file.exists()) {
			if (file.isDirectory()) {
				if (!isExcludeDirs(file.getAbsolutePath())) {
					isDirectory = true;
					File[] files = file.listFiles();
					for (File subFile : files) {
						assemblerFiles(scope, subFile.getAbsolutePath());
					}
				}
			} else {
				switch (getTypeBySuffix(filePath)) {
					case JAR:
					case WAR:
						// is only for class file.
						if (false) {
							/*
							 * if not -OC, just add jar/war files have jar/war in it
							 */
//							if (!isExcludeJars(filePath)) {
//								Module jarFileModule = (new FileProvider()).getJarFileModule(filePath, FileLoaderUtil.class.getClassLoader());
//								scope.addToScope(ClassLoaderReference.Application, jarFileModule);
//							}
						} else {
							/*
							 * '!isDirectory' means the file that user given is Jars/WARs
							 */
							if (!isDirectory) {
								/*
								 * only analysis class file in jar/war open the Jar/WAR, add the class file into
								 * analysis scope
								 */
								JarFile jarFile = null;
								jarFile = new JarFile(new File(filePath));
								//							URL url = new URL("file:" + filePath);
								//							InputStream clazzStream = url.openConnection().getInputStream();
								//							scope.addInputStreamForJarToScope(ClassLoaderReference.Application, clazzStream);

								Enumeration<JarEntry> entries = jarFile.entries();
								while (entries.hasMoreElements()) {
									JarEntry entry = entries.nextElement();
									String entryName = entry.getName();
									// only add the class file in Jars/Wars
									if (!entry.isDirectory() && entryName.endsWith(".class")) {
										try {
											URL url = new URL("jar:file:" + filePath + "!/" + entry.toString());
											Module clazzFile = new ClassFileURLModule(url);
											scope.addToScope(ClassLoaderReference.Application, clazzFile);
										} catch (IllegalArgumentException | InvalidClassFileException e1) {
										}

									}
								}
								jarFile.close();
							} else {
								/*
								 * add user added analysis jars/wars hightlight: add all-in Jars/Wars
								 */
//								if (isUserConfigLibs(filePath)) {
//									if (!isExcludeJars(filePath)) {
//										Module M = (new FileProvider()).getJarFileModule(filePath,
//											ToolKit.class.getClassLoader());
//										scope.addToScope(ClassLoaderReference.Application, M);
//										logger.info("ADD File [{}] into Analysis Scope.", filePath);
//									}
//								}
							}

						}
						break;
					case CLASS:
						try {
							scope.addClassFileToScope(ClassLoaderReference.Application, new File(filePath));
						} catch (IllegalArgumentException | InvalidClassFileException ignored) {
						}
						break;
					case JAVA:
						scope.addSourceFileToScope(ClassLoaderReference.Application, new File(filePath), filePath);
						break;
					default:
						break;
				}
			}
		} else {
			System.exit(0);
		}
	}

	private static boolean isExcludeDirs(String dir) {
//		for (String excludeDir : excludeDirs) {
//			if (dir.endsWith(excludeDir)) {
//				return true;
//			}
//		}
		return false;
	}
}
