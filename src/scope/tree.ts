import type { ByteRange, ExtractedEntity, ScopeNode, ScopeTree } from '../types'

/**
 * Check if outer range fully contains inner range
 *
 * @param outer - The outer byte range
 * @param inner - The inner byte range
 * @returns true if outer fully contains inner
 */
export const rangeContains = (outer: ByteRange, inner: ByteRange): boolean => {
	return outer.start <= inner.start && inner.end <= outer.end
}

/**
 * Create a new scope node from an entity
 *
 * @param entity - The entity for this scope node
 * @param parent - The parent scope node, if any
 * @returns A new scope node
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
 * Find the deepest parent node whose range contains the entity's range
 * Uses DFS to find the most deeply nested container
 *
 * @param roots - Root nodes to search through
 * @param entity - The entity to find a parent for
 * @returns The deepest containing node, or null if none found
 */
export const findParentNode = (
	roots: ScopeNode[],
	entity: ExtractedEntity,
): ScopeNode | null => {
	const findInNode = (node: ScopeNode): ScopeNode | null => {
		// Check if this node's range contains the entity's range
		if (!rangeContains(node.entity.byteRange, entity.byteRange)) {
			return null
		}

		// This node contains the entity, now check children for deeper match
		for (const child of node.children) {
			const deeperMatch = findInNode(child)
			if (deeperMatch) {
				return deeperMatch
			}
		}

		// No child contains it, so this node is the deepest container
		return node
	}

	// Search through all roots
	for (const root of roots) {
		const found = findInNode(root)
		if (found) {
			return found
		}
	}

	return null
}

/**
 * Build a scope tree from extracted entities
 *
 * @param entities - The extracted entities from the AST
 * @returns The scope tree with root nodes, imports, exports, and all entities
 */
export const buildScopeTreeFromEntities = (
	entities: ExtractedEntity[],
): ScopeTree => {
	// Separate imports and exports
	const imports: ExtractedEntity[] = []
	const exports: ExtractedEntity[] = []
	const scopeEntities: ExtractedEntity[] = []

	for (const entity of entities) {
		if (entity.type === 'import') {
			imports.push(entity)
		} else if (entity.type === 'export') {
			exports.push(entity)
		} else {
			scopeEntities.push(entity)
		}
	}

	// Sort remaining entities by byte range start
	const sorted = [...scopeEntities].sort(
		(a, b) => a.byteRange.start - b.byteRange.start,
	)

	// Build tree by processing entities in order
	const root: ScopeNode[] = []

	for (const entity of sorted) {
		// Try to find a parent node that contains this entity
		const parent = findParentNode(root, entity)

		// Create the new scope node
		const node = createScopeNode(entity, parent)

		if (parent) {
			// Add as child of the deepest containing node
			parent.children.push(node)
		} else {
			// No container found, add as new root
			root.push(node)
		}
	}

	return {
		root,
		imports,
		exports,
		allEntities: entities,
	}
}

/**
 * Find the scope node that contains a given byte offset
 *
 * @param tree - The scope tree to search
 * @param offset - The byte offset to find
 * @returns The deepest scope node containing the offset, or null
 */
export const findScopeAtOffset = (
	tree: ScopeTree,
	offset: number,
): ScopeNode | null => {
	const findInNode = (node: ScopeNode): ScopeNode | null => {
		const { byteRange } = node.entity

		// Check if offset is within this node's range
		if (offset < byteRange.start || offset >= byteRange.end) {
			return null
		}

		// Offset is in this node, check children for deeper match
		for (const child of node.children) {
			const deeperMatch = findInNode(child)
			if (deeperMatch) {
				return deeperMatch
			}
		}

		// No child contains it, this node is the deepest
		return node
	}

	// Search through root nodes
	for (const root of tree.root) {
		const found = findInNode(root)
		if (found) {
			return found
		}
	}

	return null
}

/**
 * Get the ancestor chain for a scope node
 *
 * @param node - The scope node
 * @returns Array of ancestor scope nodes (from immediate parent to root)
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
 * @returns Flat array of all scope nodes in DFS order
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
