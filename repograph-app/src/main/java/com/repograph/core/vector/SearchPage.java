package com.repograph.core.vector;

import java.util.List;

/**
 * 向量检索分页结果，封装当页结果及分页元信息。
 *
 * <p>{@code hasMore} 基于启发式判断：当 {@code results.size() == limit} 时认为可能还有更多结果；
 * 若 {@code results.size() < limit} 则确认已到最后一页。因 Qdrant 不提供廉价的总数查询，
 * 调用方不应依赖 {@code hasMore=true} 来精确判断剩余条数。
 *
 * @param results 当页检索结果，按相似度降序排列
 * @param offset  本次查询的起始偏移量
 * @param limit   本次查询请求的每页条数
 * @param hasMore {@code true} 表示可能还有更多结果（{@code results.size() == limit}）
 * @author leolu
 * @since 0.4.0
 */
public record SearchPage(
        List<SearchResult> results,
        int offset,
        int limit,
        boolean hasMore
) {}
