package com.repograph.taint.extutil;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.ibm.wala.analysis.pointers.HeapGraph;
import com.ibm.wala.cfg.CFGSanitizer;
import com.ibm.wala.classLoader.IBytecodeMethod;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IClassLoader;
import com.ibm.wala.classLoader.IField;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.core.util.strings.StringStuff;
import com.ibm.wala.core.viz.PDFViewUtil;
import com.ibm.wala.dataflow.IFDS.ISupergraph;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.AnalysisOptions;
import com.ibm.wala.ipa.callgraph.AnalysisScope;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.IAnalysisCacheView;
import com.ibm.wala.ipa.callgraph.impl.Everywhere;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.callgraph.propagation.PointerKey;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cha.ClassHierarchy;
import com.ibm.wala.ipa.cha.ClassHierarchyException;
import com.ibm.wala.ipa.cha.ClassHierarchyFactory;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.IR;
import com.ibm.wala.ssa.ISSABasicBlock;
import com.ibm.wala.ssa.SSAAbstractInvokeInstruction;
import com.ibm.wala.ssa.SSACFG;
import com.ibm.wala.ssa.SSAGetCaughtExceptionInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAOptions;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.Descriptor;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.types.TypeName;
import com.ibm.wala.types.TypeReference;
import com.ibm.wala.util.WalaException;
import com.ibm.wala.util.collections.ArraySetMultiMap;
import com.ibm.wala.util.collections.CollectionFilter;
import com.ibm.wala.util.collections.HashMapFactory;
import com.ibm.wala.util.collections.MultiMap;
import com.ibm.wala.util.collections.Pair;
import com.ibm.wala.util.debug.Assertions;
import com.ibm.wala.util.graph.Graph;
import com.ibm.wala.util.graph.GraphSlicer;
import com.ibm.wala.util.graph.NumberedGraph;
import com.ibm.wala.util.graph.impl.BasicGraph;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.OrdinalSet;
import com.ibm.wala.util.viz.DotUtil;
import com.ibm.wala.util.viz.NodeDecorator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Stack;
import java.util.function.Predicate;

import static com.repograph.taint.extutil.FileUtils.appendMetaInfo;
import static com.repograph.taint.extutil.FileUtils.deleteDir;
import static com.repograph.taint.extutil.FileUtils.getFilePath;
import static com.repograph.taint.extutil.FileUtils.graphsOutputDir;
import static com.repograph.taint.extutil.FileUtils.rootOutputDir;

/**
 * Utility class providing a variety of static methods to facilitate data flow analysis (DFA),
 * including operations on intermediate representations (IRs), call graphs, and source positions.
 * This class also provides helper methods for exporting graphs, inverting maps, and other utilities
 * related to program analysis.
 */
public class DFAUtils {

	private static final Logger LOGGER = LoggerFactory.getLogger(DFAUtils.class);

	private static JSONObject metaInfo;

	/**
	 * Retrieves the source position of a specific instruction within a method.
	 * It maps the instruction index to its corresponding position in the source code.
	 *
	 * @param method the method containing the instruction.
	 * @param index  the zero-based index of the instruction in the method.
	 * @return the source position of the instruction, or {@code null} if the position is unavailable.
	 * @throws ArrayIndexOutOfBoundsException if the instruction index is invalid.
	 * @throws InvalidClassFileException      if the method's bytecode is corrupted or invalid.
	 */
	public static IMethod.SourcePosition getSourcePosition(IMethod method, int index) {
		try {
			if (method instanceof IBytecodeMethod) {
				return method.getSourcePosition(((IBytecodeMethod<?>) method).getBytecodeIndex(index));
			}
		} catch (ArrayIndexOutOfBoundsException | InvalidClassFileException e) {
			// Handle exception if the bytecode index is out of bounds
		}
		return null;
	}

	/**
	 * Retrieves the source position of a method parameter's declaration in the source code.
	 *
	 * @param method     the method containing the parameter to locate.
	 * @param paramIndex the index of the parameter to retrieve.
	 * @return the source position of the parameter, or {@code null} if the position is unavailable.
	 * @throws ArrayIndexOutOfBoundsException if the parameter index is invalid.
	 * @throws InvalidClassFileException      if the method's bytecode is corrupted or invalid.
	 */
	public static IMethod.SourcePosition getParaSourcePosition(IMethod method, int paramIndex) {
		try {
			if (method instanceof IBytecodeMethod) {
				return method.getParameterSourcePosition(paramIndex);
			}
		} catch (ArrayIndexOutOfBoundsException | InvalidClassFileException e) {
			// Handle exception if the parameter index is out of bounds
		}
		return null;
	}

	/**
	 * Retrieves the source position of the last instruction in the specified method.
	 * This can be useful for determining the ending line of a method in its source code.
	 *
	 * @param node the call graph node representing the method to analyze.
	 * @return the source position of the last instruction, or {@code null} if no position is available.
	 * @throws ArrayIndexOutOfBoundsException if the instruction index is invalid.
	 * @throws InvalidClassFileException      if the method's bytecode is corrupted or invalid.
	 */
	public static IMethod.SourcePosition getLastSourcePosition(CGNode node) {
		SSAInstruction[] instructions = node.getIR().getInstructions();
		IMethod method = node.getMethod();
		try {
			if (method instanceof IBytecodeMethod<?> bytecodeMethod) {
				return bytecodeMethod.getSourcePosition(bytecodeMethod
					.getBytecodeIndex(instructions[instructions.length - 1].iIndex()));
			}
		} catch (ArrayIndexOutOfBoundsException | InvalidClassFileException e) {
			// Handle exception if the index is out of bounds
		}
		return null;
	}

	/**
	 * Maps call sites (represented by SSA invoke instructions) to their corresponding call graph nodes.
	 *
	 * @param superGraph the super graph containing basic blocks and call graph nodes from which to extract call site mappings.
	 * @return a map where keys are SSA invoke instructions and values are sets of possible target call graph nodes.
	 */
	public static Map<SSAAbstractInvokeInstruction, Set<CGNode>> cgNode2CallSite(
		ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> superGraph) {
		CallGraph callGraph = (CallGraph) superGraph.getProcedureGraph();
		Map<SSAAbstractInvokeInstruction, Set<CGNode>> callSiteMap = new HashMap<>();
		for (BasicBlockInContext<IExplodedBasicBlock> bbContext : superGraph) {
			SSAInstruction instruction = bbContext.getDelegate().getInstruction();
			if (instruction instanceof SSAAbstractInvokeInstruction) {
				callGraph.getPossibleTargets(bbContext.getNode(),
						((SSAAbstractInvokeInstruction) instruction).getCallSite())
					.forEach(node -> callSiteMap.computeIfAbsent((SSAAbstractInvokeInstruction) instruction, k
						-> new HashSet<>()).add(node));
			}
		}
		return callSiteMap;
	}

	/**
	 * Retrieves the IR (Intermediate Representation) for a method given its signature.
	 *
	 * @param methodSignature the method signature
	 * @param scope           the analysis scope
	 * @param cache           the analysis cache view
	 * @return the IR for the method
	 */
	public static IR getIR(String methodSignature, AnalysisScope scope, IAnalysisCacheView cache)
		throws ClassHierarchyException {
		ClassHierarchy hierarchy = ClassHierarchyFactory.make(scope);
		return getIR(methodSignature, hierarchy, cache);
	}

	/**
	 * Retrieves the IR (Intermediate Representation) for a method given its signature and class hierarchy.
	 *
	 * @param methodSignature the method signature
	 * @param hierarchy       the class hierarchy
	 * @param cache           the analysis cache view
	 * @return the IR for the method
	 */
	public static IR getIR(String methodSignature, IClassHierarchy hierarchy, IAnalysisCacheView cache) {
		MethodReference methodRef = StringStuff.makeMethodReference(methodSignature);
		IMethod method = hierarchy.resolveMethod(methodRef);
		if (method == null) {
			Assertions.UNREACHABLE("Could not resolve method: " + methodRef);
		}
		AnalysisOptions options = new AnalysisOptions();
		options.getSSAOptions().setPiNodePolicy(SSAOptions.getAllBuiltInPiNodes());
		IR ir = cache.getIR(method, Everywhere.EVERYWHERE);
		if (ir == null) {
			Assertions.UNREACHABLE("Null IR for method: " + method);
		}
		return ir;
	}

	/**
	 * Retrieves the IR for a given method.
	 *
	 * @param method the method
	 * @param cache  the analysis cache view
	 * @return the IR for the method
	 */
	public static IR getIR(IMethod method, IAnalysisCacheView cache) {
		IR ir = cache.getIR(method, Everywhere.EVERYWHERE);
		if (ir == null) {
			Assertions.UNREACHABLE("Null IR for method: " + method);
		}
		return ir;
	}

	/**
	 * Lists the IR for a method given its signature.
	 *
	 * @param methodSignature the method signature
	 * @param scope           the analysis scope
	 * @param cache           the analysis cache view
	 */
	public static void listIR(String methodSignature, AnalysisScope scope, IAnalysisCacheView cache) throws ClassHierarchyException {
		IR ir = getIR(methodSignature, scope, cache);
		if (ir != null) {
			System.err.println(ir.toString());
		}
	}

	/**
	 * Prints the instructions of a method based on its signature.
	 *
	 * @param methodSignature the method signature
	 * @param scope           the analysis scope
	 * @param cache           the analysis cache view
	 */
	public static void PrintInstructionByMethod(String methodSignature, AnalysisScope scope, IAnalysisCacheView cache) throws ClassHierarchyException {
		IR ir = getIR(methodSignature, scope, cache);
		if (ir != null) {
			for (SSAInstruction instruction : ir.getInstructions()) {
				LOGGER.debug(String.valueOf(instruction));
			}
		}
	}

	/**
	 * Exports the IR of a method given its signature.
	 *
	 * @param methodSignature the method signature
	 * @param scope           the analysis scope
	 * @param cache           the analysis cache view
	 */
	public static void exportIR(String methodSignature, AnalysisScope scope, IAnalysisCacheView cache) throws ClassHierarchyException {
		IR ir = getIR(methodSignature, scope, cache);
		exportIR(ir);
	}

	/**
	 * Exports the IR of a method given its signature and class hierarchy.
	 *
	 * @param methodSignature the method signature
	 * @param hierarchy       the class hierarchy
	 * @param cache           the analysis cache view
	 */
	public static void exportIR(String methodSignature, IClassHierarchy hierarchy, IAnalysisCacheView cache) {
		IR ir = getIR(methodSignature, hierarchy, cache);
		exportIR(ir);
	}

	/**
	 * Exports the IR (Intermediate Representation) of a method.
	 *
	 * @param ir the IR to export
	 */
	public static void exportIR(IR ir) {
		IMethod method = ir.getMethod();
		String filename = StringStuff.jvmToReadableType(method.getDeclaringClass().getReference().toString()) + "." + method.getName().toString();
		exportIR(ir, filename + ".dot");
	}

	/**
	 * Exports the IR (Intermediate Representation) of a method to a specific file.
	 *
	 * @param ir       the IR to export
	 * @param filename the name of the file to export to
	 */
	public static void exportIR(IR ir, String filename) {
		if (ir != null) {
			Graph<ISSABasicBlock> graph;
			NodeDecorator<ISSABasicBlock> decorator = PDFViewUtil.makeIRDecorator(ir);
			try {
				graph = CFGSanitizer.sanitize(ir, ir.getMethod().getClassHierarchy());
				DotUtil.writeDotFile(graph, decorator, null, filename);
			} catch (IllegalArgumentException | WalaException e) {
			}
		}
	}

	/**
	 * Exports the class hierarchy to a dot file.
	 *
	 * @param classHierarchy the class hierarchy to export
	 */
	public static void exportClassHierarchy(IClassHierarchy classHierarchy) {
		exportClassHierarchy(classHierarchy, null);
	}

	/**
	 * Exports the class hierarchy to a dot file, filtering out classes that match the provided list.
	 *
	 * @param classHierarchy the class hierarchy to export
	 * @param excludeList    a list of class names to exclude from the export
	 */
	public static void exportClassHierarchy(IClassHierarchy classHierarchy, List<String> excludeList) {
		String outputDir = graphsOutputDir() + File.separator + "CHA.dot";
		BasicGraph<IClass> graph = new BasicGraph<>();
		Map<IClass, String> labels = HashMapFactory.make();
		IClass rootClass = classHierarchy.getRootClass();
		graph.addNode(rootClass);
		labels.put(rootClass, rootClass.getName().getClassName().toString());
		Stack<IClass> stack = new Stack<>();
		Set<IClass> visited = new HashSet<>();
		stack.add(rootClass);
		while (!stack.isEmpty()) {
			IClass cls = stack.pop();
			visited.add(cls);
			Collection<IClass> subclasses = classHierarchy.getImmediateSubclasses(cls);
			for (IClass subclass : subclasses) {
				if (!isApplication(subclass.getClassLoader())) continue;
				if (excludeList != null) {
					boolean exclude = excludeList.stream().anyMatch(subclass.getName().toString()::contains);
					if (exclude) continue;
				}
				graph.addNode(subclass);
				labels.put(subclass, subclass.getName().getClassName().toString());
				graph.addEdge(cls, subclass);
				if (!visited.contains(subclass)) {
					stack.add(subclass);
				}
			}
		}
		graph.forEach(cls -> appendMetaInfo(cls, "class", cls.getName().getClassName().toString(), 0, 0, cls.toString()));
		try {
			DotUtil.writeDotFile(graph, labels::get, "CHA", outputDir);
		} catch (WalaException e) {
		}
	}


	/**
	 * Dumps fact information before processing for debugging purposes.
	 *
	 * @param domain    the tabulation domain
	 * @param bbContext the basic block context
	 * @param fact      the fact to dump
	 * @param logger    the logger for output
	 */
	public static void dumpFactInfoBeforeProcessing(TabulationDomain<?, ?> domain, BasicBlockInContext<?> bbContext, int fact, Logger logger) {
		logger.debug("");
		logger.debug("preprocess " + bbContext.getMethod().getName() + "@" + ((IExplodedBasicBlock) bbContext.getDelegate()).getInstruction() + " : ");
		bbContext.iteratePhis().forEachRemaining(phi -> logger.debug("phi " + phi));
		if (bbContext.isCatchBlock()) {
			logger.debug("catch " + ((IExplodedBasicBlock) bbContext.getDelegate()).getCatchInstruction());
		}
		if (fact == 0) {
			logger.debug("<fact 0>");
		} else {
			logger.debug(domain.getMappedObject(fact).toString());
		}
	}

	/**
	 * Dumps fact information after processing for debugging purposes.
	 *
	 * @param domain    the tabulation domain
	 * @param bbContext the basic block context
	 * @param factSet   the set of facts to dump
	 * @param logger    the logger for output
	 */
	public static void dumpFactsInfoAfterProcessing(TabulationDomain<?, ?> domain, BasicBlockInContext<?> bbContext, IntSet factSet, Logger logger) {
		logger.debug("postprocess : ");
		factSet.foreach(fact -> logger.debug(domain.getMappedObject(fact).toString()));
	}

	/**
	 * Constructs a FieldReference from a field string.
	 *
	 * @param fieldStr the field string in the format "ClassName: FieldType FieldName"
	 * @return the FieldReference corresponding to the field string
	 */
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
	 * Converts a FieldReference to a string in the format "ClassName: FieldType FieldName".
	 *
	 * @param fieldRef the FieldReference to convert
	 * @return the string representation of the FieldReference
	 */
	public static String createFieldString(FieldReference fieldRef) {
		String className = fieldRef.getDeclaringClass().getName().toString();
		String fieldType = fieldRef.getFieldType().getName().toString();
		String fieldName = fieldRef.getName().toString();
		return className + ": " + fieldType + " " + fieldName;
	}

	/**
	 * Lists the elements in a set.
	 *
	 * @param set the set to list elements from
	 */
	public static void listSetElements(Set<?> set) {
		for (Object element : set) {
			LOGGER.debug(String.valueOf(element));
		}
	}

	/**
	 * Displays the elements in a list.
	 *
	 * @param list the list to display elements from
	 */
	public static void showListElements(List<?> list) {
		for (Object element : list) {
			LOGGER.debug(String.valueOf(element));
		}
	}

	/**
	 * Trims whitespace from each string in an array.
	 *
	 * @param array the array of strings to trim
	 * @return the trimmed array of strings
	 */
	public static String[] trimArray(String[] array) {
		for (int i = 0; i < array.length; i++) {
			array[i] = array[i].trim();
		}
		return array;
	}

	/**
	 * Checks if a class loader is the application class loader.
	 *
	 * @param loader the class loader to check
	 * @return true if the loader is the application class loader, false otherwise
	 */
	public static boolean isApplication(IClassLoader loader) {
		return ClassLoaderReference.Application.getName().equals(loader.getName());
	}

	/**
	 * Checks if a class loader is the primordial class loader.
	 *
	 * @param loader the class loader to check
	 * @return true if the loader is the primordial class loader, false otherwise
	 */
	public static boolean isPrimordial(IClassLoader loader) {
		return ClassLoaderReference.Primordial.getName().equals(loader.getName());
	}

	/**
	 * Adds an element to a map that maps keys to sets of elements.
	 *
	 * @param map   the map to add the element to
	 * @param key   the key to associate with the element
	 * @param value the element to add
	 * @return true if the element was added, false otherwise
	 */
	public static <K, V> boolean putElementToMap(Map<K, Set<V>> map, K key, V value) {
		Set<V> valueSet = map.computeIfAbsent(key, k -> new HashSet<>());
		return valueSet.add(value);
	}

	/**
	 * Adds an element to a map that maps keys to lists of elements.
	 *
	 * @param map   the map to add the element to
	 * @param key   the key to associate with the element
	 * @param value the element to add
	 * @return true if the element was added, false otherwise
	 */
	public static <T, M> boolean putListElementToMap(Map<T, List<M>> map, T key, M value) {
		List<M> values = map.computeIfAbsent(key, k -> new ArrayList<>());
		return values.add(value);
	}


	/**
	 * Inverts a MultiMap, swapping keys with their associated values.
	 *
	 * @param map the MultiMap to invert
	 * @return the inverted MultiMap
	 */
	public static MultiMap<Object, Object> invertMap(MultiMap<Object, Object> map) {
		MultiMap<Object, Object> invertedMap = new ArraySetMultiMap<>();
		map.keySet().forEach(key -> map.get(key).forEach(value -> invertedMap.put(value, key)));
		return invertedMap;
	}

	/**
	 * Checks if two pointer keys may alias, meaning they may point to the same memory location.
	 *
	 * @param pointerAnalysis the pointer analysis to use
	 * @param pk1             the first pointer key
	 * @param pk2             the second pointer key
	 * @return true if the pointer keys may alias, false otherwise
	 */
	public static boolean mayAlias(PointerAnalysis<InstanceKey> pointerAnalysis, PointerKey pk1, PointerKey pk2) {
		OrdinalSet<InstanceKey> set1 = pointerAnalysis.getPointsToSet(pk1);
		OrdinalSet<InstanceKey> set2 = pointerAnalysis.getPointsToSet(pk2);
		return !OrdinalSet.intersect(set1, set2).isEmpty();
	}

	/**
	 * Checks if a class name belongs to a system package.
	 *
	 * @param className the class name to check
	 * @return true if the class name belongs to a system package, false otherwise
	 */
	public static boolean isClassInSystemPackage(String className) {
		if (className.contains("/")) {
			className = className.substring(1).replace("/", ".");
		}
		return className.startsWith("android.") || className.startsWith("java.") ||
			className.startsWith("javax.") || className.startsWith("sun.") ||
			className.startsWith("org.omg.") || className.startsWith("org.w3c.dom.") ||
			className.startsWith("com.google.") || className.startsWith("com.android.");
	}

	/**
	 * Converts a type string to its canonical descriptor form.
	 *
	 * @param type the type string to convert
	 * @return the canonical descriptor form of the type string
	 */
	public static String toCanonicalDescriptorTypeString(String type) {
		if (type == null) {
			throw new IllegalArgumentException("Type string is null");
		}
		return "L" + type.replace(".", "/");
	}

	/**
	 * Checks if an SSAInstruction contains a use of a specific variable.
	 *
	 * @param instruction the SSAInstruction to check
	 * @param varIndex    the index of the variable
	 * @return true if the instruction uses the variable, false otherwise
	 */
	public static boolean containUse(SSAInstruction instruction, int varIndex) {
		for (int i = 0; i < instruction.getNumberOfUses(); ++i) {
			if (instruction.getUse(i) == varIndex) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Formats a type string from Soot format to WALA format.
	 *
	 * @param type the type string in Soot format
	 * @return the type string in WALA format
	 */
	public static String formatFromSootToWala(String type) {
		boolean isArray = type.endsWith("[]");
		if (isArray) {
			type = type.substring(0, type.length() - 2);
		}
		String formattedType;
		switch (type) {
			case "boolean":
				formattedType = "Z";
				break;
			case "byte":
				formattedType = "B";
				break;
			case "char":
				formattedType = "C";
				break;
			case "short":
				formattedType = "S";
				break;
			case "int":
				formattedType = "I";
				break;
			case "long":
				formattedType = "J";
				break;
			case "float":
				formattedType = "F";
				break;
			case "double":
				formattedType = "D";
				break;
			case "void":
				formattedType = "V";
				break;
			default:
				formattedType = "L" + type.replace(".", "/");
				break;
		}
		return isArray ? "[" + formattedType : formattedType;
	}

	/**
	 * Formats a type string from WALA format to Soot format.
	 *
	 * @param type the type string in WALA format
	 * @return the type string in Soot format
	 */
	public static String formatFromWalaToSoot(String type) {
		return StringStuff.jvmToReadableType(type);
	}

	/**
	 * Checks if a string represents a bytecode class name.
	 *
	 * @param className the string to check
	 * @return true if the string represents a bytecode class name, false otherwise
	 */
	public static boolean isByteCodeClassName(String className) {
		return (className.length() == 1 && ("ZBCSIFDJV".contains(className))) ||
			(className.startsWith("L") || className.startsWith("[") && className.contains("/"));
	}

	/**
	 * Builds a MethodReference from its components.
	 *
	 * @param className  the class name
	 * @param returnType the return type
	 * @param methodName the method name
	 * @param paramTypes the parameter types
	 * @return the MethodReference
	 */
	public static MethodReference buildMethodReference(String className, String returnType, String methodName, String paramTypes) {
		className = isByteCodeClassName(className) ? className : formatFromSootToWala(className);
		TypeReference classType = TypeReference.findOrCreate(ClassLoaderReference.Primordial, TypeName.string2TypeName(className));
		Atom atom = Atom.findOrCreateUnicodeAtom(methodName);
		TypeName[] paramTypeNames = null;
		if (!paramTypes.isEmpty()) {
			String[] params = paramTypes.split(",");
			paramTypeNames = new TypeName[params.length];
			for (int i = 0; i < params.length; i++) {
				String formattedType = isByteCodeClassName(params[i]) ? params[i] : formatFromSootToWala(params[i]);
				paramTypeNames[i] = TypeName.string2TypeName(formattedType);
			}
		}
		returnType = isByteCodeClassName(returnType) ? returnType : formatFromSootToWala(returnType);
		Descriptor descriptor = Descriptor.findOrCreate(paramTypeNames, TypeName.string2TypeName(returnType));
		return MethodReference.findOrCreate(classType, atom, descriptor);
	}

	/**
	 * Checks if a method is extendable or overridable from another method.
	 *
	 * @param hierarchy the class hierarchy
	 * @param ref1      the first method reference
	 * @param ref2      the second method reference
	 * @return true if the first method can be overridden by the second method, false otherwise
	 */
	public static boolean isExtendiableOrOverridableFrom(IClassHierarchy hierarchy, MethodReference ref1, MethodReference ref2) {
		IClass cls1 = hierarchy.lookupClass(ref2.getDeclaringClass());
		IClass cls2 = hierarchy.lookupClass(ref1.getDeclaringClass());
		if (cls1 == null || cls2 == null) {
			return ref2.getDeclaringClass().getName().toString().equals(ref1.getDeclaringClass().getName().toString()) &&
				ref2.getSelector().toString().equals(ref1.getSelector().toString());
		}
		return ref2.getSelector().toString().equals(ref1.getSelector().toString()) && hierarchy.isAssignableFrom(cls1, cls2);
	}

	/**
	 * Checks if a set of fields contains a common field with a given field reference.
	 *
	 * @param hierarchy the class hierarchy
	 * @param fields    the set of fields
	 * @param fieldRef  the field reference to check
	 * @return true if the set contains a common field, false otherwise
	 */
	public static boolean containsCommonField(IClassHierarchy hierarchy,
											  Set<FieldReference> fields,
											  FieldReference fieldRef) {
		return fields.stream().anyMatch(ref -> ref.equals(fieldRef) || isCommonField(hierarchy, ref, fieldRef));
	}

	/**
	 * Checks if two method references refer to the same method.
	 *
	 * @param hierarchy the class hierarchy
	 * @param ref1      the first method reference
	 * @param ref2      the second method reference
	 * @return true if the references refer to the same method, false otherwise
	 */
	public static boolean sameMethod(IClassHierarchy hierarchy, MethodReference ref1, MethodReference ref2) {
		if (ref1.equals(ref2)) {
			return true;
		}
		Set<IMethod> targets1 = hierarchy.getPossibleTargets(ref1);
		Set<IMethod> targets2 = hierarchy.getPossibleTargets(ref2);
		return targets1.stream().anyMatch(targets2::contains);
	}

	/**
	 * Checks if two field references refer to a common field.
	 *
	 * @param hierarchy the class hierarchy
	 * @param ref1      the first field reference
	 * @param ref2      the second field reference
	 * @return true if the references refer to a common field, false otherwise
	 */
	public static boolean isCommonField(IClassHierarchy hierarchy, FieldReference ref1, FieldReference ref2) {
		if (!ref1.getName().equals(ref2.getName())) {
			return false;
		}
		IField field1 = hierarchy.resolveField(ref1);
		IField field2 = hierarchy.resolveField(ref2);
		if ((field1 != null && field1.isPrivate() && !ref1.equals(ref2))
			|| (field2 != null && field2.isPrivate() && !ref2.equals(ref1))) {
			return false;
		}
		IClass cls1 = hierarchy.lookupClass(ref1.getDeclaringClass());
		IClass cls2 = hierarchy.lookupClass(ref2.getDeclaringClass());
		return cls1 != null && cls2 != null && (hierarchy.isAssignableFrom(cls1, cls2) || hierarchy.isAssignableFrom(cls2, cls1));
	}

	/**
	 * Checks if a type reference represents a simple type.
	 *
	 * @param typeRef the type reference to check
	 * @return true if the reference represents a simple type, false otherwise
	 */
	public static boolean isSimpleType(TypeReference typeRef) {
		return typeRef.equals(TypeReference.JavaLangString) ||
			typeRef.equals(TypeReference.Void) ||
			typeRef.equals(TypeReference.Char) ||
			typeRef.equals(TypeReference.Byte) ||
			typeRef.equals(TypeReference.Short) ||
			typeRef.equals(TypeReference.Int) ||
			typeRef.equals(TypeReference.Float) ||
			typeRef.equals(TypeReference.Long) ||
			typeRef.equals(TypeReference.Double) ||
			typeRef.equals(TypeReference.Boolean);
	}

	/**
	 * Gets the amount of used memory in bytes.
	 *
	 * @return the used memory in bytes
	 */
	public static long getUsedMemory() {
		Runtime runtime = Runtime.getRuntime();
		return runtime.totalMemory() - runtime.freeMemory();
	}

	/**
	 * Gets the amount of used memory in megabytes.
	 *
	 * @return the used memory in megabytes
	 */
	public static long getUsedMemoryMB() {
		Runtime runtime = Runtime.getRuntime();
		return Math.round((runtime.totalMemory() - runtime.freeMemory()) / 1_000_000.0);
	}

	/**
	 * Formats a JSON string with proper indentation.
	 *
	 * @param jsonString the JSON string to format
	 * @return the formatted JSON string
	 */
	public static String formatJson(String jsonString) {
		if (jsonString == null || jsonString.isEmpty()) {
			return "";
		}
		StringBuilder formattedJson = new StringBuilder();
		char prevChar = 0;
		char currentChar = 0;
		int indent = 0;
		for (int i = 0; i < jsonString.length(); i++) {
			prevChar = currentChar;
			currentChar = jsonString.charAt(i);
			switch (currentChar) {
				case '[':
				case '{':
					formattedJson.append(currentChar);
					if (jsonString.charAt(i + 1) == '{') {
						formattedJson.append('\n');
						addIndentBlank(formattedJson, ++indent);
					}
					break;
				case ']':
				case '}':
					formattedJson.append('\n');
					addIndentBlank(formattedJson, --indent);
					formattedJson.append(currentChar);
					break;
				case ',':
					formattedJson.append(currentChar);
					if (prevChar != '\\' && (jsonString.charAt(i + 1) == '"' || jsonString.charAt(i + 1) == '{')) {
						formattedJson.append('\n');
						addIndentBlank(formattedJson, 1);
					}
					break;
				default:
					formattedJson.append(currentChar);
					break;
			}
		}
		return formattedJson.toString();
	}

	/**
	 * Adds indentation to a StringBuilder.
	 *
	 * @param builder the StringBuilder to add indentation to
	 * @param indent  the number of indent levels to add
	 */
	public static void addIndentBlank(StringBuilder builder, int indent) {
		for (int i = 0; i < indent; i++) {
			builder.append('\t');
		}
	}

	/**
	 * Gets the variable name from the source code for a given IR and variable index.
	 *
	 * @param ir               the IR containing the variable
	 * @param varIndex         the index of the variable
	 * @param instructionIndex the instruction index where the variable is used
	 * @return the variable name, or "null" if not found
	 */
	public static String getSourceCodeVariableName(IR ir, int varIndex, int instructionIndex) {
		if (ir == null) {
			return "null";
		}
		String[] localNames = ir.getLocalNames(varIndex, instructionIndex);
		if (localNames == null || localNames.length == 0) {
			return "null";
		}
		return String.join(",", localNames);
	}

	public static void printISG(ISupergraph isg) {
		for (Object o : isg) {
			BasicBlockInContext<IExplodedBasicBlock> bb = (BasicBlockInContext<IExplodedBasicBlock>) o;
			SSAInstruction instruction = bb.getDelegate().getInstruction();
		}
	}

	public static Map<MethodReference, List<BasicBlockInContext<IExplodedBasicBlock>>> oldMR2CallSite(
		ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> isg) {
		CallGraph cg = (CallGraph) isg.getProcedureGraph();
		Map<MethodReference, List<BasicBlockInContext<IExplodedBasicBlock>>> result = new HashMap<>();
		for (BasicBlockInContext<IExplodedBasicBlock> bb : isg) {
			SSAInstruction instruction = bb.getDelegate().getInstruction();
			if (instruction instanceof SSAAbstractInvokeInstruction) {
				cg.getPossibleTargets(bb.getNode(), ((SSAAbstractInvokeInstruction) instruction).getCallSite())
					.forEach(t -> {
						MethodReference mr = t.getMethod().getReference();
						List<BasicBlockInContext<IExplodedBasicBlock>> tmpList;
						if (result.containsKey(mr))
							tmpList = result.get(mr);
						else {
							tmpList = new ArrayList<>();
							result.put(mr, tmpList);
						}
						tmpList.add(bb);
					});

			}
		}
		return result;
	}

	public static void exportGraph(IClassHierarchy cha, IAnalysisCacheView cache, CallGraph callgraph) {
		File folder = new File(rootOutputDir() + File.separator + "graphs_java");
		if (folder.exists() && folder.isDirectory()) {
			deleteDir(folder);
		}

		metaInfo = new JSONObject();
		exportCallGraph(callgraph);
		exportClassHierarchy(cha);
		exportCFG(callgraph);
		exportDU(callgraph);

		try {
			String outputFile = graphsOutputDir() + File.separator + "fileInfo.json";
			File file = new File(outputFile);
			Writer write = new OutputStreamWriter(new FileOutputStream(file, true), "UTF-8");
			write.write(formatJson(metaInfo.toString()));
			write.flush();
			write.close();
		} catch (IOException e) {
		}

		Map<String, List<Pair<Integer, String>>> orderMethods = new HashMap<>();
		cha.forEach(clazz -> {
			if (!(clazz.getClassLoader().getReference().equals(ClassLoaderReference.Application)
				|| clazz.getClassLoader().getReference().equals(ClassLoaderReference.Extension)))
				return;
			String filePath = getFilePath(clazz);
			for (IMethod method : clazz.getDeclaredMethods()) {
				try {
					IMethod.SourcePosition beginSP = getSourcePosition(method, 1);
					if (beginSP != null) {
						int beginLine = beginSP.getLastLine();
						List<Pair<Integer, String>> tmpList = orderMethods.get(filePath);
						if (tmpList == null) {
							tmpList = new LinkedList<>();
							orderMethods.put(filePath, tmpList);
						}
						tmpList.add(Pair.make(beginLine, method.getName().toString()));
					}
				} catch (NullPointerException e) {
				}
			}
		});
		JSONObject orderMethodsOut = new JSONObject();
		for (Map.Entry<String, List<Pair<Integer, String>>> entry : orderMethods.entrySet()) {
			String filePath = entry.getKey();
			List<Pair<Integer, String>> tmpList = entry.getValue();
			JSONArray methods = orderMethodsOut.getJSONArray(filePath);
			if (methods == null) {
				methods = new JSONArray();
				orderMethodsOut.put(filePath, methods);
			}
			Collections.sort(tmpList, new Comparator<Pair<Integer, String>>() {
				@Override
				public int compare(Pair<Integer, String> o1, Pair<Integer, String> o2) {
					return o1.fst - o2.fst;
				}
			});
			for (Pair<Integer, String> pair : tmpList) {
				JSONObject method = new JSONObject();
				method.put("line", pair.fst);
				method.put("name", pair.snd);
				methods.add(method);
			}
		}

		try {
			String outputFile = graphsOutputDir() + File.separator + "orderMethods.json";
			File file = new File(outputFile);
			Writer write = new OutputStreamWriter(new FileOutputStream(file, true), "UTF-8");
			write.write(formatJson(orderMethodsOut.toString()));
			write.flush();
			write.close();
		} catch (IOException e) {
		}
	}

	public static void exportDU(CallGraph cg) {
		String outputFile = graphsOutputDir() + File.separator + "DUs.dot";
		BasicGraph<Object> duGraphs = new BasicGraph<>();
		final HashMap<Object, String> labels = HashMapFactory.make();
		cg.forEach(node -> {
			IR ir = node.getIR();
			if (ir == null)
				return;
			DefUse du = node.getDU();
			IMethod method = ir.getMethod();
			if (method.isClinit() || method.isInit() || method.isWalaSynthetic() || method.isSynthetic())
				return;
			for (int i = 1; i <= method.getNumberOfParameters(); i++) {
				String vn = getSourceCodeVariableName(ir, 0, i);
				if (vn.equals("null"))
					continue;
				String pair = method.toString() + "," + vn;
				duGraphs.addNode(pair);
				labels.put(pair, vn);
				Iterator<SSAInstruction> iter = du.getUses(i);
				if (!iter.hasNext())
					continue;
				while (iter.hasNext()) {
					SSAInstruction useInst = iter.next();
					IMethod.SourcePosition sp = getSourcePosition(node.getMethod(), useInst.iIndex());
					if (sp != null) {
						int lineNumber = sp.getLastLine();
						duGraphs.addEdge(pair, lineNumber);
						duGraphs.addNode(lineNumber);
						labels.put(lineNumber, lineNumber + "");
					}
				}
				int lineNumber = 0;
				IMethod.SourcePosition sp = getParaSourcePosition(node.getMethod(), i);
				if (sp == null)
					sp = getSourcePosition(node.getMethod(), 1);
				if (sp != null)
					lineNumber = sp.getLastLine();
				appendMetaInfo(node.getMethod().getDeclaringClass(), "variable", vn, lineNumber, lineNumber, pair);
			}
		});
		try {
			DotUtil.writeDotFile(duGraphs, labels::get, "DefUse", outputFile);
		} catch (WalaException e) {
		}
	}

	public static void exportCFG(CallGraph cg) {
		String outputFile = graphsOutputDir() + File.separator + "CFGs.dot";
		Graph<Object> cfgs = new BasicGraph<>();
		final HashMap<Object, String> labels = HashMapFactory.make();
		cg.forEach(node -> {
			IR ir = node.getIR();
			if (ir == null)
				return;
			IMethod method = ir.getMethod();
			if (!isApplication(method.getDeclaringClass().getClassLoader())) {
				return;
			}
			if (method.isWalaSynthetic() || method.isSynthetic())
				return;
			SSACFG cfg = ir.getControlFlowGraph();
			try {
				Graph<ISSABasicBlock> g = CFGSanitizer.sanitize(ir, ir.getMethod().getClassHierarchy());
				Iterator<ISSABasicBlock> iter = g.iterator();
				while (iter.hasNext()) {
					ISSABasicBlock bb = iter.next();
					cfgs.addNode(bb);
					labels.put(bb, getNodeLabel(ir, bb));
					g.getSuccNodes(bb).forEachRemaining(succ -> {
						cfgs.addEdge(bb, succ);
					});
				}
				cfgs.addNode(node);
				labels.put(node, node.getMethod().getName().toString());
				int beginLine = 0;
				IMethod.SourcePosition beginSP = getSourcePosition(method, 1);
				if (beginSP != null)
					beginLine = beginSP.getLastLine();
				int endLine = 0;
				IMethod.SourcePosition endSP = getLastSourcePosition(node);
				if (endSP != null)
					endLine = endSP.getLastLine();
				appendMetaInfo(node.getMethod().getDeclaringClass(), "method_CFG", method.getName().toString(), beginLine, endLine, node.toString());
				cfgs.addEdge(node, cfg.entry());
			} catch (IllegalArgumentException | WalaException e) {
			}
		});
		try {
			DotUtil.writeDotFile(cfgs, labels::get, null, outputFile);
		} catch (WalaException e) {
		}
	}

	public static String getNodeLabel(IR ir, ISSABasicBlock bb) {
		StringBuilder result = new StringBuilder();
		result.append("BB").append(bb.getNumber());
		if (bb.isEntryBlock()) {
			result.append(" (entry)");
		} else if (bb.isExitBlock()) {
			result.append(" (exit)");
		} else {
			if (bb.iteratePhis().hasNext()) {
				result.append("    ").append("phi");
			}
			SSAInstruction inst = bb.getLastInstruction();
			if (inst != null) {
				IMethod.SourcePosition sp = getSourcePosition(ir.getMethod(), inst.iIndex());
				if (sp != null) {
					result.append("    ").append(sp.getLastLine());
				} else {
					result.append("    ").append(inst.toString());
				}
			}
			if (bb instanceof SSACFG.ExceptionHandlerBasicBlock) {
				SSACFG.ExceptionHandlerBasicBlock ebb = (SSACFG.ExceptionHandlerBasicBlock) bb;
				SSAGetCaughtExceptionInstruction s = ebb.getCatchInstruction();
				if (s != null) {
					IMethod.SourcePosition sp = getSourcePosition(ir.getMethod(), s.iIndex());
					if (sp != null) {
						result.append("    ").append(sp.getLastLine());
					} else {
						result.append("    ").append(s.toString());
					}
				} else {
					result.append("    " + "catch block");
				}
			}
		}
		return result.toString();
	}

	public static <T> Graph<T> pruneGraph(Graph<T> g, Predicate<T> f) {
		Collection<T> slice = GraphSlicer.slice(g, f);
		return GraphSlicer.prune(g, new CollectionFilter<>(slice));
	}

	public static <T> Graph<T> pruneISG(NumberedGraph<T> g, Predicate<T> f) {
		Collection<T> slice = GraphSlicer.slice(g, f);
		return GraphSlicer.prune(g, new CollectionFilter<>(slice));
	}

	public static void exportCallGraph(CallGraph callgraph) {
		String outputFile = graphsOutputDir() + File.separator + "CG.dot";
		Graph<CGNode> g = pruneGraph(callgraph, new Predicate<CGNode>() {
			@Override
			public boolean test(CGNode o) {
				if (o == null)
					return false;
				return o.getMethod().getDeclaringClass().getClassLoader().getReference()
					.equals(ClassLoaderReference.Application)
					|| o.getMethod().getDeclaringClass().getClassLoader().getReference()
					.equals(ClassLoaderReference.Extension);
			}
		});
		Graph<CGNode> cg = new BasicGraph<CGNode>();
		final HashMap<CGNode, String> labels = HashMapFactory.make();
		Iterator<CGNode> iter = g.iterator();
		while (iter.hasNext()) {
			CGNode node = iter.next();
			cg.addNode(node);
			labels.put(node, node.getMethod().getName().toString());
			g.getSuccNodes(node).forEachRemaining(succ -> {
				cg.addEdge(node, succ);
			});
			IMethod method = node.getMethod();
			int beginLine = 0;
			int endLine = 0;
			IMethod.SourcePosition beginSP = getSourcePosition(method, 1);
			if (beginSP != null)
				beginLine = beginSP.getLastLine();
			IMethod.SourcePosition endSP = getLastSourcePosition(node);
			if (endSP != null)
				endLine = endSP.getLastLine();
			appendMetaInfo(node.getMethod().getDeclaringClass(), "method_CG", node.getMethod().getName().toString(), beginLine, endLine, node.toString());
		}
		if (g != null) {
			try {
				DotUtil.writeDotFile(cg, labels::get, "Call Graph", outputFile);
			} catch (WalaException e) {
				e.printStackTrace();
			}
		}
	}

	public static void exportHeapGraph(HeapGraph heapGraph) {
		Graph<CGNode> g = pruneGraph(heapGraph, new Predicate<Object>() {
			@Override
			public boolean test(Object o) {
				if (o == null)
					return false;
				return true;
			}
		});
		if (g != null) {
			try {
				DotUtil.writeDotFile(g, null, null, "heap.dot");
			} catch (WalaException e) {
			}
		}
	}
}
