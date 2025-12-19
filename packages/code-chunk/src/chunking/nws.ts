import type { SyntaxNode } from '../types'

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
 * Get the NWS count for a node using the precomputed cumulative sum array.
 * This is an O(1) operation.
 *
 * @param node - The AST node
 * @param cumsum - The precomputed cumulative sum array
 * @returns The NWS count for the node
 */
export const getNwsCountForNode = (
	node: SyntaxNode,
	cumsum: NwsCumsum,
): number => {
	return getNwsCountFromCumsum(cumsum, node.startIndex, node.endIndex)
}
