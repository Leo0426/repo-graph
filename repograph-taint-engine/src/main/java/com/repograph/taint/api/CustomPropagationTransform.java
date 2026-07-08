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

import com.google.common.base.MoreObjects;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.IAnalysisCacheView;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cha.IClassHierarchy;

/**
 * propagation entity.
 *
 * @author leolu
 * @since 2023/10/27
 */
public class CustomPropagationTransform implements IPropagationTransform {

	/**
	 * class hierarchy.
	 */
	private IClassHierarchy classHierarchy;

	/**
	 * pa
	 */
	private PointerAnalysis<InstanceKey> pointerAnalysis;

	/**
	 * cache
	 */
	private IAnalysisCacheView analysisCache;

	/**
	 * call graph
	 */
	private CallGraph cgNodes;

	private SolverTypeEnum solverType;

	private String projectName;

	private String wrapperFile;

	@Override
	public IClassHierarchy getClassHierarchy() {
		return classHierarchy;
	}

	public void setClassHierarchy(IClassHierarchy classHierarchy) {
		this.classHierarchy = classHierarchy;
	}

	@Override
	public PointerAnalysis<InstanceKey> getPointerAnalysis() {
		return pointerAnalysis;
	}

	public void setPointerAnalysis(PointerAnalysis<InstanceKey> pointerAnalysis) {
		this.pointerAnalysis = pointerAnalysis;
	}

	@Override
	public IAnalysisCacheView getAnalysisCache() {
		return analysisCache;
	}

	public void setAnalysisCache(IAnalysisCacheView analysisCache) {
		this.analysisCache = analysisCache;
	}

	@Override
	public CallGraph getCgNodes() {
		return cgNodes;
	}

	public void setCgNodes(CallGraph cgNodes) {
		this.cgNodes = cgNodes;
	}

	@Override
	public SolverTypeEnum getSolverType() {
		return solverType;
	}

	public void setSolverType(SolverTypeEnum solverType) {
		this.solverType = solverType;
	}

	@Override
	public String getProjectName() {
		return projectName;
	}

	public void setProjectName(String projectName) {
		this.projectName = projectName;
	}

	@Override
	public String getWrapperFile() {
		return wrapperFile;
	}

	public void setWrapperFile(String wrapperFile) {
		this.wrapperFile = wrapperFile;
	}

	@Override
	public String toString() {
		return MoreObjects.toStringHelper(this)
			.add("classHierarchy", classHierarchy)
			.add("pointerAnalysis", pointerAnalysis)
			.add("analysisCache", analysisCache)
			.add("cgNodes", cgNodes)
			.toString();
	}
}
