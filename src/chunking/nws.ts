import type { SyntaxNode } from '../types'

/**
 * Map from node ID to non-whitespace character count
 */
export type NwsCountMap = Map<number, number>

/**
 * Cumulative sum array for O(1) NWS range queries
 * cumsum[i] = count of non-whitespace chars in code[0..i-1]
 */
export type NwsCumsum = Uint32Array

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
 * Preprocess code to build a cumulative sum array for O(1) NWS range queries
 *
 * The resulting array has length = code.length + 1
 * cumsum[i] = count of non-whitespace characters in code[0..i-1]
 * This allows O(1) range queries: count(start, end) = cumsum[end] - cumsum[start]
 *
 * @param code - The source code
 * @returns Cumulative sum array
 */
export const preprocessNwsCumsum = (code: string): NwsCumsum => {
	const cumsum = new Uint32Array(code.length + 1)
	// cumsum[0] is already 0 by default for Uint32Array
	let count = 0
	for (let i = 0; i < code.length; i++) {
		// Characters with code point <= 32 are whitespace (space, tab, newline, CR, etc.)
		const isWhitespace = code.charCodeAt(i) <= 32
		if (!isWhitespace) {
			count++
		}
		cumsum[i + 1] = count
	}
	return cumsum
}

/**
 * Get the NWS count for a range using the precomputed cumulative sum array
 * This is an O(1) operation.
 *
 * @param cumsum - The precomputed cumulative sum array
 * @param start - Start index (inclusive)
 * @param end - End index (exclusive)
 * @returns The NWS count for the range [start, end)
 */
export const getNwsCountFromCumsum = (
	cumsum: NwsCumsum,
	start: number,
	end: number,
): number => {
	// biome-ignore lint/style/noNonNullAssertion: indices are guaranteed to be within bounds when used correctly
	return cumsum[end]! - cumsum[start]!
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
