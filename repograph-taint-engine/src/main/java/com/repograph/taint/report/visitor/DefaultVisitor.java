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

package com.repograph.taint.report.visitor;

import com.repograph.taint.api.IContext;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.api.progress.CurrentProgress;
import com.repograph.taint.api.progress.RuleActionVisitor;
import com.repograph.taint.api.report.BugInfo;
import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.api.rules.IRule;
import com.repograph.taint.report.expoter.BugInfoExporter;
import com.repograph.taint.report.expoter.ProgressRateExporter;
import com.repograph.taint.report.expoter.TaintBugJsonExport;
import com.repograph.taint.report.i18n.MessageWrapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;

import static com.repograph.taint.api.cache.GlobalCache.DEFAULT_KEY;
import static com.repograph.taint.api.report.BugIdGenerator.buildBugId;

/**
 * update rate of progress.
 *
 * @author leolu
 * @since 2023/10/25
 */
public class DefaultVisitor implements RuleActionVisitor, CurrentProgress {

	private static final Logger LOGGER = LoggerFactory.getLogger(DefaultVisitor.class);

	private static final HashSet<String> ID_CACHE = new HashSet<>();

	private final int totalCount;
	private final Path outputPath;
	private final Path targetPath;
	private final Set<Path> allFilePath;
	private final MessageWrapper messageWrapper;

	int current = 0;

	public DefaultVisitor() {
		IContext context = GlobalCache.INSTANCE.get(DEFAULT_KEY);
		targetPath = context.getTargetPath().get(0);
		totalCount = context.getRegisterRules().size();
		outputPath = context.getOutputPath();
		allFilePath = context.getTargetAllFilePath();
		messageWrapper = MessageWrapper.getInstance();
	}

	private static Set<Object> mergeJsonArrays(Set<Object> array1, Set<BugInfo> array2) {
		array1.addAll(array2);
		return array1;
	}

	@Override
	public void updateProgress(IRule iRule) {
		current = current + 1;
		String calculate = calculate(totalCount, current);
		ProgressRateExporter.getInstance()
			.setRatePath(outputPath).reportRateInfo(calculate);
	}

	@Override
	public void exportResult(IRule iRule, Set<BugMateInfo> bugMateInfo) {
		Set<BugInfo> collect = bugMateInfo.stream()
			.map(e -> assemblerBugInfo(e, iRule.getCurrentRuleNumber()))
			.collect(Collectors.toSet());
		File file = outputPath.resolve("taint_result/bugJson").toFile();
		if (file.exists()) {
			ObjectMapper mapper = new ObjectMapper();
			try {
				Set<Object> tree1 = mapper.readValue(file, new TypeReference<>() {
				});
				Set<Object> merged = mergeJsonArrays(tree1, collect);
				mapper.writeValue(outputPath.resolve("taint_result/bugJson").toFile(), merged);
			} catch (IOException ignore) {
			}
		} else {
			BugInfoExporter.getInstance()
				.setBugJsonPath(outputPath.resolve("taint_result"))
				.reportBugJson(collect);
		}
	}

	@Override
	public void exportResult(IRule iRule, TaintResult taintResult) {

		Set<BugInfo> bugInfos = TaintBugJsonExport.getInstance()
			.transformList(taintResult, iRule.getCurrentRuleNumber(), this.allFilePath);

		File file = outputPath.resolve("taint_result/bugJson").toFile();

		if (file.exists()) {
			ObjectMapper mapper = new ObjectMapper();
			try {
				Set<Object> tree1 = mapper.readValue(file, new TypeReference<>() {
				});
				Set<Object> merged = mergeJsonArrays(tree1, bugInfos);
				mapper.writeValue(outputPath.resolve("taint_result/bugJson").toFile(), merged);
			} catch (IOException ignore) {
			}
		} else {
			BugInfoExporter.getInstance()
				.setBugJsonPath(outputPath.resolve("taint_result"))
				.reportBugJson(bugInfos);
		}
	}

	private BugInfo assemblerBugInfo(BugMateInfo mateInfo, String ruleNumber) {

		String bugId = String.valueOf(buildBugId(mateInfo, ruleNumber));
		if (isCachedId(bugId)) {
			return null;
		}

		String filePath = mateInfo.getFilePath();

		return BugInfo.builder()
			.withBugId(bugId)
			.withRuleType(ruleNumber)
			.withFilePath(tryFindFullPath(filePath))
			.withVariable(mateInfo.getVariable())
			.withMessage(buildBugMsg(mateInfo, ruleNumber))
			.withLine(mateInfo.getLineNumber())
			.withMethodName(String.valueOf(mateInfo.getMethod().getName()))
			.build();
	}

	private String tryFindFullPath(String path) {
		String resultPath = path;
		for (Path originPath : allFilePath) {
			if (originPath.toString().contains(path)) {
				resultPath = originPath.toString().replace("mount/compile/","");;
			}
		}
		return resultPath;
	}

	private boolean isCachedId(String id) {
		if (ID_CACHE.contains(id)) {
			return true;
		} else {
			ID_CACHE.add(id);
			return false;
		}
	}

	protected String buildBugMsg(BugMateInfo mateInfo, String ruleId) {
		return messageWrapper.getMessage(ruleId, "CHINESE", mateInfo);
	}
}
