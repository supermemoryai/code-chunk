import { Effect } from 'effect'
import {
	Query,
	type Language as TSLanguage,
	type QueryCapture as TSQueryCapture,
	type QueryMatch as TSQueryMatch,
} from 'web-tree-sitter'
import { type GrammarLoadError, getLanguageGrammar } from '../parser/languages'
import type { Language, SyntaxNode, SyntaxTree } from '../types'

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
 * Error when executing a query fails
 */
export class QueryExecutionError {
	readonly _tag = 'QueryExecutionError'
	constructor(
		readonly message: string,
		readonly cause?: unknown,
	) {}
}

/**
 * A compiled tree-sitter query
 */
export type CompiledQuery = Query

/**
 * A single capture from a query match
 */
export interface QueryCapture {
	/** The capture name (e.g., "name", "item", "context") */
	name: string
	/** The captured AST node */
	node: SyntaxNode
	/** Pattern index this capture belongs to */
	patternIndex: number
}

/**
 * A complete match from a query, containing all captures from one pattern
 */
export interface QueryMatch {
	/** Pattern index that matched */
	patternIndex: number
	/** All captures from this match */
	captures: QueryCapture[]
}

/**
 * Result of executing a query
 */
export interface QueryResult {
	/** All matches from the query */
	matches: QueryMatch[]
	/** All captures from the query (flat list) */
	captures: QueryCapture[]
}

// =============================================================================
// Embedded Query Strings
// These are embedded at build time for portability - no filesystem access needed
// =============================================================================

const TYPESCRIPT_QUERY = `; TypeScript Entity Extraction Queries
; Adapted from Zed editor's outline.scm
; Uses @name for entity names, @item for full entity node, @context for signature context

; Namespaces/Modules
(internal_module
    "namespace" @context
    name: (_) @name) @item

; Enums
(enum_declaration
    "enum" @context
    name: (_) @name) @item

; Type Aliases
(type_alias_declaration
    "type" @context
    name: (_) @name) @item

; Functions
(function_declaration
    "async"? @context
    "function" @context
    name: (_) @name
    parameters: (formal_parameters
      "(" @context
      ")" @context)) @item

; Generator Functions
(generator_function_declaration
    "async"? @context
    "function" @context
    "*" @context
    name: (_) @name
    parameters: (formal_parameters
      "(" @context
      ")" @context)) @item

; Interfaces
(interface_declaration
    "interface" @context
    name: (_) @name) @item

; Exported variable declarations
(export_statement
    (lexical_declaration
        ["let" "const"] @context
        (variable_declarator
            name: (identifier) @name) @item))

; Top-level variable declarations
(program
    (lexical_declaration
        ["let" "const"] @context
        (variable_declarator
            name: (identifier) @name) @item))

; Classes
(class_declaration
    "class" @context
    name: (_) @name) @item

; Abstract Classes
(abstract_class_declaration
    "abstract" @context
    "class" @context
    name: (_) @name) @item

; Method definitions in classes
(class_body
    (method_definition
        [
            "get"
            "set"
            "async"
            "*"
            "readonly"
            "static"
            (override_modifier)
            (accessibility_modifier)
        ]* @context
        name: (_) @name
        parameters: (formal_parameters
          "(" @context
          ")" @context)) @item)

; Public field definitions
(public_field_definition
    [
        "declare"
        "readonly"
        "abstract"
        "static"
        (accessibility_modifier)
    ]* @context
    name: (_) @name) @item

; Arrow functions assigned to variables (exported)
(export_statement
    (lexical_declaration
        ["let" "const"] @context
        (variable_declarator
            name: (identifier) @name
            value: (arrow_function)) @item))

; Arrow functions assigned to variables (top-level)
(program
    (lexical_declaration
        ["let" "const"] @context
        (variable_declarator
            name: (identifier) @name
            value: (arrow_function)) @item))

; Import declarations
(import_statement) @item

; Export declarations (re-exports)
(export_statement
    (export_clause)) @item
`

const JAVASCRIPT_QUERY = `; JavaScript Entity Extraction Queries
; Adapted from Zed editor's outline.scm
; Uses @name for entity names, @item for full entity node, @context for signature context

; Functions
(function_declaration
    name: (identifier) @name) @item

; Generator Functions
(generator_function_declaration
    name: (identifier) @name) @item

; Classes
(class_declaration
    name: (identifier) @name) @item

; Method definitions in classes
(class_body
    (method_definition
        name: (property_identifier) @name) @item)

; Top-level variable declarations
(program
    (lexical_declaration
        (variable_declarator
            name: (identifier) @name) @item))

; Arrow functions assigned to variables (top-level)
(program
    (lexical_declaration
        (variable_declarator
            name: (identifier) @name
            value: (arrow_function)) @item))

; Import declarations
(import_statement) @item

; Export declarations
(export_statement) @item
`

const PYTHON_QUERY = `; Python Entity Extraction Queries
; Adapted from Zed editor's outline.scm
; Uses @name for entity names, @item for full entity node, @context for signature context

; Decorators (captured for context)
(decorator) @annotation

; Classes
(class_definition
    name: (identifier) @name) @item

; Functions (including async)
(function_definition
    name: (identifier) @name) @item

; Import statements
(import_statement) @item

; Import from statements
(import_from_statement) @item
`

const RUST_QUERY = `; Rust Entity Extraction Queries
; Uses @name for entity names, @item for full entity node

; Structs
(struct_item
    name: (type_identifier) @name) @item

; Enums
(enum_item
    name: (type_identifier) @name) @item

; Traits
(trait_item
    name: (type_identifier) @name) @item

; Impl blocks
(impl_item) @item

; Functions
(function_item
    name: (identifier) @name) @item

; Modules
(mod_item
    name: (identifier) @name) @item

; Type aliases
(type_item
    name: (type_identifier) @name) @item

; Constants
(const_item
    name: (identifier) @name) @item

; Use statements (imports)
(use_declaration) @item
`

const GO_QUERY = `; Go Entity Extraction Queries
; Adapted from Zed editor's outline.scm
; Uses @name for entity names, @item for full entity node, @context for signature context

; Comments (for doc extraction)
(comment) @annotation

; Type declarations
(type_declaration
    "type" @context
    [
        (type_spec
            name: (_) @name) @item
        (
            "("
            (type_spec
                name: (_) @name) @item
            ")"
        )
    ]
)

; Functions
(function_declaration
    "func" @context
    name: (identifier) @name
    parameters: (parameter_list
      "("
      ")")) @item

; Methods
(method_declaration
    "func" @context
    receiver: (parameter_list
        "(" @context
        (parameter_declaration
            name: (_) @context
            type: (_) @context)
        ")" @context)
    name: (field_identifier) @name
    parameters: (parameter_list
      "("
      ")")) @item

; Constants
(const_declaration
    "const" @context
    (const_spec
        name: (identifier) @name) @item)

; Top-level variables
(source_file
    (var_declaration
        "var" @context
        [
            (var_spec
                name: (identifier) @name @item)
            (var_spec_list
                (var_spec
                    name: (identifier) @name @item)
            )
        ]
    )
)

; Interface methods
(method_elem
    name: (_) @name
    parameters: (parameter_list
      "(" @context
      ")" @context)) @item

; Struct fields
(field_declaration
    name: (_) @name @item)

; Import declarations
(import_declaration) @item

; Package declaration
(package_clause
    "package" @context
    (package_identifier) @name) @item
`

const JAVA_QUERY = `; Java Entity Extraction Queries
; Adapted from nvim-treesitter's locals.scm
; Uses @name for entity names, @item for full entity node, @context for signature context

; Package declaration
(package_declaration
    "package" @context
    (scoped_identifier) @name) @item

; Import declarations
(import_declaration) @item

; Classes
(class_declaration
    (modifiers)? @context
    "class" @context
    name: (identifier) @name) @item

; Interfaces
(interface_declaration
    (modifiers)? @context
    "interface" @context
    name: (identifier) @name) @item

; Records (Java 14+)
(record_declaration
    (modifiers)? @context
    "record" @context
    name: (identifier) @name) @item

; Enums
(enum_declaration
    (modifiers)? @context
    "enum" @context
    name: (identifier) @name) @item

; Enum constants
(enum_constant
    name: (identifier) @name) @item

; Annotation types
(annotation_type_declaration
    (modifiers)? @context
    "@interface" @context
    name: (identifier) @name) @item

; Methods
(method_declaration
    (modifiers)? @context
    type: (_) @context
    name: (identifier) @name
    parameters: (formal_parameters
        "(" @context
        ")" @context)) @item

; Constructors
(constructor_declaration
    (modifiers)? @context
    name: (identifier) @name
    parameters: (formal_parameters
        "(" @context
        ")" @context)) @item

; Fields
(field_declaration
    (modifiers)? @context
    type: (_) @context
    declarator: (variable_declarator
        name: (identifier) @name)) @item

; Static initializer blocks
(static_initializer
    "static" @context) @item

; Annotation members (methods in annotations)
(annotation_type_element_declaration
    type: (_) @context
    name: (identifier) @name) @item

; Inner classes
(class_body
    (class_declaration
        (modifiers)? @context
        "class" @context
        name: (identifier) @name) @item)

; Inner interfaces
(class_body
    (interface_declaration
        (modifiers)? @context
        "interface" @context
        name: (identifier) @name) @item)

; Inner enums
(class_body
    (enum_declaration
        (modifiers)? @context
        "enum" @context
        name: (identifier) @name) @item)
`

/**
 * Query patterns by language - embedded as strings for portability
 */
export const QUERY_PATTERNS: Record<Language, string> = {
	typescript: TYPESCRIPT_QUERY,
	javascript: JAVASCRIPT_QUERY,
	python: PYTHON_QUERY,
	rust: RUST_QUERY,
	go: GO_QUERY,
	java: JAVA_QUERY,
}

// =============================================================================
// Query Loading & Caching
// =============================================================================

/**
 * Cache for compiled queries by language
 */
const queryCache: Map<Language, CompiledQuery> = new Map()

/**
 * Compile a query string for a specific language
 *
 * @param language - The programming language
 * @param tsLanguage - The loaded tree-sitter language grammar
 * @param queryString - The query pattern string
 * @returns The compiled Query
 */
function compileQuery(
	language: Language,
	tsLanguage: TSLanguage,
	queryString: string,
): Effect.Effect<CompiledQuery, QueryLoadError> {
	return Effect.try({
		try: () => new Query(tsLanguage, queryString),
		catch: (error: unknown) =>
			new QueryLoadError(
				language,
				`Failed to compile query: ${error instanceof Error ? error.message : String(error)}`,
				error,
			),
	})
}

/**
 * Load a tree-sitter query for entity extraction
 *
 * Loads and compiles the query for the given language. Queries are cached
 * after first compilation.
 *
 * @param language - The programming language to load query for
 * @returns Effect yielding the compiled query, or null if no query exists for the language
 */
export const loadQuery = (
	language: Language,
): Effect.Effect<CompiledQuery | null, QueryLoadError | GrammarLoadError> => {
	return Effect.gen(function* () {
		// Check cache first
		const cached = queryCache.get(language)
		if (cached) {
			return cached
		}

		// Get the query pattern for this language
		const queryPattern = QUERY_PATTERNS[language]
		if (!queryPattern) {
			return null
		}

		// Load the language grammar
		const tsLanguage = yield* getLanguageGrammar(language)

		// Compile the query
		const query = yield* compileQuery(language, tsLanguage, queryPattern)

		// Cache for future use
		queryCache.set(language, query)

		return query
	})
}

/**
 * Load a query (public async API)
 *
 * @param language - The language to load the query for
 * @returns Promise resolving to the compiled query, or null if no query exists
 */
export async function loadQueryAsync(
	language: Language,
): Promise<CompiledQuery | null> {
	return Effect.runPromise(loadQuery(language))
}

/**
 * Clear the query cache (useful for testing)
 */
export function clearQueryCache(): void {
	queryCache.clear()
}

/**
 * Synchronously load a cached query
 *
 * This only returns a query if it's already been compiled and cached.
 * Use this for sync code paths where you can't await query loading.
 *
 * @param language - The language to get the cached query for
 * @returns The cached query, or null if not cached
 */
export function loadQuerySync(language: Language): CompiledQuery | null {
	return queryCache.get(language) ?? null
}

// =============================================================================
// Query Execution
// =============================================================================

/**
 * Execute a query against a syntax tree
 *
 * @param query - The compiled query to execute
 * @param tree - The syntax tree to query
 * @param startNode - Optional node to start querying from (defaults to root)
 * @returns Effect yielding the query result with matches and captures
 */
export const executeQuery = (
	query: CompiledQuery,
	tree: SyntaxTree,
	startNode?: SyntaxNode,
): Effect.Effect<QueryResult, QueryExecutionError> => {
	return Effect.try({
		try: () => {
			const node = startNode ?? tree.rootNode

			// Execute the query and get all matches
			const matches = query.matches(node)

			// Convert to our QueryMatch format
			const queryMatches: QueryMatch[] = matches.map((match: TSQueryMatch) => ({
				patternIndex: match.patternIndex,
				captures: match.captures.map((capture: TSQueryCapture) => ({
					name: capture.name,
					node: capture.node,
					patternIndex: match.patternIndex,
				})),
			}))

			// Also collect all captures as a flat list
			const allCaptures: QueryCapture[] = queryMatches.flatMap(
				(match) => match.captures,
			)

			return {
				matches: queryMatches,
				captures: allCaptures,
			}
		},
		catch: (error: unknown) =>
			new QueryExecutionError(
				`Query execution failed: ${error instanceof Error ? error.message : String(error)}`,
				error,
			),
	})
}

/**
 * Execute a query and get captures (public async API)
 *
 * @param query - The compiled query to execute
 * @param tree - The syntax tree to query
 * @param startNode - Optional node to start querying from
 * @returns Promise resolving to the query result
 */
export async function executeQueryAsync(
	query: CompiledQuery,
	tree: SyntaxTree,
	startNode?: SyntaxNode,
): Promise<QueryResult> {
	return Effect.runPromise(executeQuery(query, tree, startNode))
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get all captures with a specific name from a query result
 *
 * @param result - The query result
 * @param captureName - The capture name to filter by (e.g., "name", "item")
 * @returns Array of captures matching the name
 */
export function getCapturesByName(
	result: QueryResult,
	captureName: string,
): QueryCapture[] {
	return result.captures.filter((capture) => capture.name === captureName)
}

/**
 * Get all matches that have an "item" capture (entity nodes)
 *
 * @param result - The query result
 * @returns Array of matches that contain entity items
 */
export function getEntityMatches(result: QueryResult): QueryMatch[] {
	return result.matches.filter((match) =>
		match.captures.some((capture) => capture.name === 'item'),
	)
}

/**
 * Extract the entity node and name node from a match
 *
 * @param match - A query match
 * @returns Object with item and name nodes, or null if not found
 */
export function extractEntityFromMatch(match: QueryMatch): {
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
 * Check if a language has a query available
 *
 * @param language - The language to check
 * @returns True if a query is available for the language
 */
export function hasQueryForLanguage(language: Language): boolean {
	return language in QUERY_PATTERNS
}
