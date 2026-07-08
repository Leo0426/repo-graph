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

package com.repograph.taint.api;

import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.IAnalysisCacheView;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cha.IClassHierarchy;

/**
 * propagation transformer.
 *
 * @author leolu
 * @since 2023/10/27
 */
public interface IPropagationTransform {

	IClassHierarchy getClassHierarchy();

	PointerAnalysis<InstanceKey> getPointerAnalysis();

	IAnalysisCacheView getAnalysisCache();

	CallGraph getCgNodes();

	SolverTypeEnum getSolverType();

	String getProjectName();

	String getWrapperFile();

	static Builder builder() {
		return new Builder();
	}

	default Builder toBuilder() {
		return builder()
			.withClassHierarchy(getClassHierarchy())
			.withPointerAnalysis(getPointerAnalysis())
			.withAnalysisCache(getAnalysisCache())
			.withCgNodes(getCgNodes())
			.withSolverType(getSolverType())
			.withProjectName(getProjectName())
			.withWrapperFile(getWrapperFile());
	}

	final class Builder {
		private IClassHierarchy classHierarchy;
		private PointerAnalysis<InstanceKey> pointerAnalysis;
		private IAnalysisCacheView analysisCache;
		private CallGraph cgNodes;
		private SolverTypeEnum solverType;
		private String projectName;
		private String wrapperFile;

		private Builder() {
		}

		public Builder withClassHierarchy(IClassHierarchy val) {
			classHierarchy = val;
			return this;
		}

		public Builder withPointerAnalysis(PointerAnalysis<InstanceKey> val) {
			pointerAnalysis = val;
			return this;
		}

		public Builder withAnalysisCache(IAnalysisCacheView val) {
			analysisCache = val;
			return this;
		}

		public Builder withCgNodes(CallGraph val) {
			cgNodes = val;
			return this;
		}

		public Builder withSolverType(SolverTypeEnum val) {
			solverType = val;
			return this;
		}

		public Builder withProjectName(String val) {
			projectName = val;
			return this;
		}

		public Builder withWrapperFile(String val) {
			wrapperFile = val;
			return this;
		}

		public CustomPropagationTransform build() {
			CustomPropagationTransform customPropagationTransform = new CustomPropagationTransform();
			customPropagationTransform.setClassHierarchy(classHierarchy);
			customPropagationTransform.setPointerAnalysis(pointerAnalysis);
			customPropagationTransform.setAnalysisCache(analysisCache);
			customPropagationTransform.setCgNodes(cgNodes);
			customPropagationTransform.setSolverType(solverType);
			customPropagationTransform.setProjectName(projectName);
			customPropagationTransform.setWrapperFile(wrapperFile);
			return customPropagationTransform;
		}
	}
}
