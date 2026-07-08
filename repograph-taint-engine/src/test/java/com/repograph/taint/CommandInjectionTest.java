package com.repograph.taint;

import java.util.HashMap;
import java.util.Map;

/**
 * Test case for command injection vulnerability detection.
 */
public class CommandInjectionTest {

    /**
     * Test method with a command injection vulnerability.
     * The tainted data flows from the cmd parameter through Invoke.chooseOne() to Runtime.exec().
     */
    public Map<String, Object> testcase(String cmd) {
        Map<String, Object> modelMap = new HashMap<>();
        try {
            String a = Invoke.chooseOne(3, "a", "b", "c", cmd, "e");
            Runtime.getRuntime().exec(a);
            modelMap.put("status", "success");
        } catch (Exception e) {
            modelMap.put("status", "error");
        }
        return modelMap;
    }

    /**
     * Mock implementation of the Invoke class for testing purposes.
     */
    public static class Invoke {
        /**
         * Chooses one of the provided strings based on the count.
         * In this case, it will choose the 4th parameter (index 3), which is the cmd parameter.
         */
        public static String chooseOne(int count, String... args) {
            if (count >= 0 && count < args.length) {
                return args[count];
            }
            return "";
        }
    }
}
