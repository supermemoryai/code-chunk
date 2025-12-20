import {
	chunkBatch as batchFn,
	chunkBatchStream as batchStreamFn,
} from './batch'
import { chunk as chunkFn, chunkStream as streamFn } from './chunk'
import { DEFAULT_CHUNK_OPTIONS } from './chunking'
import type {
	BatchOptions,
	BatchResult,
	Chunk,
	Chunker,
	ChunkOptions,
	FileInput,
} from './types'

class ChunkerImpl implements Chunker {
	private readonly defaultOptions: ChunkOptions

	constructor(options: ChunkOptions = {}) {
		this.defaultOptions = { ...DEFAULT_CHUNK_OPTIONS, ...options }
	}

	async chunk(
		filepath: string,
		code: string,
		options?: ChunkOptions,
	): Promise<Chunk[]> {
		const mergedOptions = { ...this.defaultOptions, ...options }
		return chunkFn(filepath, code, mergedOptions)
	}

	async *stream(
		filepath: string,
		code: string,
		options?: ChunkOptions,
	): AsyncIterable<Chunk> {
		const mergedOptions = { ...this.defaultOptions, ...options }
		yield* streamFn(filepath, code, mergedOptions)
	}

	async chunkBatch(
		files: FileInput[],
		options?: BatchOptions,
	): Promise<BatchResult[]> {
		const mergedOptions = { ...this.defaultOptions, ...options }
		return batchFn(files, mergedOptions)
	}

	async *chunkBatchStream(
		files: FileInput[],
		options?: BatchOptions,
	): AsyncGenerator<BatchResult> {
		const mergedOptions = { ...this.defaultOptions, ...options }
		yield* batchStreamFn(files, mergedOptions)
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
 * import { createChunker } from 'code-chunk'
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
