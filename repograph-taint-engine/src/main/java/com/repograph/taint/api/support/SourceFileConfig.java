/*
 *
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
 *
 */

package com.repograph.taint.api.support;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * static source files path.
 *
 * @author leolu
 * @since 2024/6/11
 */
public class SourceFileConfig {

	private static final String CONFIG_BASE_PATH = "config";
	private static final String AUTHORIZATION = "authorization";
	private static final String NPD_SUMMARY = "npd_summary";
	private static final String SOURCES_AND_SINKS = "sources_and_sinks";
	private static final String SUMMARY = "summary";

	private String resourcesPath;

	private String customConfigPath;

	private SourceFileConfig() {
	}

	public SourceFileConfig(String resourcesPath) {
		this.resourcesPath = resourcesPath;
	}

	public String getResourcesPath() {
		return resourcesPath;
	}

	public Path getBaseConfigPath() {
		return Paths.get(getResourcesPath()).resolve(CONFIG_BASE_PATH);
	}

	public Path getAuthorizationConfigPath() {
		return getBaseConfigPath().resolve(AUTHORIZATION);
	}

	public Path getNpdSummaryConfigPath() {
		return getBaseConfigPath().resolve(NPD_SUMMARY);
	}

	public Path getSourcesAndSinksConfigPath() {
		return getBaseConfigPath().resolve(SOURCES_AND_SINKS);
	}

	public Path getSummaryConfigPath() {
		return getBaseConfigPath().resolve(SUMMARY);
	}

	public String getCustomConfigPath() {
		return customConfigPath;
	}

	public void setCustomConfigPath(String customConfigPath) {
		this.customConfigPath = customConfigPath;
	}
}
