import { chunk as chunkFn, chunkStream as streamFn } from './chunk'
import { DEFAULT_CHUNK_OPTIONS } from './chunking'
import type { Chunk, Chunker, ChunkOptions } from './types'

/**
 * Implementation of the Chunker interface
 *
 * Provides a stateful wrapper around the chunk and stream functions that
 * stores default options and allows per-call overrides.
 */
class ChunkerImpl implements Chunker {
	private readonly defaultOptions: ChunkOptions

	constructor(options: ChunkOptions = {}) {
		this.defaultOptions = { ...DEFAULT_CHUNK_OPTIONS, ...options }
	}

	/**
	 * Chunk source code into pieces with context
	 *
	 * @param filepath - The file path (used for language detection)
	 * @param code - The source code to chunk
	 * @param options - Optional overrides for chunking options
	 * @returns Promise resolving to array of chunks
	 */
	async chunk(
		filepath: string,
		code: string,
		options?: ChunkOptions,
	): Promise<Chunk[]> {
		const mergedOptions = { ...this.defaultOptions, ...options }
		return chunkFn(filepath, code, mergedOptions)
	}

	/**
	 * Stream chunks as they are generated
	 *
	 * @param filepath - The file path (used for language detection)
	 * @param code - The source code to chunk
	 * @param options - Optional overrides for chunking options
	 * @returns Async iterable of chunks
	 */
	async *stream(
		filepath: string,
		code: string,
		options?: ChunkOptions,
	): AsyncIterable<Chunk> {
		const mergedOptions = { ...this.defaultOptions, ...options }
		yield* streamFn(filepath, code, mergedOptions)
	}
}

/**
 * Create a new Chunker instance with default options
 *
 * The Chunker provides a convenient interface for chunking source code
 * with pre-configured options. It's particularly useful when you need to
 * chunk multiple files with the same configuration.
 *
 * @param options - Default options for all chunking operations
 * @returns A Chunker instance
 *
 * @example
 * ```ts
 * import { createChunker } from 'astchunk'
 *
 * const chunker = createChunker({ maxChunkSize: 2048 })
 *
 * // Chunk synchronously
 * const chunks = await chunker.chunk('src/utils.ts', sourceCode)
 *
 * // Or stream chunks
 * for await (const chunk of chunker.stream('src/utils.ts', sourceCode)) {
 *   process.stdout.write(chunk.text)
 * }
 * ```
 */
export function createChunker(options?: ChunkOptions): Chunker {
	return new ChunkerImpl(options)
}
