/**
 * code-chunk - AST-aware code chunking for LLMs
 *
 * This library provides intelligent code chunking that preserves semantic
 * context by leveraging tree-sitter for AST parsing. Each chunk includes
 * contextual information about its scope, entities, siblings, and imports.
 *
 * @packageDocumentation
 */

// Batch processing
export {
	chunkBatch,
	chunkBatchEffect,
	chunkBatchStream,
	chunkBatchStreamEffect,
} from './batch'
// Main chunking function
export {
	ChunkingError,
	chunk,
	chunkStream,
	chunkStreamEffect,
	UnsupportedLanguageError,
} from './chunk'

// Chunker factory
export { createChunker } from './chunker'
// Context formatting utility for custom embedding text generation
export { formatChunkWithContext } from './context/format'
export { detectLanguage, LANGUAGE_EXTENSIONS } from './parser/languages'

// All public types
export type {
	ASTWindow,
	BatchFileError,
	BatchFileResult,
	BatchOptions,
	BatchResult,
	ByteRange,
	Chunk,
	ChunkContext,
	ChunkEntityInfo,
	Chunker,
	ChunkOptions,
	EntityInfo,
	EntityType,
	ExtractedEntity,
	FileInput,
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
