import type { ASTWindow, SyntaxNode } from '../types'
import type { NwsCountMap } from './nws'

/**
 * Options for splitting oversized nodes
 */
export interface SplitOptions {
	/** Maximum size of a chunk in bytes */
	maxSize: number
	/** The precomputed NWS count map */
	nwsMap: NwsCountMap
	/** The source code */
	code: string
}

/**
 * Split an oversized leaf node into multiple windows
 *
 * Used when a node is too large to fit in a single window and cannot
 * be subdivided further (e.g., a very long string literal or comment).
 *
 * @param node - The oversized node
 * @param options - Split options
 * @returns Array of ASTWindow objects representing the split
 *
 * TODO: Implement oversized leaf splitting
 */
export const splitOversizedLeaf = (
	_node: SyntaxNode,
	_options: SplitOptions,
): ASTWindow[] => {
	// TODO: Implement oversized node splitting
	// 1. Get the text of the node
	// 2. Split by lines (or by maxSize chunks)
	// 3. Create windows for each piece
	// 4. Mark as partial nodes
	return []
}

/**
 * Check if a node is oversized
 *
 * @param node - The node to check
 * @param maxSize - Maximum allowed size
 * @param nwsMap - Precomputed NWS counts
 * @param code - Source code
 * @returns Whether the node exceeds maxSize
 */
export const isOversized = (
	node: SyntaxNode,
	maxSize: number,
	nwsMap: NwsCountMap,
	code: string,
): boolean => {
	const cached = nwsMap.get(node.id)
	const nodeSize =
		cached !== undefined
			? cached
			: code.slice(node.startIndex, node.endIndex).replace(/\s/g, '').length
	return nodeSize > maxSize
}

/**
 * Check if a node is a leaf (has no children)
 *
 * @param node - The node to check
 * @returns Whether the node is a leaf
 */
export const isLeafNode = (node: SyntaxNode): boolean => {
	return node.childCount === 0
}

/**
 * Try to subdivide an oversized node into smaller pieces
 *
 * @param node - The oversized node
 * @param options - Split options
 * @yields ASTWindow objects
 *
 * TODO: Implement recursive subdivision
 */
export function* subdivideNode(
	_node: SyntaxNode,
	_options: SplitOptions,
): Generator<ASTWindow> {
	// TODO: Implement recursive subdivision
	// 1. If leaf, use splitOversizedLeaf
	// 2. Otherwise, recursively process children
	// 3. Yield windows from children
	yield* []
}
