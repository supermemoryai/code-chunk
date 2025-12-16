import type { ByteRange, ScopeTree, SiblingInfo } from '../types'

/**
 * Options for sibling retrieval
 */
export interface SiblingOptions {
	/** Level of detail for siblings */
	detail: 'none' | 'names' | 'signatures'
	/** Maximum number of siblings to include on each side */
	maxSiblings?: number
}

/**
 * Get sibling entities for a byte range
 *
 * @param byteRange - The byte range of the current chunk
 * @param scopeTree - The scope tree
 * @param options - Sibling retrieval options
 * @returns Array of sibling info
 *
 * TODO: Implement sibling lookup
 */
export const getSiblings = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
	options: SiblingOptions,
): SiblingInfo[] => {
	// TODO: Implement sibling lookup
	// 1. Find the scope containing this byte range
	// 2. Get sibling entities (same parent scope)
	// 3. Classify as before/after based on byte position
	// 4. Compute distance
	// 5. Limit based on maxSiblings

	if (options.detail === 'none') {
		return []
	}

	void byteRange
	void scopeTree
	return []
}

/**
 * Get siblings before the current chunk
 *
 * @param byteRange - The byte range of the current chunk
 * @param scopeTree - The scope tree
 * @param maxCount - Maximum number of siblings to return
 * @returns Array of sibling info
 */
export const getSiblingsBefore = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
	maxCount: number,
): SiblingInfo[] => {
	// TODO: Implement
	void byteRange
	void scopeTree
	void maxCount
	return []
}

/**
 * Get siblings after the current chunk
 *
 * @param byteRange - The byte range of the current chunk
 * @param scopeTree - The scope tree
 * @param maxCount - Maximum number of siblings to return
 * @returns Array of sibling info
 */
export const getSiblingsAfter = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
	maxCount: number,
): SiblingInfo[] => {
	// TODO: Implement
	void byteRange
	void scopeTree
	void maxCount
	return []
}

/**
 * Check if two entities are siblings (same parent scope)
 *
 * @param byteRange1 - First entity's byte range
 * @param byteRange2 - Second entity's byte range
 * @param scopeTree - The scope tree
 * @returns Whether the entities are siblings
 */
export const areSiblings = (
	byteRange1: ByteRange,
	byteRange2: ByteRange,
	scopeTree: ScopeTree,
): boolean => {
	// TODO: Implement
	void byteRange1
	void byteRange2
	void scopeTree
	return false
}
