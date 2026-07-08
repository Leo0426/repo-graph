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

package com.repograph.taint.solver;

import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;

import java.util.Objects;

public class FieldReferenceEntity {

	private final int var;
	private final FieldCFG fieldCFG;
	private final CGNode cgNode;
	private final FieldReference fieldReference;
	private final IExplodedBasicBlock basicBlock;

	public FieldReferenceEntity(FieldCFG fieldCFG, CGNode cgNode, int var,
								FieldReference fieldReference, IExplodedBasicBlock basicBlock) {
		this.fieldCFG = fieldCFG;
		this.cgNode = cgNode;
		this.var = var;
		this.fieldReference = fieldReference;
		this.basicBlock = basicBlock;
	}

	public FieldCFG getFieldCFG() {
		return fieldCFG;
	}

	@Override
	public boolean equals(Object o) {
		if (this == o) return true;
		if (o == null || getClass() != o.getClass()) return false;
		FieldReferenceEntity that = (FieldReferenceEntity) o;
		return var == that.var && Objects.equals(getFieldCFG(), that.getFieldCFG())
			&& Objects.equals(cgNode, that.cgNode) && Objects.equals(fieldReference, that.fieldReference)
			&& Objects.equals(basicBlock, that.basicBlock);
	}

	@Override
	public int hashCode() {
		return Objects.hash(var, getFieldCFG(), cgNode, fieldReference, basicBlock);
	}
}
