import type { ASTWindow, SyntaxNode } from '../types'
import { getNwsCountFromCumsum, type NwsCumsum } from './nws'
import { subdivideNode } from './oversized'

/**
 * Options for window assignment
 */
export interface WindowOptions {
	/** Maximum size of a window in NWS characters */
	maxSize: number
	/** The precomputed NWS cumulative sum array */
	cumsum: NwsCumsum
	/** The source code */
	code: string
}

/**
 * Assign AST nodes to windows using a greedy algorithm
 *
 * Walks through child nodes, accumulating them into windows until maxSize is reached.
 * When a single node exceeds maxSize, it delegates to subdivideNode for recursive splitting.
 *
 * @param nodes - Iterator/array of nodes to assign to windows
 * @param code - The source code
 * @param cumsum - Precomputed NWS cumulative sum array
 * @param ancestors - Ancestor nodes for context
 * @param maxSize - Maximum window size in NWS characters
 * @yields ASTWindow objects
 */
export function* assignNodesToWindows(
	nodes: Iterable<SyntaxNode>,
	code: string,
	cumsum: NwsCumsum,
	ancestors: SyntaxNode[],
	maxSize: number,
): Generator<ASTWindow> {
	let currentWindow: ASTWindow = {
		nodes: [],
		ancestors: [...ancestors],
		size: 0,
		isPartialNode: false,
	}

	for (const node of nodes) {
		const nodeSize = getNwsCountFromCumsum(
			cumsum,
			node.startIndex,
			node.endIndex,
		)

		// Case 1: Single node exceeds maxSize entirely - subdivide it
		if (nodeSize > maxSize) {
			// First, yield the current window if it has nodes
			if (currentWindow.nodes.length > 0) {
				yield currentWindow
				currentWindow = {
					nodes: [],
					ancestors: [...ancestors],
					size: 0,
					isPartialNode: false,
				}
			}

			// Delegate to subdivideNode for recursive splitting
			yield* subdivideNode(node, code, cumsum, maxSize, ancestors)
			continue
		}

		// Case 2: Node fits in remaining budget - add to current window
		if (currentWindow.size + nodeSize <= maxSize) {
			currentWindow.nodes.push(node)
			currentWindow.size += nodeSize
			continue
		}

		// Case 3: Node exceeds remaining budget - yield current window and start new
		if (currentWindow.nodes.length > 0) {
			yield currentWindow
		}

		// Start a new window with this node
		currentWindow = {
			nodes: [node],
			ancestors: [...ancestors],
			size: nodeSize,
			isPartialNode: false,
		}
	}

	// Yield final window if it has any nodes
	if (currentWindow.nodes.length > 0) {
		yield currentWindow
	}
}

/**
 * Check if a node fits within the remaining budget
 *
 * @param node - The node to check
 * @param currentSize - Current window size
 * @param maxSize - Maximum window size
 * @param cumsum - Precomputed NWS cumulative sum array
 * @returns Whether the node fits
 */
export const nodeFitsInWindow = (
	node: SyntaxNode,
	currentSize: number,
	maxSize: number,
	cumsum: NwsCumsum,
): boolean => {
	const nodeSize = getNwsCountFromCumsum(cumsum, node.startIndex, node.endIndex)
	return currentSize + nodeSize <= maxSize
}

/**
 * Get the NWS size of a node
 *
 * @param node - The node to measure
 * @param cumsum - Precomputed NWS cumulative sum array
 * @returns The NWS character count
 */
export const getNodeSize = (node: SyntaxNode, cumsum: NwsCumsum): number => {
	return getNwsCountFromCumsum(cumsum, node.startIndex, node.endIndex)
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
