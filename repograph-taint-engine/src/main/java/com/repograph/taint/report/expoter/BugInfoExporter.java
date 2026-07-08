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

package com.repograph.taint.report.expoter;

import com.repograph.taint.api.report.BugInfo;
import com.repograph.taint.report.CustomObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * vul exporter.
 *
 * @author leolu
 * @since 2023/8/9
 */
public class BugInfoExporter extends CustomObjectMapper {
	public static final String BUG_JSON_FILE_NAME = "bugJson";
	public static final List<String> ID_CACHE = new ArrayList<>();
	private static final Logger LOGGER = LoggerFactory.getLogger(BugInfoExporter.class);
	private Path bugJsonPath;

	/**
	 * get instance.
	 *
	 * @return BugJsonExport
	 */
	public static BugInfoExporter getInstance() {
		return BugJsonExportHolder.INSTANCE;
	}

	public BugInfoExporter setBugJsonPath(Path bugJsonPath) {
		this.bugJsonPath = bugJsonPath;
		return this;
	}

	public void reportBugJson(Set<BugInfo> answer) {
		writeBugInfoToFile(answer);
	}

	/**
	 * Every pass method will be called once.
	 */
	protected void writeBugInfoToFile(Set<BugInfo> bugInfo) {
		File bugJsonFile = bugJsonPath.resolve(BUG_JSON_FILE_NAME).toFile();
		try {
			if (!bugJsonFile.exists()) {
				Files.createDirectories(bugJsonFile.toPath().getParent());
				Files.createFile(bugJsonFile.toPath());
			}
			objectMapper.writeValue(bugJsonFile, bugInfo);
		} catch (Exception e) {
			LOGGER.error("export bug json get an exception : {}", e.getMessage());
		}
	}

	private static final class BugJsonExportHolder {
		private static final BugInfoExporter INSTANCE = new BugInfoExporter();
	}

}
