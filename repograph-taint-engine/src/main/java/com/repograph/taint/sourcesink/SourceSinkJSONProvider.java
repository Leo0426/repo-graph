package com.repograph.taint.sourcesink;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.repograph.taint.api.IContext;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.api.support.JavaFrameworkSupport;
import com.repograph.taint.api.support.SourceFileConfig;
import com.repograph.taint.sourcesink.type.AnySource2AnyArg;
import com.repograph.taint.sourcesink.type.AnySource2CombArgs;
import com.repograph.taint.sourcesink.type.AnySource2SpecialArg;
import com.repograph.taint.sourcesink.type.SpecialSource2AnyArg;
import com.repograph.taint.sourcesink.type.SpecialSource2CombArgs;
import com.repograph.taint.sourcesink.type.SpecialSource2SpecialArg;
import com.repograph.taint.support.framework.spring.util.Utils;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.Descriptor;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.types.TypeName;
import com.ibm.wala.types.TypeReference;
import com.ibm.wala.util.collections.HashSetMultiMap;
import com.ibm.wala.util.collections.MultiMap;
import com.ibm.wala.util.collections.Pair;
import org.apache.commons.io.FileUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.google.common.base.Strings.isNullOrEmpty;
import static java.util.Objects.nonNull;

public class SourceSinkJSONProvider implements ISourceSinkDefinitionProvider {
	private static final Logger LOGGER = LoggerFactory.getLogger(SourceSinkJSONProvider.class);
	private final static String SPRING_SAS = "SpringSAS.json";
	private final MultiMap<MethodReference, SourceDefinition> mr2SourceDefine = new HashSetMultiMap<>();
	private final MultiMap<FieldReference, FieldSourceDef> fr2SourceDefine = new HashSetMultiMap<>();
	private final MultiMap<MethodReference, SinkDefinition> mr2SinkDefine = new HashSetMultiMap<>();
	private final MultiMap<Pair<MethodReference, Integer>, IindexSinkDefinition> mr2IndexSinkDefine = new HashSetMultiMap<>();
	private final Set<IKillDefinition> killDefines = new HashSet<>();
	private boolean hasParameterSource = false;

	/**
	 * 直接从 JSON 内容构建 provider，不依赖 GlobalCache 全局上下文与 Spring/自定义配置扩展。
	 * 供集成测试与 repograph-app 接入使用（调用方自行准备 sources/sinks JSON 内容）。
	 *
	 * @param jsonContent 与 {@code fromFile} 相同 schema 的 sources_and_sinks JSON 文本
	 * @return 仅含该内容中 sources/sinks/kills 的 provider
	 */
	public static SourceSinkJSONProvider fromContent(String jsonContent) {
		SourceSinkJSONProvider sasProvider = new SourceSinkJSONProvider();
		sasProvider.parseContent(jsonContent);
		return sasProvider;
	}

	public static SourceSinkJSONProvider fromFile(String filePath) {

		IContext completeContext = GlobalCache.INSTANCE.get(GlobalCache.DEFAULT_KEY);
		JavaFrameworkSupport javaFrameworkSupport = completeContext.getJavaFrameworkSupport();
		SourceFileConfig sourceFileConfig = completeContext.getSourceFileConfig();

		SourceSinkJSONProvider sasProvider = new SourceSinkJSONProvider();
		File file = new File(filePath);
		String content = null;
		try {
			content = FileUtils.readFileToString(file, StandardCharsets.UTF_8);
		} catch (IOException ignore) {
		}
		sasProvider.parseContent(content);
		sasProvider.handleCustom(sourceFileConfig);

		// if spring enable, then para of controller is source and ModelAndView cannot be sink
		sasProvider.handleSpring(sourceFileConfig);
		return sasProvider;
	}

	private void handleCustom(SourceFileConfig sourceFileConfig) {
		if (nonNull(sourceFileConfig) && !isNullOrEmpty(sourceFileConfig.getCustomConfigPath())) {
			String customConfigPath = sourceFileConfig.getCustomConfigPath();
			File file = new File(customConfigPath);
			XMLDocumentProvider documentProvider = XMLDocumentProvider.getInstance().load(file);
			Set<IKillDefinition> iKillDefinitions = documentProvider.transformKills();
			if (!iKillDefinitions.isEmpty()) {
				killDefines.addAll(iKillDefinitions);
			}

			Set<SourceDefinition> sourceDefinitions = documentProvider.transformSources();
			for (SourceDefinition sourceDefinition : sourceDefinitions) {
				if (sourceDefinition.getParaIdx() > -1) {
					hasParameterSource = true;
				}
				mr2SourceDefine.put(sourceDefinition.getMethodReference(), sourceDefinition);
			}
			Set<FieldSourceDef> fieldSourceDefs = documentProvider.transformFiledSourceDef();
			for (FieldSourceDef fieldSourceDef : fieldSourceDefs) {
				fr2SourceDefine.put(fieldSourceDef.getFieldReference(), fieldSourceDef);
			}

			Set<SinkDefinition> sinkDefinitions = documentProvider.transformSinks();
			for (SinkDefinition sinkDefinition : sinkDefinitions) {
				mr2SinkDefine.put(sinkDefinition.getMethodReference(), sinkDefinition);
			}
		}
	}

	private void handleSpring(SourceFileConfig sourceFileConfig) {
		Path sourcesAndSinksConfigPath = sourceFileConfig.getSourcesAndSinksConfigPath();// spring sas
		Path springSAS = sourcesAndSinksConfigPath.resolve(SPRING_SAS);
		if (springSAS.toFile().exists()) {
			File file = springSAS.toFile();
			String content = null;
			try {
				content = FileUtils.readFileToString(file, StandardCharsets.UTF_8);
			} catch (IOException e) {
				LOGGER.error("Failed to read SpringSAS file", e);
			}
			parseContent(content);
		}

//		String controllerMethods = handleSpringByController();
//		parseContent(controllerMethods);
	}

	private String handleSpringByController() {
		IClassHierarchy cha = GlobalCache.INSTANCE.getDefault().getPropagationTransform().getClassHierarchy();
		List<IMethod> result = new ArrayList<>();
		cha.getLoader(ClassLoaderReference.Application).iterateAllClasses().forEachRemaining(clazz -> {
			if (Utils.isClassInPlatform(clazz.getName().toString())) {
				return;
			}
			if (Utils.hasControllerAnno(clazz)) {
				clazz.getDeclaredMethods()
					.forEach(method -> {
						if (Utils.hasRequestMappingAnno(method)) {
							result.add(method);
						}
					});
			} else {
				clazz.getDeclaredMethods().forEach(method -> {
					if (isHandleRequest(method)) {
						result.add(method);
					}
					if (Utils.hasTestAnno(method)) {
						result.add(method);
					}
				});
			}
		});

		JSONArray sourcesArray = new JSONArray();
		for (IMethod iMethod : result) {
			MethodReference reference = iMethod.getReference();
			JSONObject methodJson = springSourceDefinition(reference);
			sourcesArray.add(methodJson);
		}
		JSONObject springController = new JSONObject();
		springController.put("Sources", sourcesArray);
		return JSON.toJSONString(springController);
	}

	public JSONObject springSourceDefinition(MethodReference mr) {
		String declaringClass = mr.getDeclaringClass().getName().toString();
		String returnType = mr.getReturnType().getName().toString();
		String methodName = mr.getName().toString();
		String tmpString = "";

		for (TypeName parameter : mr.getDescriptor().getParameters()) {
			tmpString = tmpString + parameter.toString() + ",";
		}
		if (!tmpString.isEmpty()) {
			tmpString = tmpString.substring(0, tmpString.length() - 1);
		}
		String paraStr = tmpString;

		JSONObject methodJson = new JSONObject();
		methodJson.put("AnySource2AnyArg", new JSONObject());
		methodJson.put("DeclaringClass", declaringClass);
		methodJson.put("BelongTo", "CWE78");
		methodJson.put("MethodName", methodName);
		methodJson.put("ReturnType", returnType);
		methodJson.put("ArgTypes", paraStr);
		return methodJson;
	}

	private boolean isHandleRequest(IMethod method) {
		String selector = method.getSelector().toString();
		return selector.equals(
			"handleRequest(Ljavax/servlet/http/HttpServletRequest;Ljavax/servlet/http/HttpServletResponse;)Lorg/springframework/web/servlet/ModelAndView;")
			|| selector.equals(
			"handleRequestInternal(Ljavax/servlet/http/HttpServletRequest;Ljavax/servlet/http/HttpServletResponse;)Lorg/springframework/web/servlet/ModelAndView;");
	}

	// CHECKSTYLE:OFF
	private void parseContent(String content) {
		JSONObject sourcesAndSinks = JSONObject.parseObject(content);
		if (sourcesAndSinks.containsKey("Kills")) {
			JSONArray kills = sourcesAndSinks.getJSONArray("Kills");
			for (int i = 0; i < kills.size(); i++) {
				killDefines.add(KillDefinition.fromJSONObject(kills.getJSONObject(i)));
			}
		}
		if (sourcesAndSinks.containsKey("Sources")) {
			JSONArray sources = sourcesAndSinks.getJSONArray("Sources");
			for (int i = 0; i < sources.size(); i++) {
				SourceDefinition sourceDefine = SourceDefinition.fromJSONObject(sources.getJSONObject(i));
				if (sourceDefine.getParaIdx() > -1) {
					hasParameterSource = true;
				}
				mr2SourceDefine.put(sourceDefine.getMethodReference(), sourceDefine);
			}
		}
		if (sourcesAndSinks.containsKey("FieldSources")) {
			JSONArray fieldSources = sourcesAndSinks.getJSONArray("FieldSources");
			for (int i = 0; i < fieldSources.size(); i++) {
				FieldSourceDef fieldSource = FieldSourceDef.fromJSONObject(fieldSources.getJSONObject(i));
				fr2SourceDefine.put(fieldSource.getFieldReference(), fieldSource);
			}
		}
		if (!sourcesAndSinks.containsKey("Sinks")) {
			return;
		}
		JSONArray sinks = sourcesAndSinks.getJSONArray("Sinks");
		for (int i = 0; i < sinks.size(); i++) {
			JSONObject sink = sinks.getJSONObject(i);
			SinkDefinition sinkDefine = SinkDefinition.fromJSONObject(sink);
			mr2SinkDefine.put(sinkDefine.getMethodReference(), sinkDefine);
			if (sink.containsKey("AnySource2AnyArg")) {
				AnySource2AnyArg anySource2AnyArg = new AnySource2AnyArg();
				sinkDefine.addTaintedType(anySource2AnyArg);
			}

			if (sink.containsKey("AnySource2SpecialArg")) {
				List<Integer> tmpList = new ArrayList<>();
				JSONArray indexs = sink.getJSONArray("AnySource2SpecialArg");
				for (int j = 0; j < indexs.size(); j++) {
					JSONObject index = indexs.getJSONObject(j);
					tmpList.add(index.getIntValue("Index"));
				}
				AnySource2SpecialArg anySource2SpecialArg = new AnySource2SpecialArg(tmpList);
				sinkDefine.addTaintedType(anySource2SpecialArg);
			}

			if (sink.containsKey("AnySource2CombArgs")) {
				List<Integer> tmpList = new ArrayList<>();
				JSONArray indexs = sink.getJSONArray("AnySource2CombArgs");
				for (int j = 0; j < indexs.size(); j++) {
					JSONObject index = indexs.getJSONObject(j);
					tmpList.add(index.getIntValue("Index"));
				}
				AnySource2CombArgs anySource2CombArgs = new AnySource2CombArgs(tmpList);
				sinkDefine.addTaintedType(anySource2CombArgs);
			}

			if (sink.containsKey("SpecialSource2AnyArg")) {
				List<SourceDefinition> tmpList = new ArrayList<>();
				JSONArray specSources = sink.getJSONArray("SpecialSource2AnyArg");
				for (int j = 0; j < specSources.size(); j++) {
					JSONObject specSource = specSources.getJSONObject(j);
					String sourceClass = specSource.getString("DeclaringClass");
					String sourceReturnType = specSource.getString("ReturnType");
					String sourceMethodName = specSource.getString("MethodName");
					String sourceArgTypes = specSource.getString("ArgTypes");
					int paraIdx = specSource.containsKey("paraIdx") ? -1 : specSource.getIntValue("paraIdx");
					String belongTo = specSource.getString("BelongTo");
					String bugLevel = specSource.getString("BugLevel");
					SourceDefinition sourceDefine = new SourceDefinition(sourceClass, sourceReturnType,
						sourceMethodName, sourceArgTypes, paraIdx, belongTo, bugLevel);
					tmpList.add(sourceDefine);
				}
				SpecialSource2AnyArg specialSource2AnyArg = new SpecialSource2AnyArg(tmpList);
				sinkDefine.addTaintedType(specialSource2AnyArg);
			}

			if (sink.containsKey("SpecialSource2SpecialArg")) {
				Map<Integer, Set<SourceDefinition>> tmpMap = new HashMap<>();
				JSONArray specArgs = sink.getJSONArray("SpecialSource2SpecialArg");
				for (int j = 0; j < specArgs.size(); j++) {
					JSONObject specArg = specArgs.getJSONObject(j);
					int index = specArg.getIntValue("Index");
					JSONArray specSources = specArg.getJSONArray("Sources");
					Set<SourceDefinition> sourceDefineSet = new HashSet<>();
					for (int k = 0; k < specSources.size(); k++) {
						JSONObject specSource = specSources.getJSONObject(k);
						String sourceClass = specSource.getString("DeclaringClass");
						String sourceReturnType = specSource.getString("ReturnType");
						String sourceMethodName = specSource.getString("MethodName");
						String sourceArgTypes = specSource.getString("ArgTypes");
						int paraIdx = specSource.containsKey("paraIdx") ? -1 : specSource.getIntValue("paraIdx");
						String belongTo = specSource.getString("BelongTo");
						String bugLevel = specSource.getString("BugLevel");
						SourceDefinition sourceDefine = new SourceDefinition(sourceClass, sourceReturnType,
							sourceMethodName, sourceArgTypes, paraIdx, belongTo, bugLevel);
						sourceDefineSet.add(sourceDefine);
					}
					tmpMap.put(index, sourceDefineSet);
				}
				SpecialSource2SpecialArg specialSource2SpecialArg = new SpecialSource2SpecialArg(tmpMap);
				sinkDefine.addTaintedType(specialSource2SpecialArg);
			}

			if (sink.containsKey("SpecialSource2CombArgs")) {
				Map<Integer, Set<SourceDefinition>> tmpMap = new HashMap<>();
				JSONArray specArgs = sink.getJSONArray("SpecialSource2CombArgs");
				for (int j = 0; j < specArgs.size(); j++) {
					JSONObject specArg = specArgs.getJSONObject(j);
					List<Integer> tmpList = new ArrayList<>();
					JSONArray indexs = specArg.getJSONArray("Indexs");
					for (int ii = 0; ii < indexs.size(); ii++) {
						JSONObject index = indexs.getJSONObject(ii);
						tmpList.add(index.getIntValue("Index"));
					}
					JSONArray specSources = specArg.getJSONArray("Sources");
					Set<SourceDefinition> sourceDefineSet = new HashSet<>();
					for (int k = 0; k < specSources.size(); k++) {
						JSONObject specSource = specSources.getJSONObject(k);
						String sourceClass = specSource.getString("DeclaringClass");
						String sourceReturnType = specSource.getString("ReturnType");
						String sourceMethodName = specSource.getString("MethodName");
						String sourceArgTypes = specSource.getString("ArgTypes");
						int paraIdx = specSource.containsKey("paraIdx") ? -1 : specSource.getIntValue("paraIdx");
						String belongTo = specSource.getString("BelongTo");
						String bugLevel = specSource.getString("BugLevel");
						SourceDefinition sourceDefine = new SourceDefinition(sourceClass, sourceReturnType,
							sourceMethodName, sourceArgTypes, paraIdx, belongTo, bugLevel);
						sourceDefineSet.add(sourceDefine);
					}
					tmpList.forEach(index -> {
						tmpMap.put(index, sourceDefineSet);
					});
				}
				SpecialSource2CombArgs specialSource2CombArgs = new SpecialSource2CombArgs(tmpMap);
				sinkDefine.addTaintedType(specialSource2CombArgs);
			}
		}
	}

	@Override
	public MultiMap<MethodReference, SourceDefinition> getMR2SourceDefine() {
		return mr2SourceDefine;
	}

	@Override
	public MultiMap<FieldReference, FieldSourceDef> getFR2SourceDefine() {
		return fr2SourceDefine;
	}

	@Override
	public MultiMap<MethodReference, SinkDefinition> getMR2SinkDefine() {
		return mr2SinkDefine;
	}

	public Set<IKillDefinition> getKills() {
		return killDefines;
	}

	public Set<IKillDefinition> getIindexKills() {
		return killDefines;
	}

	public MethodReference getMRFromJSON(JSONObject object) {
		String declaringClass = object.getString("DeclaringClass");
		String returnType = object.getString("ReturnType");
		String methodName = object.getString("MethodName");
		String paraStr = object.getString("ArgTypes");
		TypeReference classType = TypeReference.findOrCreate(ClassLoaderReference.Primordial,
			TypeName.string2TypeName(declaringClass));
		Atom name = Atom.findOrCreateUnicodeAtom(methodName);
		TypeName[] paraTypes;
		if (paraStr.isEmpty()) {
			paraTypes = null;
		} else {
			String[] argTypes = paraStr.split(",");
			paraTypes = new TypeName[argTypes.length];
			for (int i = 0; i < argTypes.length; i++) {
				paraTypes[i] = TypeName.string2TypeName(argTypes[i].trim());
			}
		}
		Descriptor descriptor = Descriptor.findOrCreate(paraTypes, TypeName.string2TypeName(returnType));
		return MethodReference.findOrCreate(classType, name, descriptor);
	}

	@Override
	public boolean hasParameterSource() {
		return hasParameterSource;
	}

	@Override
	public MultiMap<Pair<MethodReference, Integer>, IindexSinkDefinition> getMR2IindexSinkDefine() {
		return mr2IndexSinkDefine;
	}
}
