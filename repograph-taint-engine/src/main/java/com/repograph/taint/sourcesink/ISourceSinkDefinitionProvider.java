package com.repograph.taint.sourcesink;

import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.util.collections.MultiMap;
import com.ibm.wala.util.collections.Pair;

import java.util.Set;

/**
 * Common interface for all classes that support loading source and sink
 * definitions
 *
 * @author Steven Arzt
 */
public interface ISourceSinkDefinitionProvider {

	/**
	 * Gets Method reference set of all sources registered in the provider
	 *
	 * @return A set of all sources registered in the provider
	 */
	MultiMap<MethodReference, SourceDefinition> getMR2SourceDefine();

	/**
	 * Gets Method reference set of all sinks registered in the provider
	 *
	 * @return A set of all sinks registered in the provider
	 */
	MultiMap<MethodReference, SinkDefinition> getMR2SinkDefine();

	MultiMap<Pair<MethodReference, Integer>, IindexSinkDefinition> getMR2IindexSinkDefine();

	Set<IKillDefinition> getKills();

	boolean hasParameterSource();

	MultiMap<FieldReference, FieldSourceDef> getFR2SourceDefine();

}
