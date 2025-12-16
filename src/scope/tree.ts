import type { ExtractedEntity, ScopeNode, ScopeTree } from '../types'

/**
 * Create a new scope node from an entity
 *
 * @param entity - The entity for this scope node
 * @param parent - The parent scope node, if any
 * @returns A new scope node
 *
 * TODO: Implement scope node creation
 */
export const createScopeNode = (
	entity: ExtractedEntity,
	parent: ScopeNode | null = null,
): ScopeNode => {
	return {
		entity,
		children: [],
		parent,
	}
}

/**
 * Find the scope node that contains a given byte offset
 *
 * @param tree - The scope tree to search
 * @param offset - The byte offset to find
 * @returns The scope node containing the offset, or null
 *
 * TODO: Implement scope lookup
 */
export const findScopeAtOffset = (
	tree: ScopeTree,
	offset: number,
): ScopeNode | null => {
	// TODO: Implement scope lookup
	// 1. Search through root nodes
	// 2. Recursively search children if offset is within range
	// 3. Return deepest matching scope
	void tree
	void offset
	return null
}

/**
 * Get the ancestor chain for a scope node
 *
 * @param node - The scope node
 * @returns Array of ancestor scope nodes (from immediate parent to root)
 *
 * TODO: Implement ancestor chain extraction
 */
export const getAncestorChain = (node: ScopeNode): ScopeNode[] => {
	const ancestors: ScopeNode[] = []
	let current = node.parent
	while (current) {
		ancestors.push(current)
		current = current.parent
	}
	return ancestors
}

/**
 * Flatten a scope tree into a list of all scope nodes
 *
 * @param tree - The scope tree
 * @returns Flat array of all scope nodes
 *
 * TODO: Implement tree flattening
 */
export const flattenScopeTree = (tree: ScopeTree): ScopeNode[] => {
	const result: ScopeNode[] = []
	const visit = (node: ScopeNode) => {
		result.push(node)
		for (const child of node.children) {
			visit(child)
		}
	}
	for (const root of tree.root) {
		visit(root)
	}
	return result
}
