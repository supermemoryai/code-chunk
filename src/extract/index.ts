import { Effect } from 'effect'
import type {
	EntityType,
	ExtractedEntity,
	Language,
	SyntaxNode,
} from '../types'
import { extractDocstring } from './docstring'
import {
	ENTITY_NODE_TYPES,
	extractByNodeTypes,
	getEntityType,
} from './fallback'
import { type CompiledQuery, loadQuery, loadQuerySync } from './queries'
import { extractImportSource, extractName, extractSignature } from './signature'

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
 * Interface for query match captures (compatible with future queries.ts implementation)
 */
interface QueryCapture {
	name: string
	node: SyntaxNode
	patternIndex: number
}

/**
 * Interface for query matches (compatible with future queries.ts implementation)
 */
interface QueryMatch {
	patternIndex: number
	captures: QueryCapture[]
}

/**
 * Extract the entity node and name node from a query match
 * This will be provided by queries.ts when merged, but we define it here for now
 */
function extractEntityFromMatch(match: QueryMatch): {
	itemNode: SyntaxNode
	nameNode: SyntaxNode | null
	contextNodes: SyntaxNode[]
	annotationNodes: SyntaxNode[]
} | null {
	const itemCapture = match.captures.find((c) => c.name === 'item')
	if (!itemCapture) {
		return null
	}

	const nameCapture = match.captures.find((c) => c.name === 'name')
	const contextCaptures = match.captures.filter((c) => c.name === 'context')
	const annotationCaptures = match.captures.filter(
		(c) => c.name === 'annotation',
	)

	return {
		itemNode: itemCapture.node,
		nameNode: nameCapture?.node ?? null,
		contextNodes: contextCaptures.map((c) => c.node),
		annotationNodes: annotationCaptures.map((c) => c.node),
	}
}

/**
 * Execute a query against a tree (compatible interface)
 * This will be provided by queries.ts when merged
 */
function executeQueryOnTree(
	query: CompiledQuery,
	rootNode: SyntaxNode,
): { matches: QueryMatch[] } | null {
	// Check if query has a matches method (compiled web-tree-sitter Query)
	if (
		query &&
		typeof query === 'object' &&
		'matches' in query &&
		typeof (query as { matches: unknown }).matches === 'function'
	) {
		try {
			const matches = (
				query as { matches: (node: SyntaxNode) => unknown[] }
			).matches(rootNode)
			const queryMatches: QueryMatch[] = matches.map((match: unknown) => {
				const m = match as {
					patternIndex: number
					captures: { name: string; node: SyntaxNode }[]
				}
				return {
					patternIndex: m.patternIndex,
					captures: m.captures.map((capture) => ({
						name: capture.name,
						node: capture.node,
						patternIndex: m.patternIndex,
					})),
				}
			})
			return { matches: queryMatches }
		} catch {
			return null
		}
	}
	return null
}

/**
 * Convert query matches to extracted entities
 */
function matchesToEntities(
	matches: QueryMatch[],
	language: Language,
	code: string,
	rootNode: SyntaxNode,
): Effect.Effect<ExtractedEntity[], never> {
	return Effect.gen(function* () {
		const entities: ExtractedEntity[] = []
		const processedNodes = new Set<number>()

		for (const match of matches) {
			const extracted = extractEntityFromMatch(match)
			if (!extracted) {
				continue
			}

			const { itemNode, nameNode } = extracted

			// Skip if already processed
			if (processedNodes.has(itemNode.id)) {
				continue
			}
			processedNodes.add(itemNode.id)

			// Get entity type from node type
			let entityType = getEntityType(itemNode.type)
			if (!entityType) {
				// Fallback: try to infer from node type pattern
				entityType = inferEntityType(itemNode.type)
				if (!entityType) {
					continue
				}
			}

			// Extract name - prefer name node from query, fallback to extraction
			const name = nameNode
				? nameNode.text
				: (extractName(itemNode, language) ?? '<anonymous>')

			// Extract signature
			const signature = yield* extractSignature(
				itemNode,
				entityType,
				language,
				code,
			)

			// Extract docstring
			const docstring = yield* extractDocstring(itemNode, language, code)

			// Find parent entity
			const parent = findParentEntityName(itemNode, rootNode, language)

			// Extract import source for import entities
			const source =
				entityType === 'import'
					? (extractImportSource(itemNode, language) ?? undefined)
					: undefined

			const entity: ExtractedEntity = {
				type: entityType,
				name,
				signature: signature || name,
				docstring,
				byteRange: {
					start: itemNode.startIndex,
					end: itemNode.endIndex,
				},
				lineRange: {
					start: itemNode.startPosition.row,
					end: itemNode.endPosition.row,
				},
				parent,
				node: itemNode,
				source,
			}

			entities.push(entity)
		}

		return entities
	})
}

/**
 * Infer entity type from node type string for cases not covered by the map
 */
function inferEntityType(nodeType: string): EntityType | null {
	const lowerType = nodeType.toLowerCase()

	if (lowerType.includes('function') || lowerType.includes('arrow')) {
		return 'function'
	}
	if (lowerType.includes('method')) {
		return 'method'
	}
	if (lowerType.includes('class')) {
		return 'class'
	}
	if (lowerType.includes('interface') || lowerType.includes('trait')) {
		return 'interface'
	}
	if (lowerType.includes('type') || lowerType.includes('struct')) {
		return 'type'
	}
	if (lowerType.includes('enum')) {
		return 'enum'
	}
	if (lowerType.includes('import') || lowerType.includes('use')) {
		return 'import'
	}
	if (lowerType.includes('export')) {
		return 'export'
	}

	return null
}

/**
 * Find the name of the parent entity (if any) by walking up the AST
 */
function findParentEntityName(
	node: SyntaxNode,
	rootNode: SyntaxNode,
	language: Language,
): string | null {
	const entityTypes = ENTITY_NODE_TYPES[language]
	let current = node.parent

	while (current && current.id !== rootNode.id) {
		if (entityTypes.includes(current.type)) {
			// This is a parent entity
			const name = extractName(current, language)
			if (name) {
				return name
			}
		}
		current = current.parent
	}

	return null
}

/**
 * Extract entities from an AST tree
 *
 * Uses tree-sitter queries when available, falling back to node type matching.
 *
 * @param rootNode - The root node of the AST
 * @param language - The programming language
 * @param code - The source code (for extracting text)
 * @returns Effect yielding extracted entities
 */
export const extractEntities = (
	rootNode: SyntaxNode,
	language: Language,
	code: string,
): Effect.Effect<ExtractedEntity[], ExtractError> => {
	return Effect.gen(function* () {
		// Try to load query for this language
		const queryResult = yield* Effect.either(loadQuery(language))

		if (queryResult._tag === 'Right' && queryResult.right !== null) {
			// Query loaded successfully - execute it
			const query = queryResult.right

			const result = executeQueryOnTree(query, rootNode)

			if (result) {
				// Convert matches to entities
				const entities = yield* matchesToEntities(
					result.matches,
					language,
					code,
					rootNode,
				)
				return entities
			}
		}

		// No query available or query loading failed - use fallback extraction
		const entities = yield* extractByNodeTypes(rootNode, language, code)
		return entities
	}).pipe(
		Effect.catchAll((error: unknown) =>
			Effect.fail(
				new ExtractError(
					`Entity extraction failed: ${error instanceof Error ? error.message : String(error)}`,
					error,
				),
			),
		),
	)
}

/**
 * Sync version of extractEntities for public API
 *
 * Note: This function will use query-based extraction if the query is already cached,
 * otherwise it falls back to node type matching. For guaranteed query-based extraction,
 * use extractEntitiesAsync() instead.
 *
 * @param rootNode - The root node of the AST
 * @param language - The programming language
 * @param code - The source code
 * @returns Array of extracted entities
 */
export const extractEntitiesSync = (
	rootNode: SyntaxNode,
	language: Language,
	code: string,
): ExtractedEntity[] => {
	// Try to use cached query if available (loadQuerySync returns cached query or null)
	const cachedQuery = loadQuerySync(language)

	if (cachedQuery) {
		// Query is cached - use it
		const result = executeQueryOnTree(cachedQuery, rootNode)
		if (result) {
			const effect = matchesToEntities(result.matches, language, code, rootNode)
			return Effect.runSync(effect)
		}
	}

	// No cached query - use fallback extraction
	const effect = extractByNodeTypes(rootNode, language, code)
	return Effect.runSync(effect)
}

/**
 * Extract entities async (for when query loading might be needed)
 */
export const extractEntitiesAsync = async (
	rootNode: SyntaxNode,
	language: Language,
	code: string,
): Promise<ExtractedEntity[]> => {
	return Effect.runPromise(extractEntities(rootNode, language, code))
}

// Re-export useful types and functions
export type { EntityType, ExtractedEntity } from '../types'
export { extractDocstring, isDocComment } from './docstring'
export {
	ENTITY_NODE_TYPES,
	extractByNodeTypes,
	getEntityType,
	NODE_TYPE_TO_ENTITY_TYPE,
} from './fallback'
export type { CompiledQuery, QueryLoadError } from './queries'
export { clearQueryCache, loadQuery, loadQuerySync } from './queries'
export { extractImportSource, extractName, extractSignature } from './signature'
