import type { SyntaxNode } from '../types'

/**
 * Map from node ID to non-whitespace character count
 */
export type NwsCountMap = Map<number, number>

/**
 * Count non-whitespace characters in a string
 *
 * @param text - The text to count
 * @returns Number of non-whitespace characters
 */
export const countNws = (text: string): number => {
	// More efficient than per-character regex
	return text.length - (text.match(/\s/g)?.length ?? 0)
}

/**
 * Preprocess the AST to compute NWS counts for all nodes
 *
 * @param rootNode - The root AST node
 * @param code - The source code
 * @returns Map from node ID to NWS count
 *
 * TODO: Implement NWS preprocessing with memoization
 */
export const preprocessNwsCount = (
	rootNode: SyntaxNode,
	code: string,
): NwsCountMap => {
	// TODO: Implement NWS count preprocessing
	// 1. Walk the tree
	// 2. For each node, compute NWS count of its text
	// 3. Store in map keyed by node ID
	const map: NwsCountMap = new Map()
	void rootNode
	void code
	return map
}

/**
 * Get the NWS count for a node from the precomputed map
 *
 * @param node - The AST node
 * @param nwsMap - The precomputed NWS count map
 * @param code - The source code (fallback if not in map)
 * @returns The NWS count for the node
 */
export const getNwsCount = (
	node: SyntaxNode,
	nwsMap: NwsCountMap,
	code: string,
): number => {
	// Try to get from map first
	const cached = nwsMap.get(node.id)
	if (cached !== undefined) {
		return cached
	}
	// Fallback: compute directly
	const text = code.slice(node.startIndex, node.endIndex)
	return countNws(text)
}
