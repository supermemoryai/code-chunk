import { Effect } from 'effect'
import type { Language } from '../types'

/**
 * Error when loading a tree-sitter query fails
 */
export class QueryLoadError {
	readonly _tag = 'QueryLoadError'
	constructor(
		readonly language: Language,
		readonly message: string,
		readonly cause?: unknown,
	) {}
}

/**
 * A compiled tree-sitter query
 * TODO: Use actual tree-sitter Query type when implementing
 */
export type CompiledQuery = unknown

/**
 * Load a tree-sitter query for entity extraction
 *
 * @param language - The programming language to load query for
 * @returns Effect yielding the compiled query, or null if no query exists
 *
 * TODO: Implement query loading from .scm files
 */
export const loadQuery = (
	_language: Language,
): Effect.Effect<CompiledQuery | null, QueryLoadError> => {
	// TODO: Implement query loading
	// 1. Look up query file path for language
	// 2. Load .scm file contents
	// 3. Compile query using tree-sitter
	return Effect.succeed(null)
}

/**
 * Query patterns by language
 * TODO: Populate with actual query patterns
 */
export const QUERY_PATTERNS: Partial<Record<Language, string>> = {
	// TODO: Add query patterns for each language
}
