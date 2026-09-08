package com.acme.showcase.format;

/**
 * Formatting extension point for inheritance and implementation graph demos.
 *
 * @author leolu
 */
public interface ReportFormatter {

    /**
     * Formats a report value.
     *
     * @param value report value
     * @return formatted representation
     */
    String format(String value);
}
