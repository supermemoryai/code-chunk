import type { SyntaxNode } from '../types'

/**
 * Check if a node is a leaf (has no children)
 *
 * @param node - The node to check
 * @returns Whether the node is a leaf
 */
export const isLeafNode = (node: SyntaxNode): boolean => {
	return node.childCount === 0
}
