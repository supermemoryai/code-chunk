import { Effect } from 'effect'
import type {
	EntityType,
	ExtractedEntity,
	Language,
	SyntaxNode,
} from '../types'
import { extractDocstring } from './docstring'
import { extractImportSource, extractName, extractSignature } from './signature'

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
 * Map node type to EntityType
 */
export const NODE_TYPE_TO_ENTITY_TYPE: Record<string, EntityType> = {
	// Functions
	function_declaration: 'function',
	function_definition: 'function',
	function_item: 'function',
	generator_function_declaration: 'function',
	arrow_function: 'function',

	// Methods
	method_definition: 'method',
	method_declaration: 'method',

	// Classes
	class_declaration: 'class',
	class_definition: 'class',
	abstract_class_declaration: 'class',

	// Interfaces
	interface_declaration: 'interface',
	trait_item: 'interface',

	// Types
	type_alias_declaration: 'type',
	type_item: 'type',
	type_declaration: 'type',
	struct_item: 'type',

	// Enums
	enum_declaration: 'enum',
	enum_item: 'enum',

	// Imports
	import_statement: 'import',
	import_declaration: 'import',
	import_from_statement: 'import',
	use_declaration: 'import',

	// Exports
	export_statement: 'export',

	// Impl blocks (Rust - treat as class-like)
	impl_item: 'class',
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

/**
 * Get EntityType from node type string
 */
export const getEntityType = (nodeType: string): EntityType | null => {
	return NODE_TYPE_TO_ENTITY_TYPE[nodeType] ?? null
}

/**
 * Item in the traversal stack for iterative tree walking
 */
interface StackItem {
	node: SyntaxNode
	parentName: string | null
}

/**
 * Walk the AST iteratively and extract entities by matching node types
 * Uses an explicit stack to avoid stack overflow on deeply nested ASTs
 */
function walkAndExtract(
	rootNode: SyntaxNode,
	language: Language,
	code: string,
	entities: ExtractedEntity[],
	entityNodes: Set<number>,
): Effect.Effect<void, never> {
	return Effect.gen(function* () {
		// Use explicit stack for depth-first traversal
		const stack: StackItem[] = [{ node: rootNode, parentName: null }]

		while (stack.length > 0) {
			const current = stack.pop()
			if (!current) continue
			const { node, parentName } = current

			// Check if this node is an entity type
			if (isEntityNodeType(node.type, language)) {
				// Skip if we've already processed this node
				if (entityNodes.has(node.id)) {
					continue
				}
				entityNodes.add(node.id)

				const entityType = getEntityType(node.type)
				if (entityType) {
					// Extract name
					const name = extractName(node, language) ?? '<anonymous>'

					// Extract signature
					const signature = yield* extractSignature(
						node,
						entityType,
						language,
						code,
					)

					// Extract docstring
					const docstring = yield* extractDocstring(node, language, code)

					// Extract import source for import entities
					const source =
						entityType === 'import'
							? (extractImportSource(node, language) ?? undefined)
							: undefined

					// Create entity
					const entity: ExtractedEntity = {
						type: entityType,
						name,
						signature: signature || name,
						docstring,
						byteRange: {
							start: node.startIndex,
							end: node.endIndex,
						},
						lineRange: {
							start: node.startPosition.row,
							end: node.endPosition.row,
						},
						parent: parentName,
						node,
						source,
					}

					entities.push(entity)

					// For nested entities, use this entity's name as parent
					const newParentName =
						entityType === 'class' ||
						entityType === 'interface' ||
						entityType === 'function' ||
						entityType === 'method'
							? name
							: parentName

					// Add children to stack (in reverse order for correct DFS order)
					const children = node.namedChildren
					for (let i = children.length - 1; i >= 0; i--) {
						const child = children[i]
						if (child) {
							stack.push({ node: child, parentName: newParentName })
						}
					}
				}
			} else {
				// Not an entity node, but might contain entity nodes
				// Add children to stack (in reverse order for correct DFS order)
				const children = node.namedChildren
				for (let i = children.length - 1; i >= 0; i--) {
					const child = children[i]
					if (child) {
						stack.push({ node: child, parentName })
					}
				}
			}
		}
	})
}

/**
 * Extract entities by matching node types (fallback when no query available)
 *
 * @param rootNode - The root node of the AST
 * @param language - The programming language
 * @param code - The source code
 * @returns Effect yielding extracted entities
 */
export const extractByNodeTypes = (
	rootNode: SyntaxNode,
	language: Language,
	code: string,
): Effect.Effect<ExtractedEntity[], never> => {
	return Effect.gen(function* () {
		const entities: ExtractedEntity[] = []
		const entityNodes = new Set<number>()

		// Walk the tree starting from root
		yield* walkAndExtract(rootNode, language, code, entities, entityNodes)

		return entities
	})
}
