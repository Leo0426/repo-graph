package com.repograph.securityreview;

/**
 * 配置文件中的一条 key-value 行。
 *
 * @param lineNumber 行号（1-based）
 * @param key        配置键
 * @param value      配置值；仅键无值时为空字符串
 * @author leolu
 */
record ConfigLine(int lineNumber, String key, String value) {
}
