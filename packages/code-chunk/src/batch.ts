import { Effect, Queue, Stream } from 'effect'
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

const chunkFileEffect = (
	file: FileInput,
	batchOptions: ChunkOptions = {},
): Effect.Effect<BatchResult, never> => {
	const mergedOptions = { ...batchOptions, ...file.options }

	return Effect.gen(function* () {
		const language: Language | null =
			mergedOptions.language ?? detectLanguage(file.filepath)

		if (!language) {
			return {
				filepath: file.filepath,
				chunks: null,
				error: new UnsupportedLanguageError(file.filepath),
			} satisfies BatchFileError
		}

		const parseResult = yield* Effect.tryPromise({
			try: () => parseCode(file.code, language),
			catch: (error: unknown) =>
				new ChunkingError('Failed to parse code', error),
		})

		const entities = yield* Effect.mapError(
			extractEntities(parseResult.tree.rootNode, language, file.code),
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
				file.code,
				scopeTree,
				language,
				mergedOptions,
				file.filepath,
			),
			(error: unknown) => new ChunkingError('Failed to chunk code', error),
		)

		const finalChunks: Chunk[] = parseResult.error
			? chunks.map((c: Chunk) => ({
					...c,
					context: { ...c.context, parseError: parseResult.error ?? undefined },
				}))
			: chunks

		return {
			filepath: file.filepath,
			chunks: finalChunks,
			error: null,
		} satisfies BatchFileResult
	}).pipe(
		Effect.catchAll((error) =>
			Effect.succeed({
				filepath: file.filepath,
				chunks: null,
				error: error instanceof Error ? error : new Error(String(error)),
			} satisfies BatchFileError),
		),
	)
}

export const chunkBatchStreamEffect = (
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

	return Stream.unwrap(
		Effect.gen(function* () {
			const queue = yield* Queue.unbounded<FileInput>()
			const resultsQueue = yield* Queue.unbounded<BatchResult | null>()

			yield* Effect.forEach(files, (file) => Queue.offer(queue, file), {
				discard: true,
			})

			let completed = 0

			const worker = Effect.gen(function* () {
				while (true) {
					const maybeFile = yield* Queue.poll(queue)
					if (maybeFile._tag === 'None') {
						break
					}
					const file = maybeFile.value
					const result = yield* chunkFileEffect(file, chunkOptions)
					completed++
					if (onProgress) {
						onProgress(completed, total, file.filepath, result.error === null)
					}
					yield* Queue.offer(resultsQueue, result)
				}
			})

			yield* Effect.fork(
				Effect.gen(function* () {
					yield* Effect.all(
						Array.from({ length: Math.min(concurrency, total) }, () => worker),
						{ concurrency: 'unbounded' },
					)
					yield* Queue.offer(resultsQueue, null)
				}),
			)

			return Stream.fromQueue(resultsQueue).pipe(
				Stream.takeWhile((result): result is BatchResult => result !== null),
			)
		}),
	)
}

export const chunkBatchEffect = (
	files: FileInput[],
	options: BatchOptions = {},
): Effect.Effect<BatchResult[], never> => {
	return Stream.runCollect(chunkBatchStreamEffect(files, options)).pipe(
		Effect.map((chunk) => Array.from(chunk)),
	)
}

export async function chunkBatch(
	files: FileInput[],
	options?: BatchOptions,
): Promise<BatchResult[]> {
	return Effect.runPromise(chunkBatchEffect(files, options))
}

export async function* chunkBatchStream(
	files: FileInput[],
	options?: BatchOptions,
): AsyncGenerator<BatchResult> {
	const results: BatchResult[] = []
	let resolveNext: ((value: IteratorResult<BatchResult>) => void) | null = null
	let done = false

	const streamEffect = chunkBatchStreamEffect(files, options).pipe(
		Stream.runForEach((result) =>
			Effect.sync(() => {
				if (resolveNext) {
					const resolve = resolveNext
					resolveNext = null
					resolve({ value: result, done: false })
				} else {
					results.push(result)
				}
			}),
		),
		Effect.tap(() =>
			Effect.sync(() => {
				done = true
				if (resolveNext) {
					resolveNext({ value: undefined as never, done: true })
				}
			}),
		),
	)

	const runPromise = Effect.runPromise(streamEffect)

	try {
		while (true) {
			const buffered = results.shift()
			if (buffered !== undefined) {
				yield buffered
			} else if (done) {
				break
			} else {
				const result = await new Promise<IteratorResult<BatchResult>>(
					(resolve) => {
						resolveNext = resolve
					},
				)
				if (result.done) break
				yield result.value
			}
		}
	} finally {
		await runPromise.catch(() => {})
	}
}
