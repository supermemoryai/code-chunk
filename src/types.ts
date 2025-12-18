import type Parser from 'web-tree-sitter'

/**
 * Supported programming languages for AST parsing
 */
export type Language =
	| 'typescript'
	| 'javascript'
	| 'python'
	| 'rust'
	| 'go'
	| 'java'

/**
 * Types of entities that can be extracted from source code
 */
export type EntityType =
	| 'function'
	| 'method'
	| 'class'
	| 'interface'
	| 'type'
	| 'enum'
	| 'import'
	| 'export'

/**
 * A range of lines in the source code (0-indexed, inclusive)
 *
 * @example
 * ```ts
 * // First line of file
 * { start: 0, end: 0 }
 * // Lines 1-3 (0-indexed: lines 0, 1, 2)
 * { start: 0, end: 2 }
 * ```
 */
export interface LineRange {
	/** Start line (0-indexed, inclusive) */
	start: number
	/** End line (0-indexed, inclusive) */
	end: number
}

/**
 * A range of bytes in the source code (0-indexed)
 *
 * @example
 * ```ts
 * // Bytes 0-99 (100 bytes total)
 * { start: 0, end: 100 }
 * ```
 */
export interface ByteRange {
	/** Start byte offset (0-indexed, inclusive) */
	start: number
	/** End byte offset (0-indexed, exclusive) */
	end: number
}

/**
 * Error information from parsing
 */
export interface ParseError {
	message: string
	recoverable: boolean
}

/**
 * Result of parsing source code
 */
export interface ParseResult {
	tree: Parser.Tree
	error: ParseError | null
}

/**
 * Re-export Parser types for convenience
 */
export type SyntaxNode = Parser.Node
export type SyntaxTree = Parser.Tree

/**
 * An entity extracted from the AST (function, class, etc.)
 */
export interface ExtractedEntity {
	/** The type of entity */
	type: EntityType
	/** Name of the entity */
	name: string
	/** Full signature (e.g., function signature with params) */
	signature: string
	/** Documentation comment if present */
	docstring: string | null
	/** Byte range in source */
	byteRange: ByteRange
	/** Line range in source */
	lineRange: LineRange
	/** Parent entity name if nested */
	parent: string | null
	/** The underlying AST node */
	node: SyntaxNode
	/** Import source path (only for import entities) */
	source?: string
}

/**
 * A node in the scope tree
 */
export interface ScopeNode {
	/** The entity at this scope level */
	entity: ExtractedEntity
	/** Child scope nodes */
	children: ScopeNode[]
	/** Parent scope node */
	parent: ScopeNode | null
}

/**
 * Tree representing the scope hierarchy of a file
 */
export interface ScopeTree {
	/** Root scope nodes (top-level entities) */
	root: ScopeNode[]
	/** All import entities */
	imports: ExtractedEntity[]
	/** All export entities */
	exports: ExtractedEntity[]
	/** Flat list of all entities */
	allEntities: ExtractedEntity[]
}

/**
 * A window of AST nodes for context
 */
export interface ASTWindow {
	/** The nodes in this window */
	nodes: SyntaxNode[]
	/** Ancestor nodes for context */
	ancestors: SyntaxNode[]
	/** Size of the window in bytes */
	size: number
	/** Whether this window contains a partial node */
	isPartialNode?: boolean
	/** Line ranges for nodes in this window */
	lineRanges?: LineRange[]
}

/**
 * Information about an entity for context
 */
export interface EntityInfo {
	/** Name of the entity */
	name: string
	/** Type of entity */
	type: EntityType
	/** Signature if available */
	signature?: string
}

/**
 * Extended entity info for entities within a chunk
 * Includes additional context like docstring, line range, and partial status
 */
export interface ChunkEntityInfo extends EntityInfo {
	/** Documentation comment if present */
	docstring?: string | null
	/** Line range in source (0-indexed, inclusive) */
	lineRange?: LineRange
	/** Whether this entity spans multiple chunks (is partial) */
	isPartial?: boolean
}

/**
 * Information about a sibling entity
 */
export interface SiblingInfo {
	/** Name of the sibling */
	name: string
	/** Type of sibling */
	type: EntityType
	/** Position relative to current chunk */
	position: 'before' | 'after'
	/** Distance in entities from current chunk */
	distance: number
}

/**
 * Information about an import statement
 */
export interface ImportInfo {
	/** What is being imported */
	name: string
	/** Source module/path */
	source: string
	/** Whether it's a default import */
	isDefault?: boolean
	/** Whether it's a namespace import */
	isNamespace?: boolean
}

/**
 * Context information for a chunk
 */
export interface ChunkContext {
	/** File path of the source file */
	filepath?: string
	/** Programming language of the source */
	language?: Language
	/** Scope information (scope chain from current to root) */
	scope: EntityInfo[]
	/** Entities within this chunk */
	entities: ChunkEntityInfo[]
	/** Nearby sibling entities */
	siblings: SiblingInfo[]
	/** Relevant imports */
	imports: ImportInfo[]
	/** Parse error if any (recoverable) */
	parseError?: ParseError
}

/**
 * A chunk of source code with context
 */
export interface Chunk {
	/** The actual text content */
	text: string
	/**
	 * Text with semantic context prepended for embedding
	 *
	 * Includes file path, scope chain, entity signatures, imports,
	 * and sibling context to improve embedding quality for semantic search.
	 * Use this field when creating embeddings for RAG systems.
	 */
	contextualizedText: string
	/** Byte range in original source */
	byteRange: ByteRange
	/** Line range in original source */
	lineRange: LineRange
	/** Contextual information */
	context: ChunkContext
	/** Index of this chunk (0-based) */
	index: number
	/** Total number of chunks */
	totalChunks: number
}

/**
 * Options for chunking source code
 */
export interface ChunkOptions {
	/** Maximum size of each chunk in bytes (default: 1500) */
	maxChunkSize?: number
	/** How much context to include (default: 'full') */
	contextMode?: 'none' | 'minimal' | 'full'
	/** Level of sibling detail (default: 'signatures') */
	siblingDetail?: 'none' | 'names' | 'signatures'
	/** Whether to filter out import statements (default: false) */
	filterImports?: boolean
	/** Override language detection */
	language?: Language
}

/**
 * Interface for a chunker instance
 */
export interface Chunker {
	/**
	 * Chunk source code into pieces with context
	 * @param filepath The file path (used for language detection)
	 * @param source The source code to chunk
	 * @param options Chunking options
	 * @returns Array of chunks
	 */
	chunk(
		filepath: string,
		source: string,
		options?: ChunkOptions,
	): Promise<Chunk[]>

	/**
	 * Stream chunks as they are generated
	 * @param filepath The file path (used for language detection)
	 * @param source The source code to chunk
	 * @param options Chunking options
	 * @returns Async iterable of chunks
	 */
	stream(
		filepath: string,
		source: string,
		options?: ChunkOptions,
	): AsyncIterable<Chunk>
}
