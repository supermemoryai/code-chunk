/**
 * astchunk - AST-aware code chunking for LLMs
 *
 * This library provides intelligent code chunking that preserves semantic
 * context by leveraging tree-sitter for AST parsing. Each chunk includes
 * contextual information about its scope, entities, siblings, and imports.
 *
 * @packageDocumentation
 */

// Main chunking function
export {
	ChunkingError,
	chunk,
	chunkStream,
	UnsupportedLanguageError,
} from './chunk'

// Chunker factory
export { createChunker } from './chunker'

// Re-export language utilities for advanced usage
export { detectLanguage, LANGUAGE_EXTENSIONS } from './parser/languages'

// All public types
export type {
	ASTWindow,
	ByteRange,
	Chunk,
	ChunkContext,
	ChunkEntityInfo,
	Chunker,
	ChunkOptions,
	EntityInfo,
	EntityType,
	ExtractedEntity,
	ImportInfo,
	Language,
	LineRange,
	ParseError,
	ParseResult,
	ScopeNode,
	ScopeTree,
	SiblingInfo,
	SyntaxNode,
	SyntaxTree,
} from './types'
