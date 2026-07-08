package com.repograph.taint.summary;

import com.repograph.taint.summary.data.FlowClear;
import com.repograph.taint.summary.data.FlowSink;
import com.repograph.taint.summary.data.FlowSource;
import com.repograph.taint.summary.data.MethodClear;
import com.repograph.taint.summary.data.MethodFlow;
import com.repograph.taint.summary.data.MethodSummaries;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.MethodReference;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import java.io.IOException;
import java.io.Reader;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.repograph.taint.extutil.DFAUtils.buildField;
import static com.repograph.taint.extutil.DFAUtils.buildMethodReference;

public class SummaryReader extends AbstractXMLReader {
	// CHECKSTYLE:OFF
	public void read(Reader reader, MethodSummaries summaries)
		throws XMLStreamException, SummaryXMLException, IOException {
		XMLStreamReader xmlreader = null;
		try {
			xmlreader = XMLInputFactory.newInstance().createXMLStreamReader(reader);

			Map<String, String> sourceAttributes = new HashMap<>();
			Map<String, String> sinkAttributes = new HashMap<>();
			Map<String, String> clearAttributes = new HashMap<>();

			String currentClazz = "";
			MethodReference currentMethod = null;

			State state = State.summary;
			while (xmlreader.hasNext()) {
				// Read the next tag
				xmlreader.next();
				if (!xmlreader.hasName())
					continue;

				final String localName = xmlreader.getLocalName();
				if (localName.equals(XMLConstants.TREE_CLASSES) && xmlreader.isStartElement()) {
					if (state == State.summary)
						state = State.classes;
					else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_CLAZZ) && xmlreader.isStartElement()) {
					if (state == State.classes) {
						currentClazz = getAttributeByName(xmlreader, XMLConstants.ATTRIBUTE_CLAZZ_NAME);
						state = State.clazz;
					} else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_METHODS) && xmlreader.isStartElement()) {
					if (state == State.clazz)
						state = State.methods;
					else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_METHOD) && xmlreader.isStartElement()) {
					if (state == State.methods) {
						String returnType = getAttributeByName(xmlreader, XMLConstants.ATTRIBUTE_METHOD_RET);
						String methodName = getAttributeByName(xmlreader, XMLConstants.ATTRIBUTE_METHOD_NAME);
						String paraStr = getAttributeByName(xmlreader, XMLConstants.ATTRIBUTE_METHOD_ARG);
						currentMethod = buildMethodReference(currentClazz, returnType, methodName, paraStr);
						state = State.method;
					} else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_METHOD) && xmlreader.isEndElement()) {
					if (state == State.method)
						state = State.methods;
					else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_METHODS) && xmlreader.isEndElement()) {
					if (state == State.methods)
						state = State.clazz;
					else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_CLAZZ) && xmlreader.isEndElement()) {
					if (state == State.clazz)
						state = State.classes;
					else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_CLASSES) && xmlreader.isEndElement()) {
					if (state == State.classes)
						state = State.summary;
					else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_FLOW) && xmlreader.isStartElement()) {
					if (state == State.method) {
						sourceAttributes.clear();
						sinkAttributes.clear();
						state = State.flow;
					} else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_CLEAR) && xmlreader.isStartElement()) {
					if (state == State.method) {
						clearAttributes.clear();
						for (int i = 0; i < xmlreader.getAttributeCount(); i++)
							clearAttributes.put(xmlreader.getAttributeLocalName(i), xmlreader.getAttributeValue(i));
						state = State.clear;
					} else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_SOURCE) && xmlreader.isStartElement()) {
					if (state == State.flow) {
						for (int i = 0; i < xmlreader.getAttributeCount(); i++)
							sourceAttributes.put(xmlreader.getAttributeLocalName(i), xmlreader.getAttributeValue(i));
					} else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_SINK) && xmlreader.isStartElement()) {
					if (state == State.flow) {
						for (int i = 0; i < xmlreader.getAttributeCount(); i++)
							sinkAttributes.put(xmlreader.getAttributeLocalName(i), xmlreader.getAttributeValue(i));
					} else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_FLOW) && xmlreader.isEndElement()) {
					if (state == State.flow) {
						state = State.method;
						MethodFlow flow = new MethodFlow(currentMethod, createSource(sourceAttributes),
							createSink(sinkAttributes));
						summaries.addFlow(flow);
					} else
						throw new SummaryXMLException();
				} else if (localName.equals(XMLConstants.TREE_CLEAR) && xmlreader.isEndElement()) {
					if (state == State.clear) {
						state = State.method;
						MethodClear clear = new MethodClear(currentMethod, createClear(clearAttributes));
						summaries.addClear(clear);
					} else
						throw new SummaryXMLException();
				}
			}
		} finally {
			if (xmlreader != null)
				xmlreader.close();
		}
	}

	private FlowSource createSource(Map<String, String> attributes) {
		return new FlowSource(parameterIdx(attributes), getFields(attributes));
	}

	private FlowSink createSink(Map<String, String> attributes) {
		return new FlowSink(parameterIdx(attributes), getFields(attributes));
	}

	private FlowClear createClear(Map<String, String> attributes) throws SummaryXMLException {
		return new FlowClear(parameterIdx(attributes), getFields(attributes));
	}

	private int parameterIdx(Map<String, String> attributes) {
		String strIdx = attributes.get(XMLConstants.ATTRIBUTE_PARAMTER_INDEX);
		if (strIdx == null || strIdx.isEmpty())
			throw new RuntimeException("Parameter index not specified");
		return Integer.parseInt(strIdx);
	}

	private List<FieldReference> getFields(Map<String, String> attributes) {
		String fields = attributes.get(XMLConstants.ATTRIBUTE_FIELDS);
		if (fields != null) {
			if (fields.length() > 3) {
				String[] res = fields.substring(1, fields.length() - 1).split(",");
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

	private enum State {
		summary, classes, clazz, methods, method, flow, clear
	}
}
