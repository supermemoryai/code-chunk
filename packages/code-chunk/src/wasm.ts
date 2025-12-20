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
	Chunk,
	Chunker,
	ChunkOptions,
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
	Chunk,
	ChunkContext,
	ChunkEntityInfo,
	Chunker,
	ChunkOptions,
	EntityInfo,
	EntityType,
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
}

export async function createChunker(
	config: WasmConfig,
	options?: ChunkOptions,
): Promise<Chunker> {
	const parser = new WasmParser(config)
	await parser.init()
	return new WasmChunker(parser, options)
}
