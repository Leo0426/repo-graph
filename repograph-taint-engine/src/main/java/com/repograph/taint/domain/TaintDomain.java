package com.repograph.taint.domain;

import com.repograph.taint.domain.AbstractDomainElement.Info;
import com.ibm.wala.dataflow.IFDS.PathEdge;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

import java.util.*;
import java.util.stream.Stream;


/**
 * A domain representation for taint analysis, mapping domain elements to unique indices.
 * <p>
 * This class manages the storage, retrieval, and indexing of domain elements used in taint
 * analysis. It ensures that each domain element is assigned a unique index and allows for
 * efficient querying and iteration over all elements.
 *
 * @param <T> The type of domain elements stored in this domain.
 */
public class TaintDomain<T> implements TabulationDomain<T, BasicBlockInContext<IExplodedBasicBlock>> {

	private final Map<T, Integer> table = new HashMap<>();
	private final List<T> objects = new ArrayList<>();

	public TaintDomain(T zero) {
		this.objects.add(zero);
		this.table.put(zero, 0);
	}

	/**
	 * Retrieves the domain object mapped to the specified index.
	 * <p>
	 * This method fetches the domain element associated with a given index. If the index
	 * is invalid (i.e., it is out of range), a {@code NoSuchElementException} is thrown.
	 *
	 * @param n The index of the requested domain object.
	 * @return The domain object associated with the specified index.
	 * @throws NoSuchElementException If the provided index is out of bounds.
	 */
	@Override
	public T getMappedObject(int n) throws NoSuchElementException {
		if (!isValidIndex(n)) {
			throw new NoSuchElementException();
		}
		return objects.get(n);
	}

	/**
	 * Retrieves the mapped index for the specified domain object.
	 * <p>
	 * Pre-condition: The object must implement {@code IDomainElement}.
	 * If the object is not of the correct type, an {@code IllegalArgumentException} is thrown.
	 *
	 * @param o An object implementing {@code IDomainElement}, for which the mapping index is retrieved.
	 * @return The index associated with the given object.
	 * @throws IllegalArgumentException If the object does not implement {@code IDomainElement}.
	 */
	@Override
	public int getMappedIndex(final Object o) {
		if (!(o instanceof IDomainElement)) {
			throw new IllegalArgumentException(o.getClass().getCanonicalName());
		}
		return this.table.get(o);
	}

	/**
	 * Checks whether a given domain object already has a mapped index.
	 * <p>
	 * This method verifies whether the specified object is present in the domain
	 * and has been assigned an index.
	 *
	 * @param o The domain object to check for an existing mapping.
	 * @return {@code true} if the object is already mapped to an index, {@code false} otherwise.
	 */
	public boolean hasMappedIndex(T o) {
		return this.table.containsKey(o);
	}

	/**
	 * Retrieves the maximum index currently mapped to any domain element.
	 * <p>
	 * The maximum index corresponds to the highest index used for the mapped elements
	 * and is derived from the size of the underlying domain list.
	 *
	 * @return The highest index currently assigned to a domain element.
	 */
	@Override
	public int getMaximumIndex() {
		return this.objects.size() - 1;
	}

	/**
	 * Retrieves the total number of objects currently in the domain.
	 *
	 * @return The size of the domain.
	 */
	@Override
	public int getSize() {
		return this.objects.size();
	}

	/**
	 * Adds an element to the domain or merges its data with an existing mapping.
	 * <p>
	 * If the specified object is not already mapped, a new unique index is
	 * generated, and the mapping table is updated. Otherwise, any additional
	 * information associated with the object is merged with the existing element.
	 *
	 * @param o The domain element to add or merge into the domain.
	 * @return The index associated with the element after the operation.
	 */
	@Override
	public int add(T o) {
		Integer i = this.table.get(o);
		if (i == null) {
			i = getMaximumIndex() + 1;
			this.objects.add(o);
			this.table.put(o, i);
		} else {
			AbstractDomainElement oldDE = (AbstractDomainElement) getMappedObject(i);
			List<Info> infos = ((AbstractDomainElement) o).getInfos();
			oldDE.addAllInfo(infos);
		}
		return i;
	}

	/**
	 * Provides an iterator over all the domain objects.
	 *
	 * @return An iterator for the domain objects.
	 */
	@Override
	public Iterator<T> iterator() {
		return objects.iterator();
	}

	/**
	 * Compares two path edges to determine prioritization in the analysis workflow.
	 * <p>
	 * This implementation does not define any prioritization logic, so it always
	 * returns {@code false}.
	 *
	 * @param p1 The first {@code PathEdge} to compare.
	 * @param p2 The second {@code PathEdge} to compare.
	 * @return {@code false} since no priority is applied in this domain.
	 */
	@Override
	public boolean hasPriorityOver(
		PathEdge<BasicBlockInContext<IExplodedBasicBlock>> p1, PathEdge<BasicBlockInContext<IExplodedBasicBlock>> p2) {
		return false;
	}

	/**
	 * Checks whether the given index corresponds to an existing domain element.
	 * <p>
	 * Valid indices range from {@code 0} (inclusive) to the current size of the
	 * domain list (exclusive).
	 *
	 * @param n The index to validate.
	 * @return {@code true} if the index is valid, {@code false} otherwise.
	 */
	public boolean isValidIndex(int n) {
		return n >= 0 && n < objects.size();
	}

	/**
	 * Provides a stream view of the domain elements.
	 *
	 * @return A Stream of the domain elements.
	 */
	@Override
	public Stream<T> stream() {
		return objects.stream();
	}

	/**
	 * Resets the domain by removing all currently mapped objects and their indices.
	 * <p>
	 * This method clears the underlying storage and mapping data structures,
	 * effectively restoring the domain to its initial state.
	 */
	public void cleanup() {
		this.objects.clear();
		this.table.clear();
	}
}
