package com.repograph.taint.sourcesink;

import com.repograph.taint.sourcesink.type.AnySource2AnyArg;
import com.repograph.taint.sourcesink.type.AnySource2CombArgs;
import com.repograph.taint.sourcesink.type.AnySource2SpecialArg;
import com.repograph.taint.sourcesink.type.SpecialSource2AnyArg;
import com.repograph.taint.sourcesink.type.SpecialSource2CombArgs;
import com.repograph.taint.sourcesink.type.SpecialSource2SpecialArg;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.TypeReference;
import org.dom4j.Document;
import org.dom4j.Element;
import org.dom4j.io.SAXReader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static java.util.Objects.nonNull;

/**
 * xml parser.
 *
 * @author LeoLu
 * @since 6/16/21
 **/
public class XMLDocumentProvider {
	private static final Logger LOGGER = LoggerFactory.getLogger(XMLDocumentProvider.class);

	private static final String XML_TAG_PASSES = "passes";
	private static final String XML_TAG_PASS = "pass";

	private static final String XML_TAG_SOURCES = "sources";
	private static final String XML_TAG_SOURCE = "source";

	private static final String XML_TAG_FIELD_SOURCES = "fieldSources";
	private static final String XML_TAG_FIELD_SOURCE = "fieldSource";

	private static final String XML_TAG_FIELD_TYPE = "FieldType";
	private static final String XML_TAG_FIELD_NAME = "FieldName";

	private static final String XML_TAG_DECLARING_CLASS = "DeclaringClass";
	private static final String XML_TAG_METHOD_NAME = "MethodName";
	private static final String XML_TAG_RETURN_TYPE = "ReturnType";
	private static final String XML_TAG_ARG_TYPES = "ArgTypes";

	private static final String XML_BUG_LEVEL = "BugLevel";
	private static final String XML_TAG_SINKS = "sinks";
	private static final String XML_TAG_SINK = "sink";

	private static final String XML_TAG_KILLS = "kills";
	private static final String XML_TAG_KILL = "kill";

	private static final String XML_TAG_PARAMETER_INDEX = "ParameterIndex";
	private static final String XML_TAG_FIELDS = "Fields";

	private static final String XML_TAG_ANY_SOURCE_TO_ANY_ARG = "AnySource2AnyArg";
	private static final String XML_TAG_ANY_SOURCE_TO_SPECIAL_ARG = "AnySource2SpecialArg";
	private static final String XML_TAG_ANY_SOURCE_TO_COMB_ARGS = "AnySource2CombArgs";
	private static final String XML_TAG_SPECIAL_SOURCE_TO_ANY_ARG = "SpecialSource2AnyArg";
	private static final String XML_TAG_SPECIAL_SOURCE_TO_SPECIAL_ARG = "SpecialSource2SpecialArg";
	private static final String XML_TAG_SPECIAL_SOURCE_TO_COMB_ARGS = "SpecialSource2CombArgs";

	private static final String XML_TAG_SINKS_INDEX = "Index";
	private static final String XML_TAG_SPECIAL_SOURCE = "SpecialSource";
	private static final String XML_ATTRIBUTE_CONTENT = "content";
	private static final String XML_ATTRIBUTE_ID = "belongTo";

	private Document document;

	private XMLDocumentProvider() {
	}

	/**
	 * get xml parser instance.
	 *
	 * @return XMLDocumentProvider
	 */
	public static XMLDocumentProvider getInstance() {
		return XMLParserHolder.INSTANCE;
	}

	/**
	 * some method as before
	 *
	 * @param fieldString form xml
	 * @return List<FieldReference></>
	 */
	private static List<FieldReference> getFields(String fieldString) {
		LOGGER.info("build fields from {}", fieldString);
		if (fieldString != null) {
			if (fieldString.length() > 3) {
				String[] res = fieldString.substring(1, fieldString.length() - 1).split(",");
				List<FieldReference> ret = new ArrayList<>();
				for (String re : res) {
					String curElement = re.trim();
					ret.add(buildField(curElement));
				}
				return ret;
			}
		}
		return null;
	}

	public static FieldReference buildField(String fieldStr) {
		String className = fieldStr.substring(0, fieldStr.indexOf(":"));
		String[] typeAndField = fieldStr.substring(fieldStr.indexOf(":") + 1).trim().split(" ");
		String fieldType = typeAndField[0];
		String fieldName = typeAndField[1];
		return FieldReference.findOrCreate(TypeReference.findOrCreate(ClassLoaderReference.Primordial, className),
			Atom.findOrCreateUnicodeAtom(fieldName),
			TypeReference.findOrCreate(ClassLoaderReference.Primordial, fieldType));
	}

	/**
	 * load file.
	 *
	 * @param file file
	 * @return XMLDocumentProvider
	 */
	public XMLDocumentProvider load(File file) {
		try {
			LOGGER.info("loading file {}", file);
			SAXReader saxReader = new SAXReader();
			this.document = saxReader.read(file);
		} catch (Exception ex) {
			LOGGER.error("Failed to load XML document", ex);
		}
		return this;
	}

	/**
	 * get root element.
	 *
	 * @return root element.
	 */
	private Element getRootElement() {
		return this.document.getRootElement();
	}

	/**
	 * collect kills information.
	 *
	 * @return Set<IKillDefinition>
	 */
	public Set<IKillDefinition> transformKills() {
		Set<IKillDefinition> killDefinitions = new HashSet<>();
		Iterator<Element> passes = getRootElement().element(XML_TAG_PASSES).elementIterator(XML_TAG_PASS);
		while (passes.hasNext()) {
			Element pass = passes.next();
			String belongTo = pass.attributeValue(XML_ATTRIBUTE_ID);
			Element kills = pass.element(XML_TAG_KILLS);
			if (nonNull(kills)) {
				Iterator<Element> kill = kills.elementIterator(XML_TAG_KILL);
				while (kill.hasNext()) {
					Element killValue = kill.next();
					String paramIndex = killValue.element(XML_TAG_PARAMETER_INDEX).attributeValue(XML_ATTRIBUTE_CONTENT);
					String fields = killValue.element(XML_TAG_FIELDS).attributeValue(XML_ATTRIBUTE_CONTENT);
					String clazz = killValue.element(XML_TAG_DECLARING_CLASS).attributeValue(XML_ATTRIBUTE_CONTENT);
					String methodName = killValue.element(XML_TAG_METHOD_NAME).attributeValue(XML_ATTRIBUTE_CONTENT);
					String returnType = killValue.element(XML_TAG_RETURN_TYPE).attributeValue(XML_ATTRIBUTE_CONTENT);
					String argTypes = killValue.element(XML_TAG_ARG_TYPES).attributeValue(XML_ATTRIBUTE_CONTENT);
					killDefinitions.add(new KillDefinition(clazz, returnType, methodName, argTypes, Integer.parseInt(paramIndex), getFields(fields), belongTo));
				}
			}

		}
		return killDefinitions;
	}

	/**
	 * collect sources information.
	 *
	 * @return Set<SourceDefinition>
	 */
	public Set<SourceDefinition> transformSources() {
		Set<SourceDefinition> sourceDefinitions = new HashSet<>();
		Iterator passes = getRootElement().element(XML_TAG_PASSES).elementIterator(XML_TAG_PASS);
		while (passes.hasNext()) {
			Element pass = (Element) passes.next();
			String belongTo = pass.attributeValue(XML_ATTRIBUTE_ID);
			Element sources = pass.element(XML_TAG_SOURCES);
			if (nonNull(sources)) {
				Iterator source = sources.elementIterator(XML_TAG_SOURCE);
				while (source.hasNext()) {
					Element sourceValue = (Element) source.next();
					String clazz = sourceValue.element(XML_TAG_DECLARING_CLASS).attributeValue(XML_ATTRIBUTE_CONTENT);
					String methodName = sourceValue.element(XML_TAG_METHOD_NAME).attributeValue(XML_ATTRIBUTE_CONTENT);
					String returnType = sourceValue.element(XML_TAG_RETURN_TYPE).attributeValue(XML_ATTRIBUTE_CONTENT);
					String argTypes = sourceValue.element(XML_TAG_ARG_TYPES).attributeValue(XML_ATTRIBUTE_CONTENT);
					String bugLevel = sourceValue.element(XML_BUG_LEVEL).attributeValue(XML_ATTRIBUTE_CONTENT);
					Element paramIndexElement = sourceValue.element(XML_TAG_PARAMETER_INDEX);
					int paraIndex = -1;
					if (nonNull(paramIndexElement)) {
						paraIndex = Integer.parseInt(paramIndexElement.attributeValue(XML_ATTRIBUTE_CONTENT));
					}
					sourceDefinitions.add(new SourceDefinition(clazz, returnType,
						methodName, argTypes, paraIndex, belongTo, bugLevel));
				}
			}
		}
		return sourceDefinitions;
	}

	/**
	 * collect sources information.
	 *
	 * @return Set<SourceDefinition>
	 */
	public Set<SourceDefinition> transformSourcesFromElement(Element element, String belongTo) {
		Set<SourceDefinition> sourceDefinitions = new HashSet<>();
		Element sources = element.element(XML_TAG_SOURCES);
		if (nonNull(sources)) {
			Iterator source = sources.elementIterator(XML_TAG_SOURCE);
			while (source.hasNext()) {
				Element sourceValue = (Element) source.next();
				String clazz = sourceValue.element(XML_TAG_DECLARING_CLASS).attributeValue(XML_ATTRIBUTE_CONTENT);
				String methodName = sourceValue.element(XML_TAG_METHOD_NAME).attributeValue(XML_ATTRIBUTE_CONTENT);
				String returnType = sourceValue.element(XML_TAG_RETURN_TYPE).attributeValue(XML_ATTRIBUTE_CONTENT);
				String argTypes = sourceValue.element(XML_TAG_ARG_TYPES).attributeValue(XML_ATTRIBUTE_CONTENT);
				String bugLevel = sourceValue.element(XML_BUG_LEVEL).attributeValue(XML_ATTRIBUTE_CONTENT);
				Element paramIndexElement = sourceValue.element(XML_TAG_PARAMETER_INDEX);
				int paraIndex = -1;
				if (nonNull(paramIndexElement)) {
					paraIndex = Integer.parseInt(paramIndexElement.attributeValue(XML_ATTRIBUTE_CONTENT));
				}
				sourceDefinitions.add(new SourceDefinition(clazz, returnType,
					methodName, argTypes, paraIndex, belongTo, bugLevel));
			}
		}
		return sourceDefinitions;
	}

	/**
	 * collect filed source information.
	 *
	 * @return Set<IKillDefinition>
	 */
	public Set<FieldSourceDef> transformFiledSourceDef() {
		Set<FieldSourceDef> fieldSourceDefs = new HashSet<>();
		Iterator passes = getRootElement().element(XML_TAG_PASSES).elementIterator(XML_TAG_PASS);
		while (passes.hasNext()) {
			Element pass = (Element) passes.next();
			String belongTo = pass.attributeValue(XML_ATTRIBUTE_ID);
			Element fieldSources = pass.element(XML_TAG_FIELD_SOURCES);
			if (nonNull(fieldSources)) {
				Iterator fieldSource = fieldSources.elementIterator(XML_TAG_FIELD_SOURCE);
				while (fieldSource.hasNext()) {
					Element fieldSourceValue = (Element) fieldSource.next();
					String clazz = fieldSourceValue.element(XML_TAG_DECLARING_CLASS).attributeValue(XML_ATTRIBUTE_CONTENT);
					String fieldType = fieldSourceValue.element(XML_TAG_FIELD_TYPE).attributeValue(XML_ATTRIBUTE_CONTENT);
					String fieldName = fieldSourceValue.element(XML_TAG_FIELD_NAME).attributeValue(XML_ATTRIBUTE_CONTENT);
					fieldSourceDefs.add(new FieldSourceDef(clazz, fieldType, fieldName, belongTo));
				}
			}
		}
		return fieldSourceDefs;
	}

	/**
	 * collect sinks information.
	 *
	 * @return Set<SinkDefinition>
	 */
	public Set<SinkDefinition> transformSinks() {
		Set<SinkDefinition> sinkDefinitions = new HashSet<>();
		Iterator passes = getRootElement().element(XML_TAG_PASSES).elementIterator(XML_TAG_PASS);
		while (passes.hasNext()) {
			Element pass = (Element) passes.next();
			String belongTo = pass.attributeValue(XML_ATTRIBUTE_ID);
			Element sinks = pass.element(XML_TAG_SINKS);
			if (nonNull(sinks)) {
				Iterator sink = sinks.elementIterator(XML_TAG_SINK);
				while (sink.hasNext()) {
					Element sinkValue = (Element) sink.next();
					String clazz = sinkValue.element(XML_TAG_DECLARING_CLASS).attributeValue(XML_ATTRIBUTE_CONTENT);
					String methodName = sinkValue.element(XML_TAG_METHOD_NAME).attributeValue(XML_ATTRIBUTE_CONTENT);
					String returnType = sinkValue.element(XML_TAG_RETURN_TYPE).attributeValue(XML_ATTRIBUTE_CONTENT);
					String argTypes = sinkValue.element(XML_TAG_ARG_TYPES).attributeValue(XML_ATTRIBUTE_CONTENT);
					SinkDefinition sinkDefinition = new SinkDefinition(clazz, returnType, methodName, argTypes, belongTo);
					sinkDefinitions.add(sinkDefinition);

					Element anySourceToAnyArg = sinkValue.element(XML_TAG_ANY_SOURCE_TO_ANY_ARG);
					if (nonNull(anySourceToAnyArg)) {
						AnySource2AnyArg anySource2AnyArg = new AnySource2AnyArg();
						sinkDefinition.addTaintedType(anySource2AnyArg);
					}

					Element anySourceToSpecialArg = sinkValue.element(XML_TAG_ANY_SOURCE_TO_SPECIAL_ARG);
					if (nonNull(anySourceToSpecialArg)) {
						List<Integer> tmpList = new ArrayList<>();
						Iterator index = anySourceToSpecialArg.elementIterator(XML_TAG_SINKS_INDEX);
						while (index.hasNext()) {
							Element next = (Element) index.next();
							tmpList.add(Integer.parseInt(next.getText()));
						}
						AnySource2SpecialArg anySource2SpecialArg = new AnySource2SpecialArg(tmpList);
						sinkDefinition.addTaintedType(anySource2SpecialArg);
					}

					Element anySourceToCombArgs = sinkValue.element(XML_TAG_ANY_SOURCE_TO_COMB_ARGS);
					if (nonNull(anySourceToCombArgs)) {
						List<Integer> tmpList = new ArrayList<>();
						Iterator index = anySourceToCombArgs.elementIterator(XML_TAG_SINKS_INDEX);
						while (index.hasNext()) {
							Element next = (Element) index.next();
							tmpList.add(Integer.parseInt(next.getText()));
						}
						AnySource2CombArgs anySource2CombArgs = new AnySource2CombArgs(tmpList);
						sinkDefinition.addTaintedType(anySource2CombArgs);
					}

					Element specialSourceToAnyArg = sinkValue.element(XML_TAG_SPECIAL_SOURCE_TO_ANY_ARG);
					if (nonNull(specialSourceToAnyArg)) {
						Set<SourceDefinition> tmpList = transformSourcesFromElement(specialSourceToAnyArg, belongTo);
						SpecialSource2AnyArg specialSource2AnyArg = new SpecialSource2AnyArg(new ArrayList<>(tmpList));
						sinkDefinition.addTaintedType(specialSource2AnyArg);
					}

					Element specialSourceToSpecialArg = sinkValue.element(XML_TAG_SPECIAL_SOURCE_TO_SPECIAL_ARG);
					if (nonNull(specialSourceToSpecialArg)) {

						Map<Integer, Set<SourceDefinition>> tmpMap = new HashMap<>();
						Iterator iterator = specialSourceToSpecialArg.elementIterator(XML_TAG_SPECIAL_SOURCE);
						while (iterator.hasNext()) {
							Element specialSource = (Element) iterator.next();
							int index = Integer.parseInt(specialSource.element(XML_TAG_SINKS_INDEX).getText());
							Set<SourceDefinition> sourceDefinitions
								= transformSourcesFromElement(specialSource, belongTo);
							tmpMap.put(index, sourceDefinitions);
						}
						SpecialSource2SpecialArg specialSource2SpecialArg = new SpecialSource2SpecialArg(tmpMap);
						sinkDefinition.addTaintedType(specialSource2SpecialArg);
					}

					Element specialSourceToCombArgs = sinkValue.element(XML_TAG_SPECIAL_SOURCE_TO_COMB_ARGS);
					if (nonNull(specialSourceToCombArgs)) {

						Map<Integer, Set<SourceDefinition>> tmpMap = new HashMap<>();
						Iterator iterator = specialSourceToCombArgs.elementIterator(XML_TAG_SPECIAL_SOURCE);
						while (iterator.hasNext()) {
							List<Integer> tmpList = new ArrayList<>();
							Element specialSource = (Element) iterator.next();
							Iterator index = specialSource.elementIterator(XML_TAG_SINKS_INDEX);
							while (index.hasNext()) {
								Element next = (Element) index.next();
								tmpList.add(Integer.parseInt(next.getText()));
							}
							Set<SourceDefinition> sourceDefinitions
								= transformSourcesFromElement(specialSource, belongTo);
							tmpList.forEach(e -> tmpMap.put(e, sourceDefinitions));
						}
						SpecialSource2CombArgs specialSource2CombArgs = new SpecialSource2CombArgs(tmpMap);
						sinkDefinition.addTaintedType(specialSource2CombArgs);
					}
				}
			}
		}
		return sinkDefinitions;
	}

	private static class XMLParserHolder {
		private static final XMLDocumentProvider INSTANCE = new XMLDocumentProvider();
	}
}
