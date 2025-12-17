import { Effect } from 'effect'
import type { ExtractedEntity, ScopeTree } from '../types'
import {
	buildScopeTreeFromEntities,
	createScopeNode,
	findParentNode,
	findScopeAtOffset,
	flattenScopeTree,
	getAncestorChain,
	rangeContains,
} from './tree'

/**
 * Error when building scope tree fails
 */
export class ScopeError {
	readonly _tag = 'ScopeError'
	constructor(
		readonly message: string,
		readonly cause?: unknown,
	) {}
}

/**
 * Build a scope tree from extracted entities
 *
 * @param entities - The extracted entities from the AST
 * @returns Effect yielding the scope tree
 */
export const buildScopeTree = (
	entities: ExtractedEntity[],
): Effect.Effect<ScopeTree, ScopeError> => {
	return Effect.try({
		try: () => buildScopeTreeFromEntities(entities),
		catch: (error) =>
			new ScopeError(
				`Failed to build scope tree: ${error instanceof Error ? error.message : String(error)}`,
				error,
			),
	})
}

/**
 * Sync version of buildScopeTree for public API
 * Returns an empty tree on error
 */
export const buildScopeTreeSync = (entities: ExtractedEntity[]): ScopeTree => {
	try {
		return buildScopeTreeFromEntities(entities)
	} catch {
		// Return empty tree on error
		return {
			root: [],
			imports: [],
			exports: [],
			allEntities: entities,
		}
	}
}

// Re-export utilities from tree.ts for public API
export {
	buildScopeTreeFromEntities,
	createScopeNode,
	findParentNode,
	findScopeAtOffset,
	flattenScopeTree,
	getAncestorChain,
	rangeContains,
}
