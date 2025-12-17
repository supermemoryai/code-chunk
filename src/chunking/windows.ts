import type { SyntaxNode } from '../types'

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
