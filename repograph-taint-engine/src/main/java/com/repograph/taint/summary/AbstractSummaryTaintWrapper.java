package com.repograph.taint.summary;

import com.repograph.taint.summary.data.AbstractFlowSinkSource;
import com.repograph.taint.summary.data.MethodSummaries;
import com.repograph.taint.summary.data.Taint;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.MethodReference;

import javax.xml.stream.XMLStreamException;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;

import static com.repograph.taint.extutil.DFAUtils.isCommonField;
import static com.repograph.taint.extutil.FileUtils.isDir;
import static com.repograph.taint.extutil.FileUtils.isXMLFile;

/**
 * summary wrapper.
 *
 * @author leolu
 * @since 2024/6/11
 */
public abstract class AbstractSummaryTaintWrapper {
	protected final MethodSummaries summaries;
	protected final CallGraph cg;

	public AbstractSummaryTaintWrapper(String wrapperFile, CallGraph cg) {
		this.cg = cg;
		summaries = new MethodSummaries();
		SummaryReader reader = new SummaryReader();
		File dir = new File(wrapperFile);
		if (dir.exists()) {
			readDefaultSummary(reader, dir);
		}
	}

	private void readDefaultSummary(SummaryReader reader, File dir) {
		File[] files = dir.listFiles();
		if (files != null) {
			for (File file : files) {
				if (file.isDirectory()) {
					readDefaultSummary(reader, file);
				} else {
					if (isXMLFile(file.getAbsolutePath())) {
						try {
							reader.read(new FileReader(file), summaries);
						} catch (XMLStreamException | SummaryXMLException | IOException ignore) {
						}
					}
				}
			}
		}
	}

	protected boolean isSupported(MethodReference mr) {
		return summaries.containsKey(mr);
	}

	protected boolean flowMatchesTaint(final AbstractFlowSinkSource flowSource, final Taint taint) {
		if (taint.getParameterIndex() == flowSource.getParameterIndex()) {
			return compareFields(taint, flowSource);
		}
		return false;
	}

	protected boolean compareFields(Taint taintedPath, AbstractFlowSinkSource flowSource) {
		for (int i = 0; i < taintedPath.getFieldLength() && i < flowSource.getFieldLength(); i++) {
			FieldReference taintField = taintedPath.getFieldList().get(i);
			FieldReference sourceField = flowSource.getFieldList().get(i);
			if (!isCommonField(cg.getClassHierarchy(), taintField, sourceField))
				return false;
		}
		return true;
	}

	private void customSummary(SummaryReader reader, String customSummaryFile) {
		if (customSummaryFile != null && !customSummaryFile.isEmpty()) {
			if (isXMLFile(customSummaryFile)) {
				File file = new File(customSummaryFile);
				try {
					reader.read(new FileReader(file), summaries);
				} catch (XMLStreamException | SummaryXMLException | IOException ignore) {
				}
			} else if (isDir(customSummaryFile)) {
				File customDir = new File(customSummaryFile);
				File[] files = customDir.listFiles();
				if (files != null) {
					for (File file : files) {
						if (isXMLFile(file.getAbsolutePath())) {
							try {
								reader.read(new FileReader(file), summaries);
							} catch (XMLStreamException | SummaryXMLException | IOException ignore) {
							}
						}
					}
				}
			}
		}
	}
}
