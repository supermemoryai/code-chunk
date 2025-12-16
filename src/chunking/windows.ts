import type { ASTWindow, SyntaxNode } from '../types'
import type { NwsCountMap } from './nws'

/**
 * Options for window assignment
 */
export interface WindowOptions {
	/** Maximum size of a window in bytes */
	maxSize: number
	/** The precomputed NWS count map */
	nwsMap: NwsCountMap
	/** The source code */
	code: string
}

/**
 * Assign AST nodes to windows using a greedy algorithm
 *
 * @param rootNode - The root AST node
 * @param options - Window assignment options
 * @yields ASTWindow objects
 *
 * TODO: Implement window assignment generator
 */
export function* assignNodesToWindows(
	_rootNode: SyntaxNode,
	_options: WindowOptions,
): Generator<ASTWindow> {
	// TODO: Implement window assignment
	// 1. Walk children of root
	// 2. Accumulate nodes until maxSize is reached
	// 3. Yield window and start new one
	// 4. For oversized nodes, yield them individually (to be split later)
	yield* []
}

/**
 * Check if a node fits within the remaining budget
 *
 * @param node - The node to check
 * @param currentSize - Current window size
 * @param maxSize - Maximum window size
 * @param nwsMap - Precomputed NWS counts
 * @param code - Source code
 * @returns Whether the node fits
 */
export const nodeFitsInWindow = (
	node: SyntaxNode,
	currentSize: number,
	maxSize: number,
	nwsMap: NwsCountMap,
	code: string,
): boolean => {
	// Get NWS count for the node
	const cached = nwsMap.get(node.id)
	const nodeSize =
		cached !== undefined
			? cached
			: code.slice(node.startIndex, node.endIndex).replace(/\s/g, '').length
	return currentSize + nodeSize <= maxSize
}

/**
 * Get ancestors for a set of nodes
 *
 * @param nodes - The nodes to get ancestors for
 * @returns Array of unique ancestor nodes
 */
export const getAncestors = (nodes: SyntaxNode[]): SyntaxNode[] => {
	const ancestorSet = new Set<number>()
	const ancestors: SyntaxNode[] = []

	for (const node of nodes) {
		let current = node.parent
		while (current) {
			if (!ancestorSet.has(current.id)) {
				ancestorSet.add(current.id)
				ancestors.push(current)
			}
			current = current.parent
		}
	}

	return ancestors
}
