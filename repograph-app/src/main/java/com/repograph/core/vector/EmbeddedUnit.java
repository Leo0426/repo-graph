package com.repograph.core.vector;

import com.repograph.core.model.CodeUnit;

/**
 * 持有单个代码单元及其双向量的值对象，作为 {@link VectorStore#upsert} 的输入单元。
 *
 * <p>将原来三个并行列表（units / semanticVecs / codeVecs）收拢为单一类型，
 * 消除调用方手动维护列表等长的负担，并使 embedding 失败时的局部跳过逻辑更清晰。
 *
 * @param unit        代码单元，不为 {@code null}
 * @param semanticVec 语义向量（由注释 + 签名 embed 得到），不为 {@code null}
 * @param codeVec     代码向量（由 rawSource embed 得到），不为 {@code null}
 * @author leolu
 * @since 0.1.0
 */
public record EmbeddedUnit(CodeUnit unit, float[] semanticVec, float[] codeVec) {}
