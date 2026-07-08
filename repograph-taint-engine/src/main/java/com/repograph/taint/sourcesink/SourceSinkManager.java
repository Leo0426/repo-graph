package com.repograph.taint.sourcesink;

import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.classLoader.ShrikeClass;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.dataflow.IFDS.ISupergraph;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cfg.ExplodedInterproceduralCFG;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.ssa.IR;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SSAPutInstruction;
import com.ibm.wala.ssa.analysis.ExplodedControlFlowGraph;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.util.collections.HashSetMultiMap;
import com.ibm.wala.util.collections.MultiMap;
import com.ibm.wala.util.collections.Pair;
import com.ibm.wala.util.debug.Assertions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URL;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

import static com.repograph.taint.extutil.DFAUtils.isClassInSystemPackage;
import static com.repograph.taint.extutil.DFAUtils.isExtendiableOrOverridableFrom;
import static com.repograph.taint.extutil.DFAUtils.putElementToMap;
import static com.repograph.taint.extutil.FileUtils.iterXMLFile;

public class SourceSinkManager implements Iterable<SourceSinkGroup> {
	// CHECKSTYLE:OFF
	private static final Logger logger = LoggerFactory.getLogger(SourceSinkManager.class);

	private final IClassHierarchy cha;
	private final String kind;
	private final Set<IMethod> publicMethods = new HashSet<>();
	private final Set<CGNode> publicCGNodes = new HashSet<>();
	private final MultiMap<MethodReference, SourceDefinition> mr2SourceDefine = new HashSetMultiMap<>();
	private final MultiMap<FieldReference, FieldSourceDef> fr2SourceDefine = new HashSetMultiMap<>();
	private final MultiMap<MethodReference, SinkDefinition> mr2SinkDefine = new HashSetMultiMap<>();
	private final MultiMap<Pair<MethodReference, Integer>, IindexSinkDefinition> mr2IindexSinkDefine = new HashSetMultiMap<>();
	private final Map<CGNode, Set<BasicBlockInContext<IExplodedBasicBlock>>> mSources = new HashMap<>();
	private final Set<BasicBlockInContext<IExplodedBasicBlock>> mSinks = new HashSet<>();
	private final Set<String> mybatisMapperSinks = new HashSet<>();
	private final Set<String> hibernateSinks = new HashSet<>();
	private final Set<String> springBootSinks = new HashSet<>();
	private int normalSourceCount = 0;
	private int normalSinkCount = 0;
	private boolean hasParameterSource = false;

	public SourceSinkManager(String kind, IClassHierarchy cha, ISourceSinkDefinitionProvider provider,
							 ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> isg) {
		this.kind = kind;
		this.cha = cha;
		this.springBootSinks.addAll(getAllSpringBootSink());
		if (kind.equals("SUMMARY")) {
			collectPublicMethod(cha, isg);
		} else {
			initialize(provider, isg);
		}
	}

	// TODO:  get XML path.
	public static Set<URL> getAllXMLStream() {
		Set<URL> result = new HashSet<>();
		try {
			iterXMLFile(result, "");
		} catch (IOException ignore) {
		}
		return result;
	}

	private void collectPublicMethod(IClassHierarchy cha,
									 ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> isg) {
		cha.getLoader(ClassLoaderReference.Application).iterateAllClasses()
			.forEachRemaining(clazz -> clazz.getDeclaredMethods()
				.forEach(m -> {
					if (m.isPublic()) {
						publicMethods.add(m);
					}
				}));
//		if (GlobalConfig.getConfig().isSearchEntryOfJDK()) {
//			cha.getLoader(ClassLoaderReference.Primordial).iterateAllClasses().forEachRemaining(clazz -> {
//				clazz.getDeclaredMethods().forEach(m -> {
//					if (m.isPublic())
//						publicMethods.add(m);
//				});
//			});
//		}
		isg.getProcedureGraph()
			.forEach(node -> {
				IMethod m = node.getMethod();
				if (publicMethods.contains(m))
					publicCGNodes.add(node);
			});
	}

	public Set<IMethod> getPublicMethods() {
		return publicMethods;
	}

	public Set<CGNode> getPublicCGNodes() {
		return publicCGNodes;
	}

	private Set<String> getMybatisMapperSink() {
//		MybatisMapperCollector mapperCollector = new MybatisMapperCollector(cha, getAllXMLStream());
		Set<String> result = new HashSet<>();
//		mapperCollector.getAllMapper().forEach(mapperData -> {
//			String declClazz = mapperData.getClassStr();
//			TypeReference classType = TypeReference.findOrCreate(ClassLoaderReference.Application,
//				TypeName.string2TypeName(declClazz));
//			IClass clazz = cha.lookupClass(classType);
//			if (clazz != null) {
//				for (IMethod m : clazz.getDeclaredMethods()) {
//					if (m.getName().toString().equals(mapperData.getName())) {
//						MethodReference mr = m.getReference();
//						result.add(mr.getSignature());
//						addSinkDefine(mr, "GENERIC");
//					}
//				}
//			}
//		});
		return result;
	}

	private Set<String> getAllHibernateSink() {
//		Hibernateparser hibernateparser = new Hibernateparser(cha, getAllXMLStream());
		Set<String> result = new HashSet<>();
//		hibernateparser.getClazzNames().forEach(clazzName -> {
//			IClass clazz = cha.lookupClass(TypeReference.findOrCreate(ClassLoaderReference.Application, clazzName));
//			if (clazz != null) {
//				clazz.getDeclaredMethods().forEach(method -> {
//					result.add(method.getSignature());
//					addSinkDefine(method.getReference(), "GENERIC");
//				});
//			}
//		});
		return result;
	}

	private Set<String> getAllSpringBootSink() {
		Set<String> result = new HashSet<>();
		cha.getLoader(ClassLoaderReference.Application)
			.iterateAllClasses().forEachRemaining(clazz -> {
				Collection<? extends IMethod> allMethods = clazz.getAllMethods();
				if (clazz instanceof ShrikeClass) {
					ShrikeClass sclazzClass = (ShrikeClass) clazz;
					if (!sclazzClass.getAllImplementedInterfaces().isEmpty()) {
						Collection<IClass> allImplementedInterfaces = sclazzClass.getAllImplementedInterfaces();
						for (int i = 0; i < allImplementedInterfaces.size(); i++) {
							if (allImplementedInterfaces.getClass().toString().equals("Lorg/springframework/data/jpa/repository/JpaRepository")) {
								clazz.getDeclaredMethods().forEach(method -> {
									if (method.isAbstract()) {
										addSinkDefine(method.getReference(), "GENERIC");
										result.add(method.getSignature());
									}
								});
							}
						}
					}
				}
			});
		return result;
	}

	// CHECKSTYLE:OFF
	private void initialize(
		ISourceSinkDefinitionProvider provider, ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> isg) {
		Set<String> sourceSig = new HashSet<>();
		Set<String> fieldSourceSig = new HashSet<>();
		Set<String> sinkSig = new HashSet<>();
		MultiMap<MethodReference, Integer> mr2index = new HashSetMultiMap<>();

		hasParameterSource = provider.hasParameterSource();
		MultiMap<MethodReference, SourceDefinition> tmpMR2Source = provider.getMR2SourceDefine();
		tmpMR2Source.keySet().forEach(key -> tmpMR2Source.get(key)
			.forEach(value -> {
				if (value.getBelongTo().contains(kind))
					mr2SourceDefine.put(key, value);
			}));
		MultiMap<MethodReference, SinkDefinition> tmpMR2Sink = provider.getMR2SinkDefine();
		tmpMR2Sink.keySet().forEach(key -> tmpMR2Sink.get(key)
			.forEach(value -> {
				if (value.getBelongTo().contains(kind)) {
					mr2SinkDefine.put(key, value);
				}
			}));
		MultiMap<FieldReference, FieldSourceDef> tmpFR2Source = provider.getFR2SourceDefine();
		tmpFR2Source.keySet().forEach(key -> tmpFR2Source.get(key)
			.forEach(value -> {
				if (value.getBelongTo().contains(kind)) {
					fr2SourceDefine.put(key, value);
				}
			}));
		MultiMap<Pair<MethodReference, Integer>, IindexSinkDefinition> tmpMR2IindexSink
			= provider.getMR2IindexSinkDefine();
		tmpMR2IindexSink.keySet()
			.forEach(key -> tmpMR2IindexSink.get(key)
				.forEach(value -> {
					if (value.getBelongTo().contains(kind)) {
						mr2IindexSinkDefine.put(key, value);
					}
				}));

		mr2SourceDefine.keySet().forEach(mr -> sourceSig.add(mr.getSignature()));

		fr2SourceDefine.keySet().forEach(fr -> fieldSourceSig.add(fr.getSignature()));

		mr2SinkDefine.keySet().forEach(mr -> sinkSig.add(mr.getSignature()));

		mr2IindexSinkDefine.keySet().forEach(pair -> mr2index.put(pair.fst, pair.snd));

		if (!mr2index.isEmpty()) {
			ExplodedInterproceduralCFG icfg = ((ICFGSupergraph) isg).getICFG();
			isg.getProcedureGraph().forEach(node -> {
				Set<Integer> indexSet = mr2index.get(node.getMethod().getReference());
				if (!indexSet.isEmpty()) {
					IR ir = node.getIR();
					if (ir == null) {
						return;
					}
					ExplodedControlFlowGraph cfg = (ExplodedControlFlowGraph) icfg.getCFG(node);
					for (SSAInstruction inst : ir.getInstructions()) {
						if (inst == null) {
							continue;
						}
						if (indexSet.contains(inst.iIndex())) {
							mSinks.add(new BasicBlockInContext<>(node, cfg.getBlockForInstruction(inst.iIndex())));
							normalSinkCount++;
						}
					}
				}
			});
		}

		for (BasicBlockInContext<IExplodedBasicBlock> bb : isg) {
			CGNode node = bb.getNode();
			IClass clazz = node.getMethod().getDeclaringClass();
			IClassHierarchy cha = clazz.getClassHierarchy();
			if (isClassInSystemPackage(clazz.getName().toString())
				&& !clazz.getName().toString().equals("Ljava/lang/System")) {
				continue;
			}
			SSAInstruction inst = bb.getDelegate().getInstruction();
			if (inst == null) {
				continue;
			}
			IR ir = node.getIR();
			if (ir == null) {
				continue;
			}
			if (inst instanceof SSAInvokeInstruction) {
				MethodReference mr = ((SSAInvokeInstruction) inst).getDeclaredTarget();
				if (sourceSig.contains(mr.getSignature()) || extendableOrOverridableContain(cha, mr2SourceDefine.keySet(), mr)) {
					normalSourceCount++;
					putElementToMap(mSources, node, bb);
				}
				if (mybatisMapperSinks.contains(mr.getSignature()) || hibernateSinks.contains(mr.getSignature())
					|| sinkSig.contains(mr.getSignature()) || springBootSinks.contains(mr.getSignature())
					|| extendableOrOverridableContain(cha, mr2SinkDefine.keySet(), mr)) {
					mSinks.add(bb);
					normalSinkCount++;
				}
			} else if (inst instanceof SSAPutInstruction) {
				FieldReference field = ((SSAPutInstruction) inst).getDeclaredField();
				if (fieldSourceSig.contains(field.getSignature())) {
					normalSourceCount++;
					putElementToMap(mSources, node, bb);
				}
			}
		}
		logger.info("the number of source: {}", normalSourceCount);
		logger.info("the number of sink: {}", normalSinkCount);

	}

	/*
	 * return true only if 'mrSet' contains a method reference which either extends
	 * or overrides 'mr'.
	 */
	private boolean extendableOrOverridableContain(
		IClassHierarchy cha, Set<MethodReference> mrSet, MethodReference mr) {
		for (MethodReference tmpMR : mrSet) {
			if (isExtendiableOrOverridableFrom(cha, mr, tmpMR)) {
				return true;
			}
		}
		return false;
	}

	public Set<FieldSourceDef> getFieldSourceDef(FieldReference fr) {
		return fr2SourceDefine.get(fr);
	}

	public Set<SourceDefinition> getSourceDefinition(IClassHierarchy cha, MethodReference mr) {
		if (mr2SourceDefine.containsKey(mr)) {
			return mr2SourceDefine.get(mr);
		}

		for (MethodReference key : mr2SourceDefine.keySet()) {
			if (isExtendiableOrOverridableFrom(cha, mr, key))
				return mr2SourceDefine.get(key);
		}
		Assertions.UNREACHABLE();
		return null;
	}

	public Set<Integer> getSourceParaIdx(IClassHierarchy cha, MethodReference mr) {
		Set<Integer> result = new HashSet<>();
		if (mr2SourceDefine.containsKey(mr)) {
			for (SourceDefinition sourceDefinition : mr2SourceDefine.get(mr)) {
				result.add(sourceDefinition.getParaIdx());
			}
			return result;
		}

		for (MethodReference key : mr2SourceDefine.keySet()) {
			if (isExtendiableOrOverridableFrom(cha, mr, key)) {
				for (SourceDefinition sourceDefinition : mr2SourceDefine.get(key)) {
					result.add(sourceDefinition.getParaIdx());
				}
				return result;
			}
		}
		return null;
	}

	public Set<SinkDefinition> getSinkDefinition(IClassHierarchy cha, MethodReference mr) {
		if (mr2SinkDefine.containsKey(mr)) {
			return mr2SinkDefine.get(mr);
		}

		for (MethodReference key : mr2SinkDefine.keySet()) {
			if (isExtendiableOrOverridableFrom(cha, mr, key))
				return mr2SinkDefine.get(key);
		}
		return null;
	}

	@Override
	public Iterator<SourceSinkGroup> iterator() {
		return new Iterator<SourceSinkGroup>() {
			private boolean first = true;
			private int stepCount = -1;
			private Iterator<Set<BasicBlockInContext<IExplodedBasicBlock>>> it1 = mSources.values().iterator();
			private Iterator<BasicBlockInContext<IExplodedBasicBlock>> it2 = null;

			@Override
			public boolean hasNext() {
//				if (first && GlobalConfig.getConfig().isSpringOn()) {
//					first = false;
//					return true;
//				}
				first = false;
				return it2 != null && it2.hasNext() || it1.hasNext();
			}

			@Override
			public SourceSinkGroup next() {
				Set<BasicBlockInContext<IExplodedBasicBlock>> sources = new HashSet<>();
				// no limit to source number.
				if (stepCount < 0) {
					it1.forEachRemaining(sources::addAll);
				} else {
					for (int i = 0; i < stepCount && (it1.hasNext() || (it2 != null && it2.hasNext())); ++i) {
						while (it1.hasNext() && (it2 == null || !it2.hasNext())) {
							it2 = it1.next().iterator();
						}
						if (it2.hasNext()) {
							sources.add(it2.next());
						}
					}
				}
				return new SourceSinkGroup(sources, mSinks);
			}
		};
	}

	public Set<BasicBlockInContext<IExplodedBasicBlock>> getAllSource() {
		Set<BasicBlockInContext<IExplodedBasicBlock>> res = new HashSet<>();
		mSources.values().forEach(res::addAll);
		return res;
	}

	public int getNormalSourceCount() {
		return normalSourceCount;
	}

	public int getNormalSinkCount() {
		return normalSinkCount;
	}

	public boolean hasParameterSource() {
		return hasParameterSource;
	}

	private void addSinkDefine(MethodReference mr, String belongTo) {
		mr2SinkDefine.put(mr, new SinkDefinition(mr, belongTo));
	}

	private void addIindexSinkDefine(MethodReference mr, int iindex, String belongTo) {
		mr2IindexSinkDefine.put(Pair.make(mr, iindex), new IindexSinkDefinition(mr, iindex, belongTo));
	}
}
