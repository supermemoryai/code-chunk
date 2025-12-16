import { Effect } from 'effect'
import { chunk as chunkInternal } from './chunking'
import { extractEntities } from './extract'
import { parseCode } from './parser'
import { detectLanguage } from './parser/languages'
import { buildScopeTree } from './scope'
import type { Chunk, ChunkOptions, Language } from './types'

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

		// Step 5: Chunk the code
		const chunks = yield* Effect.mapError(
			chunkInternal(
				parseResult.tree.rootNode,
				code,
				scopeTree,
				language,
				options,
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
 * Chunk source code synchronously (blocking)
 *
 * **WARNING: Not yet implemented.** This function will throw an error.
 * The chunking pipeline requires async WASM loading which cannot run synchronously.
 * Use the async `chunk()` function instead.
 *
 * @param _filepath - The file path (unused)
 * @param _code - The source code (unused)
 * @param _options - Optional chunking configuration (unused)
 * @throws Error Always throws - sync chunking is not supported
 *
 * @deprecated Use `chunk()` instead. This will be implemented in a future version
 * if there's demand for sync operation with pre-initialized parsers.
 */
export function chunkSync(
	_filepath: string,
	_code: string,
	_options?: ChunkOptions,
): Chunk[] {
	throw new Error(
		'chunkSync is not supported. The chunking pipeline requires async WASM loading. Use chunk() instead.',
	)
}
