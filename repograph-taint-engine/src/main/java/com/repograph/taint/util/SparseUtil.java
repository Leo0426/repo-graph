package com.repograph.taint.util;

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
import java.util.Collections;
import java.util.List;
import java.util.Set;

import static com.repograph.taint.api.DomainElementType.NORMAL;

/**
 * This class contains utility methods for handling AccessPath, DomainElement, and related objects.
 *
 * @author leo
 * @since 2024/12/2
 */
public class SparseUtil {


	/**
	 * Compares access paths from a CGNode to a given access path and populates a set with any matched access paths.
	 *
	 * @param cgNode     the CGNode being analyzed
	 * @param base       the base integer value of the AccessPath
	 * @param accessPath the AccessPath to compare against
	 * @param resultSet  the set to store matched access paths
	 * @return true if a matching access path is found, otherwise false
	 */
	public static boolean matchAccessPaths(CGNode cgNode, int base, AccessPath accessPath, Set<List<FieldReference>> resultSet) {
		List<AccessPath> pathsToCompare = new ArrayList<>(APCollector.getInstance().getFullAccessPaths(accessPath));
		if (pathsToCompare.isEmpty()) {
			return false;
		}

		boolean matched = false;
		for (AccessPath currentPath : APCollector.getInstance().getFullAccessPaths(cgNode, base)) {
			int currentBase = currentPath.getBase();
			CGNode currentCGNode = currentPath.getCGNode();
			List<FieldReference> currentFields = currentPath.getFieldRefs();
			for (AccessPath comparedPath : pathsToCompare) {
				if (currentBase != comparedPath.getBase() || !currentCGNode.equals(comparedPath.getCGNode())) {
					continue;
				}
				List<FieldReference> comparedFields = comparedPath.getFieldRefs();
				int commonPrefixLength = findCommonPrefixLength(currentFields, comparedFields);
				if (commonPrefixLength < currentFields.size()) {
					continue;
				}
				if (currentFields.size() < comparedFields.size()) {
					matched = true;
					List<FieldReference> additionalFields = new ArrayList<>(
						comparedFields.subList(currentFields.size(), comparedFields.size())
					);
					resultSet.add(additionalFields);
				} else {
					matched = true;
				}
				if (commonPrefixLength == currentFields.size() && commonPrefixLength < comparedFields.size()) {
					return true;
				}
			}
		}

		return matched;
	}

	private static int findCommonPrefixLength(List<FieldReference> list1, List<FieldReference> list2) {
		int minSize = Math.min(list1.size(), list2.size());
		for (int i = 0; i < minSize; i++) {
			if (!list1.get(i).equals(list2.get(i))) {
				return i;
			}
		}
		return minSize;
	}

	/**
	 * Compares two AccessPaths and populates a set with any matched access paths.
	 *
	 * @param accessPath1 the first AccessPath to compare
	 * @param accessPath2 the second AccessPath to compare
	 * @param resultSet   the set to store matched access paths
	 * @return true if a matching access path is found, otherwise false
	 */
	public static boolean matchAccessPaths(
		AccessPath accessPath1, AccessPath accessPath2, Set<List<FieldReference>> resultSet) {
		boolean matched = false;
		for (AccessPath currentPath : APCollector.getInstance().getFullAccessPaths(accessPath1)) {
			int currentBase = currentPath.getBase();
			CGNode currentCGNode = currentPath.getCGNode();
			List<FieldReference> currentFields = currentPath.getFieldRefs();

			outerLoop:
			for (AccessPath comparedPath : APCollector.getInstance().getFullAccessPaths(accessPath2)) {
				if (currentBase != comparedPath.getBase() || !currentCGNode.equals(comparedPath.getCGNode())) {
					continue;
				}
				List<FieldReference> comparedFields = comparedPath.getFieldRefs();
				int i;
				for (i = 0; i < currentFields.size(); i++) {
					if (comparedFields.size() <= i) {
						return true; // Partial match found
					}
					if (!currentFields.get(i).equals(comparedFields.get(i))) {
						continue outerLoop;
					}
				}
				matched = true;
				if (comparedFields.size() > i) {
					List<FieldReference> additionalFields = new ArrayList<>();
					while (i < comparedFields.size()) {
						additionalFields.add(comparedFields.get(i));
						i++;
					}
					resultSet.add(additionalFields);
				}
			}
		}
		return matched;
	}

	/**
	 * Creates a new DomainElement and adds it to the TabulationDomain.
	 *
	 * @param domain       the TabulationDomain to which the DomainElement is added
	 * @param blockContext the basic block context containing the SSA instruction
	 * @return the index of the added DomainElement in the TabulationDomain
	 */
	public static int createDomainElement(
		TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain,
		BasicBlockInContext<IExplodedBasicBlock> blockContext) {
		SSAInstruction instruction = blockContext.getLastInstruction();
		if (!(instruction instanceof SSAInvokeInstruction)) {
			throw new AssertionError();
		}
		int defVar = instruction.hasDef() ? instruction.getDef() : instruction.getUse(0);
		AccessPath accessPath = new AccessPath(defVar, null, blockContext.getNode());
		DomainElement element = new DomainElement(blockContext.getNode(), accessPath,
			new SourceContext(blockContext, accessPath), NORMAL, instruction, null);
		return domain.add(element);
	}

	/**
	 * Creates DomainElements for a set of source parameters and adds them to the TabulationDomain.
	 *
	 * @param domain the TabulationDomain to which the DomainElements are added
	 * @param src    the source basic block context
	 * @param dest   the target basic block context
	 * @return a set of indices of the added DomainElements in the TabulationDomain
	 */
	public static IntSet createDomainElementsForSourceParams(
		TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain,
		BasicBlockInContext<IExplodedBasicBlock> src,
		BasicBlockInContext<IExplodedBasicBlock> dest) {
		MutableSparseIntSet resultSet = MutableSparseIntSet.makeEmpty();
		SSAInstruction lastInstruction = src.getLastInstruction();

		if (!(lastInstruction instanceof SSAInvokeInstruction)) {
			throw new AssertionError("The last instruction is not an SSAInvokeInstruction.");
		}

		List<Integer> sourceParams = getSourcePara(src, dest);
		if (sourceParams.isEmpty()) {
			return null;
		}

		for (Integer param : sourceParams) {
			AccessPath accessPath = new AccessPath(param, null, dest.getNode());
			DomainElement element = new DomainElement(dest.getNode(), accessPath,
				new SourceContext(dest, accessPath), NORMAL, null, null);
			resultSet.add(domain.add(element));
		}
		return resultSet;
	}

	/**
	 * Creates a new DomainElement for a put field instruction and adds it to the TabulationDomain.
	 *
	 * @param domain the TabulationDomain to which the DomainElement is added
	 * @param block  the basic block context containing the put field instruction
	 * @return the index of the added DomainElement in the TabulationDomain, or -1 if not applicable
	 */
	public static int createDomainElementForPutField(
		TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain,
		BasicBlockInContext<IExplodedBasicBlock> block) {
		SSAInstruction instruction = block.getDelegate().getInstruction();
		if (instruction instanceof SSAPutInstruction putInstruction) {
			List<FieldReference> fields = Collections.singletonList(putInstruction.getDeclaredField());
			AccessPath accessPath = new AccessPath(putInstruction.getRef(), fields, block.getNode());
			return domain.add(new DomainElement(block.getNode(), accessPath,
				new SourceContext(block, accessPath), NORMAL, putInstruction, null));
		}
		return -1;
	}

	public static List<Integer> getSourcePara(BasicBlockInContext<IExplodedBasicBlock> callsite,
											  BasicBlockInContext<IExplodedBasicBlock> callee) {
		List<Integer> result = new ArrayList<>();
		IMethod method = callee.getMethod();
		if (method instanceof com.ibm.wala.classLoader.ShrikeCTMethod) {
			for (int i = 0; i < method.getNumberOfParameters(); i++) {
				if (method.isStatic() || i != 0) {
					String paraType = method.getParameterType(i).getName().toString();
					if (!paraType.equals("Ljavax/servlet/http/HttpServletRequest") &&
						!paraType.equals("Ljavax/servlet/http/HttpServletResponse"))
						result.add(i + 1);
				}
			}
		}
		return result;
	}
}
