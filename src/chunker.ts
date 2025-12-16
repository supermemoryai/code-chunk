import { chunk } from './chunk'
import type { Chunk, Chunker, ChunkOptions } from './types'

/**
 * Default options for the chunker
 */
const DEFAULT_OPTIONS: ChunkOptions = {
	maxChunkSize: 4096,
	contextMode: 'full',
	siblingDetail: 'signatures',
	filterImports: false,
}

/**
 * Implementation of the Chunker interface
 *
 * Provides a stateful wrapper around the chunk function that:
 * - Stores default options
 * - Tracks the filepath for language detection
 */
class ChunkerImpl implements Chunker {
	private readonly filepath: string
	private readonly defaultOptions: ChunkOptions

	constructor(filepath: string, options: ChunkOptions = {}) {
		this.filepath = filepath
		this.defaultOptions = { ...DEFAULT_OPTIONS, ...options }
	}

	/**
	 * Chunk source code into pieces with context
	 *
	 * @param source - The source code to chunk
	 * @param options - Optional overrides for chunking options
	 * @returns Promise resolving to array of chunks
	 */
	async chunk(source: string, options?: ChunkOptions): Promise<Chunk[]> {
		const mergedOptions = { ...this.defaultOptions, ...options }
		return chunk(this.filepath, source, mergedOptions)
	}

	/**
	 * Stream chunks as they are generated
	 *
	 * @param source - The source code to chunk
	 * @param options - Optional overrides for chunking options
	 * @returns Async iterable of chunks
	 *
	 * TODO: Implement true streaming - for now, this just iterates the array
	 */
	async *stream(source: string, options?: ChunkOptions): AsyncIterable<Chunk> {
		const mergedOptions = { ...this.defaultOptions, ...options }
		const chunks = await chunk(this.filepath, source, mergedOptions)

		for (const c of chunks) {
			yield c
		}
	}
}

/**
 * Create a new Chunker instance for a specific file
 *
 * The Chunker provides a convenient interface for chunking source code
 * with pre-configured options. It's particularly useful when you need to
 * chunk multiple versions of the same file or want to stream chunks.
 *
 * @param filepath - The file path (used for language detection)
 * @param options - Default options for all chunking operations
 * @returns A Chunker instance
 *
 * @example
 * ```ts
 * import { createChunker } from 'astchunk'
 *
 * const chunker = createChunker('src/utils.ts', { maxChunkSize: 2048 })
 *
 * // Chunk synchronously
 * const chunks = await chunker.chunk(sourceCode)
 *
 * // Or stream chunks
 * for await (const chunk of chunker.stream(sourceCode)) {
 *   process.stdout.write(chunk.text)
 * }
 * ```
 */
export function createChunker(
	filepath: string,
	options?: ChunkOptions,
): Chunker {
	return new ChunkerImpl(filepath, options)
}

/**
 * Re-export the Chunker type for convenience
 */
export type { Chunker } from './types'
