import { Effect } from 'effect'
import type { Language, SyntaxNode } from '../types'

/**
 * Comment node types by language
 */
export const COMMENT_NODE_TYPES: Record<Language, readonly string[]> = {
	typescript: ['comment', 'multiline_comment'],
	javascript: ['comment', 'multiline_comment'],
	python: ['comment', 'string'], // Python uses string literals as docstrings
	rust: ['line_comment', 'block_comment'],
	go: ['comment'],
	java: ['line_comment', 'block_comment'],
}

/**
 * Extract the docstring/documentation comment for an entity
 *
 * @param node - The AST node representing the entity
 * @param language - The programming language
 * @param code - The source code
 * @returns Effect yielding the docstring, or null if none found
 *
 * TODO: Implement docstring extraction
 */
export const extractDocstring = (
	_node: SyntaxNode,
	_language: Language,
	_code: string,
): Effect.Effect<string | null, never> => {
	// TODO: Implement docstring extraction
	// 1. Look for comment nodes immediately preceding the entity
	// 2. For Python, also check for string literal as first child
	// 3. Parse and clean up the comment format
	return Effect.succeed(null)
}

/**
 * Check if a comment is a documentation comment (JSDoc, docstring, etc.)
 *
 * @param commentText - The raw comment text
 * @param language - The programming language
 * @returns Whether the comment is a documentation comment
 */
export const isDocComment = (
	_commentText: string,
	_language: Language,
): boolean => {
	// TODO: Implement doc comment detection
	// - JSDoc: starts with /**
	// - Python: triple quotes
	// - Rust: starts with /// or //!
	// - Go: starts with //
	// - Java: starts with /**
	return false
}
