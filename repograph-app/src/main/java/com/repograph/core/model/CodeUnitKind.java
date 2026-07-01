package com.repograph.core.model;

/**
 * 代码符号单元的分类枚举，涵盖 Java、C、Python 三种语言的所有可识别符号类型。
 *
 * <p>STRUCT、UNION、TYPEDEF、MACRO、FUNCTION 为 C 专用类型；Java 和 Python 不使用这些值。
 * Java 类体内的函数使用 METHOD，C 的顶层函数使用 FUNCTION 以区分无所属类的情形。
 *
 * @author leolu
 * @since 0.1.0
 */
public enum CodeUnitKind {

    /** Java/Python 类声明（含 record 类型，通过 metadata["is_record"]="true" 标记）。 */
    CLASS,

    /** Java 接口声明。 */
    INTERFACE,

    /** Java/C 枚举类型声明。 */
    ENUM,

    /** Java 注解类型声明（@interface）。 */
    ANNOTATION,

    /** Java/Python 类体内的方法或函数定义（含 async 方法）。 */
    METHOD,

    /** Java 构造器声明。 */
    CONSTRUCTOR,

    /** Java 字段声明、C struct 内字段声明、Python 类体内赋值语句（best-effort）。 */
    FIELD,

    /** Java 局部变量声明。 */
    LOCAL_VAR,

    /** C struct 类型声明。 */
    STRUCT,

    /** C union 类型声明。 */
    UNION,

    /** C typedef 声明。 */
    TYPEDEF,

    /** C 预处理器宏定义（#define）。 */
    MACRO,

    /** C 顶层函数定义或声明（无所属类，区别于 Java 的 METHOD）。 */
    FUNCTION,

    /** Markdown / 文档文件中的一个章节（以 # 标题为边界）。 */
    DOCUMENT
}
