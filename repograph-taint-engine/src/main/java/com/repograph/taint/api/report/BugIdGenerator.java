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

package com.repograph.taint.api.report;

import com.google.common.base.Strings;

/**
 * bugId Generator.
 *
 * @author LeoLu
 * @since 1/7/2022
 **/
public class BugIdGenerator {

	private BugIdGenerator() {
	}

	public static int buildBugId(BugMateInfo info, String passKind) {
		String stringSSA = String.valueOf(info.getSsaInstruction());
		return buildBugID(passKind, info.getFilePath(), info.getFieldName(),
			info.getVariable(), stringSSA, info.getLineNumber(), info.getMethodSignature(), 0);
	}

	public static int buildBugId(BugMateInfo info, String passKind, String source, int line, int stepsCount) {
		String stringSSA = String.valueOf(info.getSsaInstruction());

		int lineNumber = line;
		if (line == 0 || line == -1) {
			lineNumber = info.getLineNumber();
		}

		String sourceSignature = source;
		if (Strings.isNullOrEmpty(source)) {
			sourceSignature = info.getMethodSignature();
		}

		return buildBugID(passKind, info.getFilePath(), info.getFieldName(),
			info.getVariable(), stringSSA, lineNumber, sourceSignature, stepsCount);
	}

	private static int buildBugID(
		String type, String filePath, String filedName, String variable,
		String ssa, int lineNumber, String sourceInfo, int stepsCount) {
		final int prime = 31;
		long result = 1;
		result = getResult(type, filePath, filedName, result);
		result = getResult(variable, ssa, sourceInfo, result);
		result = prime * result + lineNumber;
		result = prime * result + stepsCount;
		if (Integer.MIN_VALUE < result && Integer.MAX_VALUE > result)
			return (int) result;
		else {
			return (int) (result & Integer.MAX_VALUE);
		}
	}

	private static long getResult(String type, String filePath, String filedName, long result) {
		result = 31 * result + ((type == null) ? 0 : type.hashCode());
		result = 31 * result + ((filePath == null) ? 0 : filePath.hashCode());
		result = 31 * result + ((filedName == null) ? 0 : filedName.hashCode());
		return result;
	}

}
