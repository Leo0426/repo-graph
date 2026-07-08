package com.repograph.taint.report.i18n;

import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.report.i18n.Message.MessageItem;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.text.MessageFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class MessageWrapper {

	private static final Logger LOGGER = LoggerFactory.getLogger(MessageWrapper.class);
	private static final String YAML_PATH = "/i18n.yaml";

	private static final Map<String, Map<String, String>> CACHE = new ConcurrentHashMap<>();

	static {
		loadAndCacheMessages();
	}

	private MessageWrapper() {
	}

	public static MessageWrapper getInstance() {
		return Holder.INSTANCE;
	}

	private static class Holder {
		private static final MessageWrapper INSTANCE = new MessageWrapper();
	}


	private static void loadAndCacheMessages() {
		try (InputStream input = MessageWrapper.class.getResourceAsStream(MessageWrapper.YAML_PATH)) {
			if (input == null) {
				LOGGER.error("YAML resource not found at path: {}", MessageWrapper.YAML_PATH);
				return;
			}
			ObjectMapper mapper = new ObjectMapper(new YAMLFactory());
			List<Message> messages = mapper.readValue(input, new TypeReference<>() {
			});

			for (Message msg : messages) {
				Map<String, String> typeToTemplate = new HashMap<>();
				for (MessageItem item : msg.getMessages()) {
					typeToTemplate.put(item.getType(), item.getMessage());
				}
				CACHE.put(msg.getRuleId(), typeToTemplate);
			}
			LOGGER.info("Loaded and cached {} i18n messages.", CACHE.size());

		} catch (Exception e) {
			e.printStackTrace();
			LOGGER.error("Failed to load i18n file from {}. Cause: {}", MessageWrapper.YAML_PATH, e.getMessage(), e);
		}
	}

	public String getMessage(String ruleId, String type, BugMateInfo metaData) {
		Map<String, String> typeMap = CACHE.get(ruleId);
		if (typeMap == null) {
			LOGGER.warn("No i18n message found for ruleId: {}", ruleId);
			return null;
		}
		String template = typeMap.get(type);
		if (template == null) {
			LOGGER.warn("No i18n message found for ruleId: {}, type: {}", ruleId, type);
			return null;
		}
		if ("TaintSteps".equals(ruleId)) {
			return format(template, metaData.assemblerStepsArray(metaData));
		}
		return format(template, metaData.assemblerArray(metaData));
	}

	public static String format(String template, Object... args) {
		return MessageFormat.format(template, args);
	}

	public static void main(String[] args) {
		MessageWrapper messageWrapper = MessageWrapper.getInstance();
		String message = messageWrapper.getMessage(
			"CA-JAVA-CWE_0111", "CHINESE",
			BugMateInfo.builder()
				.withAttributes(new ArrayList<>())
				.withMethodName("test")
				.withVariable("test_variable")
				.withLineNumber(10)
				.withAbstractFilePath("com/clouditera/engine/report/i18n/messages.yaml")
				.withFieldName("test_field")
				.build()
		);
		LOGGER.debug(message);
	}
}
