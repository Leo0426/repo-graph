package com.repograph.taint.flow.sparse.util;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.support.framework.spring.source.SourceCreator;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.SourceContext;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.prelim.APCollector;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SSAPutInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class SparseTaintUtil {

	/**
	 * 判断 AccessPath（根据变量）是否匹配当前传播路径，并收集尾部字段差异。
	 */
	public static boolean matchAccessPath(CGNode cgNode, int varIndex, AccessPath target, Set<List<FieldReference>> suffixFields) {
		boolean matched = false;

		for (AccessPath source : APCollector.getInstance().getFullAccessPaths(cgNode, varIndex)) {
			int base = source.getBase();
			List<FieldReference> srcFields = source.getFieldRefs();

			for (AccessPath dest : APCollector.getInstance().getFullAccessPaths(target)) {
				if (base == dest.getBase() && cgNode.equals(dest.getCGNode())) {
					List<FieldReference> dstFields = dest.getFieldRefs();
					int i;
					for (i = 0; i < srcFields.size(); i++) {
						if (dstFields.size() <= i || !srcFields.get(i).equals(dstFields.get(i))) {
							continue;
						}
					}
					matched = true;
					if (dstFields.size() > i) {
						suffixFields.add(dstFields.subList(i, dstFields.size()));
					}
				}
			}
		}

		return matched;
	}

	/**
	 * 判断两个 AccessPath 是否匹配（field匹配前缀），并收集未匹配的字段后缀。
	 */
	public static boolean matchAccessPath(AccessPath source, AccessPath target, Set<List<FieldReference>> suffixFields) {
		boolean matched = false;

		for (AccessPath s : APCollector.getInstance().getFullAccessPaths(source)) {
			for (AccessPath t : APCollector.getInstance().getFullAccessPaths(target)) {
				if (s.getBase() == t.getBase() && s.getCGNode().equals(t.getCGNode())) {
					List<FieldReference> sf = s.getFieldRefs();
					List<FieldReference> tf = t.getFieldRefs();
					int i;
					for (i = 0; i < sf.size(); i++) {
						if (tf.size() <= i || !sf.get(i).equals(tf.get(i))) {
							continue;
						}
					}
					matched = true;
					if (tf.size() > i) {
						suffixFields.add(tf.subList(i, tf.size()));
					}
				}
			}
		}

		return matched;
	}

	/**
	 * 过滤出当前 CGNode 内部定义的参数变量对应的 AccessPath。
	 */
	public static Set<AccessPath> getParameterAccessPaths(CGNode cgNode, int var) {
		Set<AccessPath> result = new HashSet<>();
		IMethod method = cgNode.getMethod();
		for (AccessPath ap : APCollector.getInstance().getFullAccessPaths(cgNode, var)) {
			if (ap.getCGNode().equals(cgNode) && ap.getBase() <= method.getNumberOfParameters()) {
				result.add(ap);
			}
		}
		return result;
	}

	/**
	 * 创建 invoke 指令的返回值 taint 的 DomainElement（作为 source）
	 */
	public static int createReturnDomainElement(TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain,
												BasicBlockInContext<IExplodedBasicBlock> block) {
		SSAInstruction inst = block.getLastInstruction();
		assert inst instanceof SSAInvokeInstruction;

		int retVar = inst.hasDef() ? inst.getDef() : ((SSAInvokeInstruction) inst).getUse(0);
		AccessPath ap = new AccessPath(retVar, null, block.getNode());

		DomainElement domainElement = new DomainElement(
			block.getNode(), ap,
			new SourceContext(block, ap),
			DomainElementType.NORMAL,
			inst,
			null
		);

		return domain.add(domainElement);
	}

	/**
	 * 创建 source 参数 taint 的 DomainElement 集合（可能多个参数）
	 */
	public static IntSet createSourceParameterElements(TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain,
													   BasicBlockInContext<IExplodedBasicBlock> callBlock,
													   BasicBlockInContext<IExplodedBasicBlock> calleeBlock) {
		List<Integer> paramVars = SourceCreator.getSourcePara(callBlock, calleeBlock);
		if (paramVars == null || paramVars.isEmpty()) return null;

		MutableSparseIntSet result = MutableSparseIntSet.makeEmpty();
		for (int param : paramVars) {
			AccessPath ap = new AccessPath(param, null, calleeBlock.getNode());
			DomainElement elem = new DomainElement(calleeBlock.getNode(), ap, new SourceContext(calleeBlock, ap),
				DomainElementType.NORMAL, null, null);
			result.add(domain.add(elem));
		}

		return result;
	}

	/**
	 * 为 entry block 中的参数创建 DomainElement。
	 */
	public static int createEntryParamElement(int var,
											  TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain,
											  BasicBlockInContext<IExplodedBasicBlock> block) {
		if (!block.isEntryBlock() || var <= 0) return -1;
		AccessPath ap = new AccessPath(var, null, block.getNode());
		DomainElement elem = new DomainElement(block.getNode(), ap, new SourceContext(block, ap),
			DomainElementType.NORMAL, null, null);
		return domain.add(elem);
	}

	/**
	 * 处理 putfield 指令的字段传播建模（用于静态字段处理）
	 */
	public static int createStaticPutDomainElement(TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain,
												   BasicBlockInContext<IExplodedBasicBlock> block) {
		SSAInstruction inst = block.getDelegate().getInstruction();
		if (inst instanceof SSAPutInstruction put) {
			List<FieldReference> fields = new ArrayList<>();
			fields.add(put.getDeclaredField());
			AccessPath ap = new AccessPath(put.getRef(), fields, block.getNode());
			DomainElement elem = new DomainElement(block.getNode(), ap, new SourceContext(block, ap),
				DomainElementType.NORMAL, put, null);
			return domain.add(elem);
		}
		return -1;
	}
}
