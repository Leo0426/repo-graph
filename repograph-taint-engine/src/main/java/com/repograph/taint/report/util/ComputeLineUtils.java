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

import com.ibm.wala.classLoader.ClassLoaderImpl;
import com.ibm.wala.classLoader.IBytecodeMethod;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IClassLoader;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.classLoader.IMethod.SourcePosition;
import com.ibm.wala.classLoader.ShrikeCTMethod;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.shrike.shrikeBT.IInstruction;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.types.ClassLoaderReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * @author leolu
 * @since 2023/10/30
 */
public class ComputeLineUtils {

	private static final Logger LOGGER = LoggerFactory.getLogger(ComputeLineUtils.class);

	private static final Map<String, Integer> sourceFileMap = new HashMap<>();

	private ComputeLineUtils() {
	}

	public static Map<String, Integer> getFileMapLines(IClassHierarchy classHierarchy) {
		IClassLoader[] cls = classHierarchy.getLoaders();
		for (IClassLoader icl : cls) {
			if (icl.getReference().equals(ClassLoaderReference.Application)) {
				if (icl instanceof ClassLoaderImpl clImpl) {
					for (Iterator<IClass> biter = clImpl.iterateAllClasses(); biter.hasNext(); ) {
						IClass iclass = biter.next();
						String sourceName = iclass.getSourceFileName();
						if (!sourceFileMap.containsKey(sourceName)) {
							sourceFileMap.put(sourceName, 0);
						}
						for (IMethod method : iclass.getDeclaredMethods()) {
							if (method instanceof ShrikeCTMethod) {
								int line = 0;
								try {
									IInstruction[] iInstruction = ((ShrikeCTMethod) method).getInstructions();
									if (iInstruction != null) {
										int s = iInstruction.length;
										SourcePosition sourcePosition = getSourcePosition(method, s - 1);
										if (sourcePosition != null)
											line = sourcePosition.getLastLine();
										if (line > sourceFileMap.get(sourceName)) {
											sourceFileMap.replace(sourceName, line);
										}
									}
								} catch (InvalidClassFileException e) {
									LOGGER.error("getFileMapLines get an exception : {} ", e.getMessage());
								}
							}
						}
					}
				}
			}
		}
		return sourceFileMap;
	}


	public static SourcePosition getSourcePosition(IMethod method, int instIndex) throws InvalidClassFileException {
		try {
			if (method instanceof IBytecodeMethod) {
				return method.getSourcePosition(((IBytecodeMethod<?>) method).getBytecodeIndex(instIndex));
			}
		} catch (ArrayIndexOutOfBoundsException ignored) {
		}
		return null;
	}
}
