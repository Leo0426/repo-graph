package com.repograph.core.flow;

/**
 * 污点分析中的一个数据位置：参数、返回值、调用位置参数或已知 Sink。
 *
 * @param kind        位置类型
 * @param index       参数或调用参数序号（RETURN / SINK 无意义时为 -1）
 * @param calleeHint  CALL_ARG 和 SINK 时为被调用方的简单方法名
 */
public record TaintSlot(SlotKind kind, int index, String calleeHint) {

    public enum SlotKind { PARAM, RETURN, CALL_ARG, SINK }

    public static TaintSlot param(int idx) {
        return new TaintSlot(SlotKind.PARAM, idx, null);
    }

    public static TaintSlot ofReturn() {
        return new TaintSlot(SlotKind.RETURN, -1, null);
    }

    public static TaintSlot callArg(String callee, int argIdx) {
        return new TaintSlot(SlotKind.CALL_ARG, argIdx, callee);
    }

    public static TaintSlot sink(String callee, int argIdx) {
        return new TaintSlot(SlotKind.SINK, argIdx, callee);
    }

    @Override
    public String toString() {
        return switch (kind) {
            case PARAM    -> "param[" + index + "]";
            case RETURN   -> "return";
            case CALL_ARG -> calleeHint + ".arg[" + index + "]";
            case SINK     -> "SINK:" + calleeHint + ".arg[" + index + "]";
        };
    }
}
