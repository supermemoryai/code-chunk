import { Effect, Stream } from 'effect'
import {
	chunk as chunkInternal,
	streamChunks as streamChunksInternal,
} from './chunking'
import { extractEntities } from './extract'
import { parseCode } from './parser'
import { detectLanguage } from './parser/languages'
import { buildScopeTree } from './scope'
import type {
	Chunk,
	ChunkOptions,
	Language,
	ParseResult,
	ScopeTree,
} from './types'

/**
 * Error thrown when chunking fails
 */
export class ChunkingError extends Error {
	readonly _tag = 'ChunkingError'
	override readonly cause?: unknown

	constructor(message: string, cause?: unknown) {
		super(message)
		this.name = 'ChunkingError'
		this.cause = cause
	}
}

/**
 * Error thrown when language detection fails
 */
export class UnsupportedLanguageError extends Error {
	readonly _tag = 'UnsupportedLanguageError'
	readonly filepath: string

	constructor(filepath: string) {
		super(`Unsupported file type: ${filepath}`)
		this.name = 'UnsupportedLanguageError'
		this.filepath = filepath
	}
}

/**
 * Internal Effect-based implementation of the chunking pipeline
 *
 * Orchestrates: parse -> extract -> scope -> chunk -> context
 */
const chunkEffect = (
	filepath: string,
	code: string,
	options: ChunkOptions = {},
): Effect.Effect<Chunk[], ChunkingError | UnsupportedLanguageError> => {
	return Effect.gen(function* () {
		// Step 1: Detect language (or use override)
		const language: Language | null =
			options.language ?? detectLanguage(filepath)

		if (!language) {
			return yield* Effect.fail(new UnsupportedLanguageError(filepath))
		}

		// Step 2: Parse the code
		const parseResult = yield* Effect.tryPromise({
			try: () => parseCode(code, language),
			catch: (error: unknown) =>
				new ChunkingError('Failed to parse code', error),
		})

		// Step 3: Extract entities from AST
		const entities = yield* Effect.mapError(
			extractEntities(parseResult.tree.rootNode, language, code),
			(error: unknown) =>
				new ChunkingError('Failed to extract entities', error),
		)

		// Step 4: Build scope tree
		const scopeTree = yield* Effect.mapError(
			buildScopeTree(entities),
			(error: unknown) =>
				new ChunkingError('Failed to build scope tree', error),
		)

		// Step 5: Chunk the code (passing filepath for context)
		const chunks = yield* Effect.mapError(
			chunkInternal(
				parseResult.tree.rootNode,
				code,
				scopeTree,
				language,
				options,
				filepath,
			),
			(error: unknown) => new ChunkingError('Failed to chunk code', error),
		)

		// If there was a parse error (but recoverable), attach it to chunk contexts
		if (parseResult.error) {
			const errorInfo = parseResult.error
			return chunks.map((c: Chunk) => ({
				...c,
				context: {
					...c.context,
					parseError: errorInfo,
				},
			}))
		}

		return chunks
	})
}

/**
 * Chunk source code into pieces with semantic context
 *
 * This is the main entry point for the astchunk library. It takes source code
 * and returns an array of chunks, each with contextual information about the
 * code's structure.
 *
 * @param filepath - The file path (used for language detection)
 * @param code - The source code to chunk
 * @param options - Optional chunking configuration
 * @returns Array of chunks with context
 * @throws ChunkingError if chunking fails
 * @throws UnsupportedLanguageError if the file type is not supported
 *
 * @example
 * ```ts
 * import { chunk } from 'astchunk'
 *
 * const chunks = await chunk('src/utils.ts', sourceCode)
 * for (const chunk of chunks) {
 *   console.log(chunk.text, chunk.context)
 * }
 * ```
 */
export async function chunk(
	filepath: string,
	code: string,
	options?: ChunkOptions,
): Promise<Chunk[]> {
	return Effect.runPromise(chunkEffect(filepath, code, options))
}

/**
 * Prepare the chunking pipeline (parse, extract, build scope tree)
 * Returns the parsed result and scope tree needed for chunking
 */
const prepareChunking = (
	filepath: string,
	code: string,
	options?: ChunkOptions,
): Effect.Effect<
	{ parseResult: ParseResult; scopeTree: ScopeTree; language: Language },
	ChunkingError | UnsupportedLanguageError
> => {
	return Effect.gen(function* () {
		// Step 1: Detect language (or use override)
		const language: Language | null =
			options?.language ?? detectLanguage(filepath)

		if (!language) {
			return yield* Effect.fail(new UnsupportedLanguageError(filepath))
		}

		// Step 2: Parse the code
		const parseResult = yield* Effect.tryPromise({
			try: () => parseCode(code, language),
			catch: (error: unknown) =>
				new ChunkingError('Failed to parse code', error),
		})

		// Step 3: Extract entities from AST
		const entities = yield* Effect.mapError(
			extractEntities(parseResult.tree.rootNode, language, code),
			(error: unknown) =>
				new ChunkingError('Failed to extract entities', error),
		)

		// Step 4: Build scope tree
		const scopeTree = yield* Effect.mapError(
			buildScopeTree(entities),
			(error: unknown) =>
				new ChunkingError('Failed to build scope tree', error),
		)

		return { parseResult, scopeTree, language }
	})
}

/**
 * Create an Effect Stream that yields chunks
 *
 * This is the Effect-native streaming API. Use this if you're working
 * within the Effect ecosystem and want full composability.
 *
 * @param filepath - The file path (used for language detection)
 * @param code - The source code to chunk
 * @param options - Optional chunking configuration
 * @returns Effect Stream of chunks with context
 *
 * @example
 * ```ts
 * import { chunkStreamEffect } from 'astchunk'
 * import { Effect, Stream } from 'effect'
 *
 * const program = Stream.runForEach(
 *   chunkStreamEffect('src/utils.ts', sourceCode),
 *   (chunk) => Effect.log(chunk.text)
 * )
 *
 * Effect.runPromise(program)
 * ```
 */
export const chunkStreamEffect = (
	filepath: string,
	code: string,
	options?: ChunkOptions,
): Stream.Stream<Chunk, ChunkingError | UnsupportedLanguageError> => {
	return Stream.unwrap(
		Effect.map(prepareChunking(filepath, code, options), (prepared) => {
			const { parseResult, scopeTree, language } = prepared

			// Create stream from the internal generator
			return Stream.fromAsyncIterable(
				streamChunksInternal(
					parseResult.tree.rootNode,
					code,
					scopeTree,
					language,
					options,
					filepath,
				),
				(error) => new ChunkingError('Stream iteration failed', error),
			).pipe(
				// Attach parse error to chunks if present
				Stream.map((chunk) =>
					parseResult.error
						? {
								...chunk,
								context: {
									...chunk.context,
									parseError: parseResult.error,
								},
							}
						: chunk,
				),
			)
		}),
	)
}

/**
 * Stream source code chunks as they are generated
 *
 * This function returns an async generator that yields chunks one at a time,
 * which is useful for processing large files without waiting for all chunks
 * to be generated.
 *
 * @param filepath - The file path (used for language detection)
 * @param code - The source code to chunk
 * @param options - Optional chunking configuration
 * @returns Async generator of chunks with context
 * @throws ChunkingError if chunking fails
 * @throws UnsupportedLanguageError if the file type is not supported
 *
 * @example
 * ```ts
 * import { chunkStream } from 'astchunk'
 *
 * for await (const chunk of chunkStream('src/utils.ts', sourceCode)) {
 *   console.log(chunk.text, chunk.context)
 * }
 * ```
 */
export async function* chunkStream(
	filepath: string,
	code: string,
	options?: ChunkOptions,
): AsyncGenerator<Chunk> {
	// Prepare the chunking pipeline
	const prepared = await Effect.runPromise(
		prepareChunking(filepath, code, options),
	)

	const { parseResult, scopeTree, language } = prepared

	// Stream chunks from the internal generator
	const chunkGenerator = streamChunksInternal(
		parseResult.tree.rootNode,
		code,
		scopeTree,
		language,
		options,
		filepath,
	)

	// Yield chunks, optionally attaching parse error if present
	for await (const chunk of chunkGenerator) {
		if (parseResult.error) {
			yield {
				...chunk,
				context: {
					...chunk.context,
					parseError: parseResult.error,
				},
			}
		} else {
			yield chunk
		}
	}
}
