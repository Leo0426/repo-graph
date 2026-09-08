package com.acme.showcase.format;

/**
 * JSON implementation used by subtype queries.
 *
 * @author leolu
 */
public class JsonReportFormatter implements ReportFormatter {

    /** {@inheritDoc} */
    @Override
    public String format(String value) {
        return "{\"value\":\"" + value + "\"}";
    }
}
