

package com.repograph.taint.summary;

import java.io.Serial;

public class SummaryXMLException extends Exception {

	@Serial
	private static final long serialVersionUID = 1L;

	public SummaryXMLException() {
		super();
	}

	public SummaryXMLException(String message) {
		super(message);
	}
}
