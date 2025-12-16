import { Effect } from 'effect'
import type { ExtractedEntity, Language, SyntaxNode } from '../types'

/**
 * Node types that represent extractable entities by language
 */
export const ENTITY_NODE_TYPES: Record<Language, readonly string[]> = {
	typescript: [
		'function_declaration',
		'method_definition',
		'class_declaration',
		'interface_declaration',
		'type_alias_declaration',
		'enum_declaration',
		'import_statement',
		'export_statement',
	],
	javascript: [
		'function_declaration',
		'method_definition',
		'class_declaration',
		'import_statement',
		'export_statement',
	],
	python: [
		'function_definition',
		'class_definition',
		'import_statement',
		'import_from_statement',
	],
	rust: [
		'function_item',
		'impl_item',
		'struct_item',
		'enum_item',
		'trait_item',
		'type_item',
		'use_declaration',
	],
	go: [
		'function_declaration',
		'method_declaration',
		'type_declaration',
		'import_declaration',
	],
	java: [
		'method_declaration',
		'class_declaration',
		'interface_declaration',
		'enum_declaration',
		'import_declaration',
	],
}

/**
 * Extract entities by matching node types (fallback when no query available)
 *
 * @param rootNode - The root node of the AST
 * @param language - The programming language
 * @param code - The source code
 * @returns Effect yielding extracted entities
 *
 * TODO: Implement node type based extraction
 */
export const extractByNodeTypes = (
	_rootNode: SyntaxNode,
	_language: Language,
	_code: string,
): Effect.Effect<ExtractedEntity[], never> => {
	// TODO: Implement fallback extraction
	// 1. Get node types for language
	// 2. Walk the tree
	// 3. Extract entities for matching nodes
	return Effect.succeed([])
}

/**
 * Check if a node type is an entity type for the given language
 */
export const isEntityNodeType = (
	nodeType: string,
	language: Language,
): boolean => {
	const types = ENTITY_NODE_TYPES[language]
	return types.includes(nodeType)
}
