import { Effect } from 'effect'
import {
	chunk as chunkInternal,
	DEFAULT_CHUNK_OPTIONS,
	streamChunks as streamChunksInternal,
} from './chunking'
import { extractEntities } from './extract'
import { detectLanguage } from './parser/languages'
import { WasmParser } from './parser/wasm'
import { buildScopeTree } from './scope'
import type {
	BatchOptions,
	BatchResult,
	Chunk,
	Chunker,
	ChunkOptions,
	FileInput,
	Language,
	WasmConfig,
} from './types'

export { formatChunkWithContext } from './context/format'
export { detectLanguage, LANGUAGE_EXTENSIONS } from './parser/languages'
export {
	createWasmParser,
	WasmGrammarError,
	WasmParser,
	WasmParserError,
} from './parser/wasm'
export type {
	BatchFileError,
	BatchFileResult,
	BatchOptions,
	BatchResult,
	Chunk,
	ChunkContext,
	ChunkEntityInfo,
	Chunker,
	ChunkOptions,
	EntityInfo,
	EntityType,
	FileInput,
	ImportInfo,
	Language,
	LineRange,
	SiblingInfo,
	WasmBinary,
	WasmConfig,
} from './types'

export class WasmChunkingError extends Error {
	readonly _tag = 'WasmChunkingError'
	override readonly cause?: unknown

	constructor(message: string, cause?: unknown) {
		super(message)
		this.name = 'WasmChunkingError'
		this.cause = cause
	}
}

export class UnsupportedLanguageError extends Error {
	readonly _tag = 'UnsupportedLanguageError'
	readonly filepath: string

	constructor(filepath: string) {
		super(`Unsupported file type: ${filepath}`)
		this.name = 'UnsupportedLanguageError'
		this.filepath = filepath
	}
}

class WasmChunker implements Chunker {
	private parser: WasmParser
	private defaultOptions: ChunkOptions

	constructor(parser: WasmParser, options: ChunkOptions = {}) {
		this.parser = parser
		this.defaultOptions = { ...DEFAULT_CHUNK_OPTIONS, ...options }
	}

	async chunk(
		filepath: string,
		code: string,
		options?: ChunkOptions,
	): Promise<Chunk[]> {
		const opts = { ...this.defaultOptions, ...options }
		const language: Language | null = opts.language ?? detectLanguage(filepath)

		if (!language) {
			throw new UnsupportedLanguageError(filepath)
		}

		const parseResult = await this.parser.parse(code, language)

		const entities = await Effect.runPromise(
			Effect.mapError(
				extractEntities(parseResult.tree.rootNode, language, code),
				(error: unknown) =>
					new WasmChunkingError('Failed to extract entities', error),
			),
		)

		const scopeTree = await Effect.runPromise(
			Effect.mapError(
				buildScopeTree(entities),
				(error: unknown) =>
					new WasmChunkingError('Failed to build scope tree', error),
			),
		)

		const chunks = await Effect.runPromise(
			Effect.mapError(
				chunkInternal(
					parseResult.tree.rootNode,
					code,
					scopeTree,
					language,
					opts,
					filepath,
				),
				(error: unknown) =>
					new WasmChunkingError('Failed to chunk code', error),
			),
		)

		if (parseResult.error) {
			return chunks.map((c: Chunk) => ({
				...c,
				context: {
					...c.context,
					parseError: parseResult.error ?? undefined,
				},
			}))
		}

		return chunks
	}

	async *stream(
		filepath: string,
		code: string,
		options?: ChunkOptions,
	): AsyncIterable<Chunk> {
		const opts = { ...this.defaultOptions, ...options }
		const language: Language | null = opts.language ?? detectLanguage(filepath)

		if (!language) {
			throw new UnsupportedLanguageError(filepath)
		}

		const parseResult = await this.parser.parse(code, language)

		const entities = await Effect.runPromise(
			extractEntities(parseResult.tree.rootNode, language, code),
		)

		const scopeTree = await Effect.runPromise(buildScopeTree(entities))

		const chunkGenerator = streamChunksInternal(
			parseResult.tree.rootNode,
			code,
			scopeTree,
			language,
			opts,
			filepath,
		)

		for await (const chunk of chunkGenerator) {
			if (parseResult.error) {
				yield {
					...chunk,
					context: {
						...chunk.context,
						parseError: parseResult.error ?? undefined,
					},
				}
			} else {
				yield chunk
			}
		}
	}

	async chunkBatch(
		files: FileInput[],
		options?: BatchOptions,
	): Promise<BatchResult[]> {
		const { concurrency = 10, onProgress, ...chunkOptions } = options ?? {}
		const mergedOptions = { ...this.defaultOptions, ...chunkOptions }
		const total = files.length

		const processFile = async (file: FileInput): Promise<BatchResult> => {
			try {
				const fileOptions = { ...mergedOptions, ...file.options }
				const chunks = await this.chunk(file.filepath, file.code, fileOptions)
				return { filepath: file.filepath, chunks, error: null }
			} catch (error) {
				return {
					filepath: file.filepath,
					chunks: null,
					error: error instanceof Error ? error : new Error(String(error)),
				}
			}
		}

		const results: BatchResult[] = []
		let completed = 0

		for (let i = 0; i < files.length; i += concurrency) {
			const batch = files.slice(i, i + concurrency)
			const batchResults = await Promise.all(batch.map(processFile))

			for (let j = 0; j < batchResults.length; j++) {
				const result = batchResults[j]
				if (result) {
					results.push(result)
					completed++
					if (onProgress) {
						const file = batch[j]
						if (file) {
							onProgress(completed, total, file.filepath, result.error === null)
						}
					}
				}
			}
		}

		return results
	}

	async *chunkBatchStream(
		files: FileInput[],
		options?: BatchOptions,
	): AsyncGenerator<BatchResult> {
		const { concurrency = 10, onProgress, ...chunkOptions } = options ?? {}
		const mergedOptions = { ...this.defaultOptions, ...chunkOptions }
		const total = files.length

		const processFile = async (file: FileInput): Promise<BatchResult> => {
			try {
				const fileOptions = { ...mergedOptions, ...file.options }
				const chunks = await this.chunk(file.filepath, file.code, fileOptions)
				return { filepath: file.filepath, chunks, error: null }
			} catch (error) {
				return {
					filepath: file.filepath,
					chunks: null,
					error: error instanceof Error ? error : new Error(String(error)),
				}
			}
		}

		let completed = 0

		for (let i = 0; i < files.length; i += concurrency) {
			const batch = files.slice(i, i + concurrency)
			const batchResults = await Promise.all(batch.map(processFile))

			for (let j = 0; j < batchResults.length; j++) {
				const result = batchResults[j]
				if (result) {
					completed++
					const file = batch[j]
					if (onProgress && file) {
						onProgress(completed, total, file.filepath, result.error === null)
					}
					yield result
				}
			}
		}
	}
}

export async function createChunker(
	config: WasmConfig,
	options?: ChunkOptions,
): Promise<Chunker> {
	const parser = new WasmParser(config)
	await parser.init()
	return new WasmChunker(parser, options)
}
