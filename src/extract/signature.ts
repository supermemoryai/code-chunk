import { Effect } from 'effect'
import type { EntityType, Language, SyntaxNode } from '../types'

/**
 * Extract the signature of an entity from its AST node
 *
 * @param node - The AST node representing the entity
 * @param entityType - The type of entity
 * @param language - The programming language
 * @param code - The source code
 * @returns Effect yielding the signature string
 *
 * TODO: Implement signature extraction for different entity types
 */
export const extractSignature = (
	_node: SyntaxNode,
	_entityType: EntityType,
	_language: Language,
	_code: string,
): Effect.Effect<string, never> => {
	// TODO: Implement signature extraction
	// Different strategies based on entity type:
	// - function: extract until opening brace/colon
	// - class: extract declaration line
	// - interface/type: extract until opening brace or =
	// - import/export: extract full statement
	return Effect.succeed('')
}

/**
 * Extract the name of an entity from its AST node
 *
 * @param node - The AST node representing the entity
 * @param language - The programming language
 * @returns The entity name, or null if not found
 *
 * TODO: Implement name extraction
 */
export const extractName = (
	_node: SyntaxNode,
	_language: Language,
): string | null => {
	// TODO: Implement name extraction
	// Look for identifier/name child nodes based on language
	return null
}
