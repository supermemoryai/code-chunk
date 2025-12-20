import {
	Effect,
	Chunk as EffectChunk,
	Exit,
	Option,
	Ref,
	Scope,
	Stream,
} from 'effect'
import { ChunkingError, UnsupportedLanguageError } from './chunk'
import { chunk as chunkInternal } from './chunking'
import { extractEntities } from './extract'
import { parseCode } from './parser'
import { detectLanguage } from './parser/languages'
import { buildScopeTree } from './scope'
import type {
	BatchFileError,
	BatchFileResult,
	BatchOptions,
	BatchResult,
	Chunk,
	ChunkOptions,
	FileInput,
	Language,
} from './types'

const DEFAULT_CONCURRENCY = 10

/**
 * Type for a function that chunks a single file and returns an Effect
 */
export type ChunkFileFunction = (
	filepath: string,
	code: string,
	options: ChunkOptions,
) => Effect.Effect<Chunk[], unknown>

/**
 * Core batch stream processor - takes a chunk function and returns a stream of results
 * Used by both native and WASM implementations
 */
export const batchStreamEffect = (
	chunkFile: ChunkFileFunction,
	files: FileInput[],
	options: BatchOptions = {},
): Stream.Stream<BatchResult, never> => {
	const {
		concurrency = DEFAULT_CONCURRENCY,
		onProgress,
		...chunkOptions
	} = options
	const total = files.length

	if (total === 0) {
		return Stream.empty
	}

	const processFile = (file: FileInput): Effect.Effect<BatchResult, never> => {
		const mergedOptions = { ...chunkOptions, ...file.options }
		return chunkFile(file.filepath, file.code, mergedOptions).pipe(
			Effect.map(
				(chunks) =>
					({
						filepath: file.filepath,
						chunks,
						error: null,
					}) satisfies BatchFileResult,
			),
			Effect.catchAll((error) =>
				Effect.succeed({
					filepath: file.filepath,
					chunks: null,
					error: error instanceof Error ? error : new Error(String(error)),
				} satisfies BatchFileError),
			),
		)
	}

	return Stream.unwrap(
		Effect.gen(function* () {
			const completedRef = yield* Ref.make(0)

			return Stream.fromIterable(files).pipe(
				Stream.mapEffect(
					(file) =>
						processFile(file).pipe(
							Effect.tap((result) =>
								Ref.updateAndGet(completedRef, (n) => n + 1).pipe(
									Effect.andThen((completed) =>
										Effect.sync(() =>
											onProgress?.(
												completed,
												total,
												file.filepath,
												result.error === null,
											),
										),
									),
								),
							),
						),
					{ concurrency },
				),
			)
		}),
	)
}

/**
 * Core batch processor - collects stream results into array
 */
export const batchEffect = (
	chunkFile: ChunkFileFunction,
	files: FileInput[],
	options: BatchOptions = {},
): Effect.Effect<BatchResult[], never> => {
	return Stream.runCollect(batchStreamEffect(chunkFile, files, options)).pipe(
		Effect.map((chunk) => Array.from(chunk)),
	)
}

/**
 * Core batch processor - Promise API
 */
export async function batch(
	chunkFile: ChunkFileFunction,
	files: FileInput[],
	options?: BatchOptions,
): Promise<BatchResult[]> {
	return Effect.runPromise(batchEffect(chunkFile, files, options))
}

/**
 * Core batch stream processor - AsyncGenerator API
 */
export async function* batchStream(
	chunkFile: ChunkFileFunction,
	files: FileInput[],
	options?: BatchOptions,
): AsyncGenerator<BatchResult> {
	const scope = Effect.runSync(Scope.make())

	try {
		const pull = await Effect.runPromise(
			Stream.toPull(batchStreamEffect(chunkFile, files, options)).pipe(
				Scope.extend(scope),
			),
		)

		while (true) {
			const result = await Effect.runPromise(Effect.option(pull))
			if (Option.isNone(result)) break
			for (const item of EffectChunk.toReadonlyArray(result.value)) {
				yield item
			}
		}
	} finally {
		await Effect.runPromise(Scope.close(scope, Exit.void))
	}
}

const nativeChunkFile: ChunkFileFunction = (filepath, code, options) => {
	return Effect.gen(function* () {
		const language: Language | null =
			options.language ?? detectLanguage(filepath)

		if (!language) {
			return yield* Effect.fail(new UnsupportedLanguageError(filepath))
		}

		const parseResult = yield* Effect.tryPromise({
			try: () => parseCode(code, language),
			catch: (error: unknown) =>
				new ChunkingError('Failed to parse code', error),
		})

		const entities = yield* Effect.mapError(
			extractEntities(parseResult.tree.rootNode, language, code),
			(error: unknown) =>
				new ChunkingError('Failed to extract entities', error),
		)

		const scopeTree = yield* Effect.mapError(
			buildScopeTree(entities),
			(error: unknown) =>
				new ChunkingError('Failed to build scope tree', error),
		)

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

		return parseResult.error
			? chunks.map((c: Chunk) => ({
					...c,
					context: { ...c.context, parseError: parseResult.error ?? undefined },
				}))
			: chunks
	})
}

export const chunkBatchStreamEffect = (
	files: FileInput[],
	options: BatchOptions = {},
): Stream.Stream<BatchResult, never> =>
	batchStreamEffect(nativeChunkFile, files, options)

export const chunkBatchEffect = (
	files: FileInput[],
	options: BatchOptions = {},
): Effect.Effect<BatchResult[], never> =>
	batchEffect(nativeChunkFile, files, options)

export async function chunkBatch(
	files: FileInput[],
	options?: BatchOptions,
): Promise<BatchResult[]> {
	return batch(nativeChunkFile, files, options)
}

export async function* chunkBatchStream(
	files: FileInput[],
	options?: BatchOptions,
): AsyncGenerator<BatchResult> {
	yield* batchStream(nativeChunkFile, files, options)
}
