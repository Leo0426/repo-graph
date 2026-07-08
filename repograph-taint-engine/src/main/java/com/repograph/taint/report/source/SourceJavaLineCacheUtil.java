package com.repograph.taint.report.source;

import com.google.common.base.CharMatcher;
import com.ibm.wala.classLoader.IBytecodeMethod;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.IR;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SSAPhiInstruction;

import java.util.Arrays;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;

import static java.util.Objects.isNull;
import static java.util.Objects.nonNull;

/**
 * cache util only for java source line record.
 *
 * @author LeoLu
 * @since 7/16/21
 **/
public final class SourceJavaLineCacheUtil {

	/**
	 * key is : filePath + fieldName
	 * value is : line number
	 */
	private final ConcurrentHashMap<String, Integer> concurrentHashMap;

	private SourceJavaLineCacheUtil() {
		this.concurrentHashMap = new ConcurrentHashMap<>();
	}

	/**
	 * get cache instance
	 *
	 * @return SourceJavaLineCacheUtil
	 */
	public static SourceJavaLineCacheUtil getInstance() {
		return SourceJavaLineCacheHolder.INSTANCE;
	}

	public void doCache(String key, Integer source) {
		this.concurrentHashMap.put(key, source);
	}

	public Integer doGet(String key) {
		return this.concurrentHashMap.get(key);
	}

	private static final class SourceJavaLineCacheHolder {
		private static final SourceJavaLineCacheUtil INSTANCE = new SourceJavaLineCacheUtil();
	}


	public static LineAndVariable getSourceLocation(CGNode node, SSAInstruction instruction, int vn) {
		if (isNull(instruction) || isNull(node)) {
			return LineAndVariable.builder().withLineNumber(1)
				.withUseVariableNames("null").build();
		}
		IR ir = node.getIR();
		int index = instruction.iIndex();
		SSAInstruction[] instructions = ir.getInstructions();
		int length = ir.getInstructions().length;

		int lineNumber = tryFindNearlyLine(node, instruction);
		if (lineNumber == -1) {
			lineNumber = tryFindNearlyLineFromPhi(node, vn);
			while (lineNumber == -1 && index < length) {
				lineNumber = tryFindNearlyLine(node, instructions[index++]);
			}
		}

		String var = tryFindVariableNameByGroup(ir, index, vn);
		if (var.isEmpty() || "null".equals(var)) {
			var = tryFindVariableFromPhi(node, vn);
			if (var.isEmpty() || "null".equals(var)) {
				var = tryFindVariableNameByGroup(ir, index, instruction.getUse(0));
			}
		}

		return LineAndVariable.builder()
			.withUseVariableNames(var)
			.withDefVariableNames(var)
			.withLineNumber(lineNumber)
			.build();
	}

	/**
	 * find nearly instruction line number.
	 *
	 * @return nearly line number
	 */
	private static int tryFindNearlyLine(CGNode node, SSAInstruction instruction) {
		if (isNull(instruction) || isNull(node)) {
			return -1;
		}
		IR ir = node.getIR();
		int currentIndex = instruction.iIndex();
		IMethod method = ir.getMethod();
		int numberLess = currentIndex;

		int instructionPosition = getInstructionPosition(method, instruction.iIndex());
		if (instructionPosition != -1) {
			return instructionPosition;
		}

		SSAInstruction[] instructions = ir.getInstructions();
		for (int i = currentIndex + 1; i < instructions.length; i++) {
			if (nonNull(instructions[i])) {
				if (instructions[i].iIndex() - numberLess > 0) {
					numberLess = instructions[i].iIndex();
					break;
				}
			}
		}
		return getInstructionPosition(method, numberLess);
	}

	public static int tryFindNearlyLineFromPhi(CGNode node, int vn) {
		DefUse du = node.getDU();
		IMethod method = node.getMethod();
		if (vn != -1) {
			try {
				Iterator<SSAInstruction> itssa = du.getUses(vn);
				while (itssa.hasNext()) {
					SSAInstruction useInstruction = itssa.next();
					if (useInstruction instanceof SSAInvokeInstruction) {
						int instructionPosition = getInstructionPosition(method, useInstruction.iIndex());
						if (instructionPosition == -1) {
							continue;
						} else {
							return instructionPosition;
						}
					}
					if (useInstruction instanceof SSAPhiInstruction) {
						int instructionPosition = getInstructionPosition(method, useInstruction.iIndex());
						if (instructionPosition != -1) {
							return instructionPosition;
						}
					}
				}
			} catch (ArrayIndexOutOfBoundsException ignored) {
			}
		}
		return -1;
	}

	public static String tryFindVariableFromPhi(CGNode node, int vn) {
		DefUse du = node.getDU();
		String var;
		if (vn != -1) {
			try {
				Iterator<SSAInstruction> itssa = du.getUses(vn);
				while (itssa.hasNext()) {
					SSAInstruction useInstruction = itssa.next();
					if (useInstruction instanceof SSAInvokeInstruction) {
						int defphi = useInstruction.getDef();
						var = tryFindVariableNameByGroup(node.getIR(), useInstruction.iIndex(), defphi);
						if (var.isEmpty() || "null".equals(var)) {
							continue;
						} else {
							return var;
						}
					}
					if (useInstruction instanceof SSAPhiInstruction) {
						int defphi = useInstruction.getDef();
						var = tryFindVariableNameByGroup(node.getIR(), useInstruction.iIndex(), defphi);
						if (!(var.isEmpty() || "null".equals(var))) {
							return var;
						}
					}
				}
			} catch (ArrayIndexOutOfBoundsException ignored) {
				return "null";
			}
		}
		return "null";
	}

	private static String tryFindVariableNameByGroup(IR ir, int currentIndex, int vn) {
		String var = "null";
		if (vn == -1 || currentIndex == -1) {
			return var;
		}
		int numberLess = currentIndex;
		SSAInstruction[] instructions = ir.getInstructions();
		for (int i = currentIndex; i < instructions.length; i++) {
			if (nonNull(instructions[i])) {
				if (instructions[i].iIndex() - numberLess > 0) {
					numberLess = instructions[i].iIndex();
					break;
				}
			}
		}
		try {
			String[] localNames = ir.getLocalNames(numberLess, vn);
			if (nonNull(localNames)) {
				var = CharMatcher.inRange('[', ']').trimFrom(Arrays.toString(localNames));
			}
		} catch (Exception ignored) {
			return "null";
		}
		return var;
	}

	private static int getInstructionPosition(IMethod method, int index) {
		if (index == -1) {
			return -1;
		}
		if (method instanceof IBytecodeMethod) {
			try {
				IBytecodeMethod method1 = (IBytecodeMethod) method;
				int bcIndex = method1.getBytecodeIndex(index);
				return method.getLineNumber(bcIndex);
			} catch (InvalidClassFileException ignored) {
				return -1;
			}
		}
		return -1;
	}
}
