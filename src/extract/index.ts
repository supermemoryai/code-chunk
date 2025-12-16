import { Effect } from 'effect'
import type { ExtractedEntity, Language, SyntaxNode } from '../types'

/**
 * Error when entity extraction fails
 */
export class ExtractError {
	readonly _tag = 'ExtractError'
	constructor(
		readonly message: string,
		readonly cause?: unknown,
	) {}
}

/**
 * Extract entities from an AST tree
 *
 * @param rootNode - The root node of the AST
 * @param language - The programming language
 * @param code - The source code (for extracting text)
 * @returns Effect yielding extracted entities
 *
 * TODO: Implement entity extraction using tree-sitter queries
 */
export const extractEntities = (
	_rootNode: SyntaxNode,
	_language: Language,
	_code: string,
): Effect.Effect<ExtractedEntity[], ExtractError> => {
	// TODO: Implement entity extraction
	// 1. Load appropriate query for language
	// 2. Run query on AST
	// 3. Extract entities from matches
	// 4. Fall back to node type matching if no query
	return Effect.succeed([])
}

/**
 * Sync version of extractEntities for public API
 */
export const extractEntitiesSync = (
	_rootNode: SyntaxNode,
	_language: Language,
	_code: string,
): ExtractedEntity[] => {
	// TODO: Implement sync wrapper
	return []
}
