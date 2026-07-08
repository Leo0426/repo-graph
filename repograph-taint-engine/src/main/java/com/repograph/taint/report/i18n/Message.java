package com.repograph.taint.report.i18n;

import java.beans.ConstructorProperties;
import java.util.List;
import java.util.StringJoiner;


/**
 * i18n message.
 *
 * @author leolu
 * @since 2025/4/8
 */
public class Message {

	private String ruleId;

	private String cweNo;

	private List<MessageItem> messages;

	@ConstructorProperties({
		"RULE_ID", "CWE_NO", "MESSAGES"
	})
	public Message(String ruleId, String cweNo, List<MessageItem> messages) {
		this.ruleId = ruleId;
		this.cweNo = cweNo;
		this.messages = messages;
	}

	public String getRuleId() {
		return ruleId;
	}

	public void setRuleId(String ruleId) {
		this.ruleId = ruleId;
	}

	public String getCweNo() {
		return cweNo;
	}

	public void setCweNo(String cweNo) {
		this.cweNo = cweNo;
	}

	public List<MessageItem> getMessages() {
		return messages;
	}

	public void setMessages(List<MessageItem> messages) {
		this.messages = messages;
	}

	public static class MessageItem {

		private String type;

		private String message;

		@ConstructorProperties({
			"TYPE", "MESSAGE"
		})
		public MessageItem(String type, String message) {
			this.type = type;
			this.message = message;
		}

		public String getType() {
			return type;
		}

		public void setType(String type) {
			this.type = type;
		}

		public String getMessage() {
			return message;
		}

		public void setMessage(String message) {
			this.message = message;
		}

		@Override
		public String toString() {
			return new StringJoiner(", ", MessageItem.class.getSimpleName() + "[", "]")
				.add("type='" + type + "'")
				.add("message='" + message + "'")
				.toString();
		}
	}

	@Override
	public String toString() {
		return new StringJoiner(", ", Message.class.getSimpleName() + "[", "]")
			.add("ruleId='" + ruleId + "'")
			.add("cweNo='" + cweNo + "'")
			.add("messages=" + messages)
			.toString();
	}
}
