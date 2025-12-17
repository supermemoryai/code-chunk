import { findScopeAtOffset } from '../scope/tree'
import type { ByteRange, ScopeNode, ScopeTree, SiblingInfo } from '../types'

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
 * Find the scope node that contains a given byte range
 * Uses the start offset to find the containing scope
 *
 * @param byteRange - The byte range to locate
 * @param scopeTree - The scope tree to search
 * @returns The scope node containing this range, or null
 */
const findScopeForRange = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
): ScopeNode | null => {
	return findScopeAtOffset(scopeTree, byteRange.start)
}

/**
 * Get the siblings array for a scope node
 * If the node has a parent, returns parent's children
 * If the node is a root, returns the root array
 *
 * @param node - The scope node
 * @param scopeTree - The scope tree
 * @returns Array of sibling scope nodes (including the node itself)
 */
const getSiblingNodes = (
	node: ScopeNode,
	scopeTree: ScopeTree,
): ScopeNode[] => {
	if (node.parent) {
		return node.parent.children
	}
	// Node is at root level, siblings are other root nodes
	return scopeTree.root
}

/**
 * Convert a scope node to sibling info
 *
 * @param node - The scope node
 * @param position - Whether it's before or after the current
 * @param distance - Index distance from current
 * @returns SiblingInfo object
 */
const nodeToSiblingInfo = (
	node: ScopeNode,
	position: 'before' | 'after',
	distance: number,
): SiblingInfo => {
	return {
		name: node.entity.name,
		type: node.entity.type,
		position,
		distance,
	}
}

/**
 * Get sibling entities for a byte range
 *
 * @param byteRange - The byte range of the current chunk
 * @param scopeTree - The scope tree
 * @param options - Sibling retrieval options
 * @returns Array of sibling info
 */
export const getSiblings = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
	options: SiblingOptions,
): SiblingInfo[] => {
	// Return empty if no sibling detail requested
	if (options.detail === 'none') {
		return []
	}

	// Find the scope containing this byte range
	const currentNode = findScopeForRange(byteRange, scopeTree)

	// If not found within any scope node, check if we're between root nodes
	// by finding siblings at root level
	const siblings = currentNode
		? getSiblingNodes(currentNode, scopeTree)
		: scopeTree.root

	// Find the current node's index in siblings
	const currentIndex = currentNode ? siblings.indexOf(currentNode) : -1

	const result: SiblingInfo[] = []

	// Collect siblings with their positions and distances
	for (let i = 0; i < siblings.length; i++) {
		const sibling = siblings[i]
		if (!sibling) continue

		// Skip if this is the current node
		if (currentNode && sibling === currentNode) {
			continue
		}

		// Skip if this sibling's range overlaps with our byte range
		// (meaning it contains or is contained by the current range)
		if (
			sibling.entity.byteRange.start < byteRange.end &&
			sibling.entity.byteRange.end > byteRange.start
		) {
			continue
		}

		const position: 'before' | 'after' =
			sibling.entity.byteRange.start < byteRange.start ? 'before' : 'after'

		// Calculate distance as index difference from current position
		// If current node not found in siblings, use byte position to estimate
		const distance =
			currentIndex >= 0
				? Math.abs(i - currentIndex)
				: position === 'before'
					? siblings.length - i
					: i + 1

		result.push(nodeToSiblingInfo(sibling, position, distance))
	}

	// Sort by distance (closest first)
	result.sort((a, b) => a.distance - b.distance)

	// Limit by maxSiblings if specified
	if (options.maxSiblings !== undefined && options.maxSiblings > 0) {
		// Get up to maxSiblings on each side
		const before = result.filter((s) => s.position === 'before')
		const after = result.filter((s) => s.position === 'after')

		const limitedBefore = before.slice(0, options.maxSiblings)
		const limitedAfter = after.slice(0, options.maxSiblings)

		return [...limitedBefore, ...limitedAfter]
	}

	return result
}

/**
 * Get siblings before the current chunk
 *
 * @param byteRange - The byte range of the current chunk
 * @param scopeTree - The scope tree
 * @param maxCount - Maximum number of siblings to return
 * @returns Array of sibling info, sorted by proximity (closest first)
 */
export const getSiblingsBefore = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
	maxCount: number,
): SiblingInfo[] => {
	// Get all siblings
	const allSiblings = getSiblings(byteRange, scopeTree, { detail: 'names' })

	// Filter to only 'before' siblings
	const beforeSiblings = allSiblings.filter((s) => s.position === 'before')

	// Already sorted by proximity from getSiblings
	return beforeSiblings.slice(0, maxCount)
}

/**
 * Get siblings after the current chunk
 *
 * @param byteRange - The byte range of the current chunk
 * @param scopeTree - The scope tree
 * @param maxCount - Maximum number of siblings to return
 * @returns Array of sibling info, sorted by proximity (closest first)
 */
export const getSiblingsAfter = (
	byteRange: ByteRange,
	scopeTree: ScopeTree,
	maxCount: number,
): SiblingInfo[] => {
	// Get all siblings
	const allSiblings = getSiblings(byteRange, scopeTree, { detail: 'names' })

	// Filter to only 'after' siblings
	const afterSiblings = allSiblings.filter((s) => s.position === 'after')

	// Already sorted by proximity from getSiblings
	return afterSiblings.slice(0, maxCount)
}

/**
 * Check if two entities are siblings (same parent scope)
 *
 * @param byteRange1 - First entity's byte range
 * @param byteRange2 - Second entity's byte range
 * @param scopeTree - The scope tree
 * @returns Whether the entities are siblings (have the same parent scope)
 */
export const areSiblings = (
	byteRange1: ByteRange,
	byteRange2: ByteRange,
	scopeTree: ScopeTree,
): boolean => {
	// Find scope nodes containing each byte range
	const node1 = findScopeForRange(byteRange1, scopeTree)
	const node2 = findScopeForRange(byteRange2, scopeTree)

	// If both are null, they're at file level (both top-level)
	if (node1 === null && node2 === null) {
		return true
	}

	// If only one is null, they're at different levels
	if (node1 === null || node2 === null) {
		return false
	}

	// Check if they have the same parent
	// Note: comparing parent references directly
	return node1.parent === node2.parent
}
