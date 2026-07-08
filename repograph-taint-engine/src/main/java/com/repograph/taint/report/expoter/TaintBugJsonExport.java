/*
 * Copyright (C) 2022 wuKong, tianQi company. - All Rights Reserved
 */

package com.repograph.taint.report.expoter;

import com.repograph.taint.api.report.BugInfo;
import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.api.report.BugStepInfo;
import com.repograph.taint.api.report.taint.Flow;
import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.report.i18n.MessageWrapper;
import com.ibm.wala.types.MethodReference;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static com.repograph.taint.api.report.BugIdGenerator.buildBugId;
import static com.repograph.taint.report.util.ExporterFilter.tryFindLineFromSourceFile;
import static com.google.common.base.Strings.isNullOrEmpty;
import static java.util.Objects.isNull;
import static java.util.Objects.nonNull;

/**
 * assembler taint bug json message.
 *
 * @author leolu
 * @since 7/26/22
 */
public class TaintBugJsonExport extends BugInfoExporter {

	private final MessageWrapper messageWrapper;

	public TaintBugJsonExport() {
		messageWrapper = MessageWrapper.getInstance();
	}

	/**
	 * get instance.
	 *
	 * @return BugJsonExport
	 */
	public static TaintBugJsonExport getInstance() {
		return TaintBugJsonExportHolder.INSTANCE;
	}

	public void reportBugJson(String ruleId, TaintResult taintResult, Set<Path> allFilePath) {
		Set<BugInfo> bugInfos = transformList(taintResult, ruleId, allFilePath);
		writeBugInfoToFile(bugInfos);
	}

	/**
	 * taint flow data.
	 *
	 * @param bugInfos bugInfos
	 * @param ruleId   ruleId
	 * @return List<BugInfo>
	 */
	public Set<BugInfo> transformList(TaintResult bugInfos, String ruleId, Set<Path> allFilePath) {
		if (isNull(bugInfos)) {
			return new HashSet<>();
		}
		return bugInfos.getFlows().stream()
			.map(e -> transform(e, ruleId, allFilePath))
			.filter(Objects::nonNull)
			.collect(Collectors.toSet());
	}

	/**
	 * transform bugInfo from flow.
	 *
	 * @param flow   flow
	 * @param ruleId ruleId
	 * @return BugInfo
	 */
	private BugInfo transform(Flow flow, String ruleId, Set<Path> allFilePath) {

		BugInfo.Builder builder = BugInfo.builder();

		MethodReference methodReference = flow.getSourceDefinition().getMethodReference();
		BugMateInfo md = flow.getTo();

		int lineNumber = md.getLineNumber();
		if (lineNumber == -1 || lineNumber == 0) {
			lineNumber = tryFindLineFromSourceFile(md, md.getSsaInstruction());
		}

		String filePath = md.getFilePath();
		String filePathFull = tryFindFullPath(filePath, allFilePath);


		if (nonNull(flow.getSourceDefinition())) {
			String bugLevel = flow.getSourceDefinition().getBugLevel();
			if (isNullOrEmpty(bugLevel) || "null".equals(bugLevel)) {
				builder.withWeaknessLevel("HIGH");
			} else {
				builder.withWeaknessLevel(flow.getSourceDefinition().getBugLevel());
			}
		} else {
			builder.withWeaknessLevel("HIGH");
		}

		List<BugStepInfo> stepInfos = buildSteps(flow, allFilePath);


		String bugId = String.valueOf(buildBugId(md, ruleId, methodReference.getSignature(), lineNumber, stepInfos.size()));

		if (isCachedId(bugId)) {
			return null;
		}

		String buildBugMsg = buildBugMsg(md, ruleId);

		return builder
			.withBugId(bugId)
			.withRuleType(ruleId)
			.withFilePath(filePathFull)
			.withMethodName(flow.getTo().getMethod().getName().toString())
			.withLine(lineNumber)
			.withMessage(buildBugMsg)
			.withVariable(flow.getTo().getVariable())
			.withSteps(stepInfos)
			.build();
	}

	private String tryFindFullPath(String path, Set<Path> allFilePath) {
		String resultPath = path;
		for (Path originPath : allFilePath) {
			if (originPath.toString().contains(path)) {
				resultPath = originPath.toString().replace("mount/compile/","");
			}
		}
		return resultPath;
	}


	protected boolean isCachedId(String id) {
		if (ID_CACHE.contains(id)) {
			return true;
		} else {
			ID_CACHE.add(id);
			return false;
		}
	}

	private List<BugStepInfo> buildSteps(Flow flow, Set<Path> allFilePath) {
		List<BugStepInfo> stepsArray = new ArrayList<>();
		List<BugMateInfo> paths = flow.getStep();
		Collections.reverse(paths);
		for (BugMateInfo path : paths) {
			stepsArray.add(transformStep(path, allFilePath));
		}
		return stepsArray;
	}

	private BugStepInfo transformStep(BugMateInfo step, Set<Path> allFilePath) {
		return BugStepInfo.builder()
			.withMethodName(step.getMethod().getName().toString())
			.withLine(step.getLineNumber())
			.withFilePath(tryFindFullPath(step.getFilePath(), allFilePath))
			.withVariable(step.getVariable())
			.withStepMsg(buildStepsMsgForPath(step))
			.build();
	}

	private String buildStepsMsgForPath(BugMateInfo md) {
		return messageWrapper.getMessage("TaintSteps", "CHINESE", md);
	}

	protected String buildBugMsg(BugMateInfo mateInfo, String ruleId) {
		return messageWrapper.getMessage(ruleId, "CHINESE", mateInfo);
	}

	private static final class TaintBugJsonExportHolder {
		private static final TaintBugJsonExport INSTANCE = new TaintBugJsonExport();
	}
}
