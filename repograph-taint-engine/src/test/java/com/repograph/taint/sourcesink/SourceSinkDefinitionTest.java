package com.repograph.taint.sourcesink;

import com.alibaba.fastjson2.JSONObject;
import com.ibm.wala.types.MethodReference;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * IFDS 污点配置解析测试:source/sink 定义从 JSON 反序列化并构建 WALA {@link MethodReference}。
 * 覆盖引擎运行前的输入契约（sources_and_sinks 配置的解析），不依赖调用图。
 */
class SourceSinkDefinitionTest {

    private static JSONObject sourceJson() {
        JSONObject o = new JSONObject();
        o.put("DeclaringClass", "Ljava/lang/System");
        o.put("ReturnType", "Ljava/lang/String");
        o.put("MethodName", "getenv");
        o.put("ArgTypes", "Ljava/lang/String");
        o.put("ParameterIndex", 0);
        o.put("BelongTo", "CWE_78,CWE_89");
        o.put("BugLevel", "high");
        return o;
    }

    @Test
    void sourceDefinition_parsesFieldsAndMethodReference() {
        SourceDefinition src = SourceDefinition.fromJSONObject(sourceJson());

        MethodReference mr = src.getMethodReference();
        assertEquals("Ljava/lang/System", mr.getDeclaringClass().getName().toString());
        assertEquals("getenv", mr.getName().toString());
        assertEquals(1, mr.getNumberOfParameters(), "ArgTypes 单参数应产生 1 个形参");

        assertEquals(0, src.getParaIdx());
        assertEquals("high", src.getBugLevel());
    }

    @Test
    void sourceDefinition_belongTo_splitsOnComma() {
        SourceDefinition src = SourceDefinition.fromJSONObject(sourceJson());
        assertTrue(src.getBelongTo().contains("CWE_78"));
        assertTrue(src.getBelongTo().contains("CWE_89"));
        assertEquals(2, src.getBelongTo().size());
    }

    @Test
    void sourceDefinition_missingParameterIndex_defaultsToMinusOne() {
        JSONObject o = sourceJson();
        o.remove("ParameterIndex");
        SourceDefinition src = SourceDefinition.fromJSONObject(o);
        assertEquals(-1, src.getParaIdx(), "缺失 ParameterIndex 时默认 -1");
    }

    @Test
    void sourceDefinition_roundTripsThroughJson() {
        SourceDefinition src = SourceDefinition.fromJSONObject(sourceJson());
        SourceDefinition again = SourceDefinition.fromJSONObject(src.toJSONObject());
        assertEquals(src.getMethodReference(), again.getMethodReference(),
            "toJSONObject -> fromJSONObject 应保持 MethodReference 不变");
    }

    @Test
    void sinkDefinition_parsesMethodReference() {
        JSONObject o = new JSONObject();
        o.put("DeclaringClass", "Ljava/lang/Runtime");
        o.put("ReturnType", "Ljava/lang/Process");
        o.put("MethodName", "exec");
        o.put("ArgTypes", "Ljava/lang/String");
        o.put("BelongTo", "CWE_78");

        SinkDefinition sink = SinkDefinition.fromJSONObject(o);
        MethodReference mr = sink.getMethodReference();
        assertEquals("Ljava/lang/Runtime", mr.getDeclaringClass().getName().toString());
        assertEquals("exec", mr.getName().toString());
        assertTrue(sink.getBelongTo().contains("CWE_78"));
    }

    @Test
    void definitions_shareMethodReference_whenSameSignature() {
        // WALA MethodReference 走 findOrCreate 池化：同签名的 source/sink 指向同一个引用。
        JSONObject o = new JSONObject();
        o.put("DeclaringClass", "Ljava/lang/Runtime");
        o.put("ReturnType", "Ljava/lang/Process");
        o.put("MethodName", "exec");
        o.put("ArgTypes", "Ljava/lang/String");
        o.put("BelongTo", "CWE_78");

        MethodReference a = SinkDefinition.fromJSONObject(o).getMethodReference();
        MethodReference b = SinkDefinition.fromJSONObject(o).getMethodReference();
        assertEquals(a, b);
    }
}
