import { describe, expect, test } from 'bun:test'
import {
	type BatchResult,
	chunkBatch,
	chunkBatchStream,
	createChunker,
	type FileInput,
} from '../src'

const tsCode1 = `export function add(a: number, b: number): number {
  return a + b
}

export function subtract(a: number, b: number): number {
  return a - b
}`

const tsCode2 = `export class Calculator {
  private result: number = 0

  add(n: number): this {
    this.result += n
    return this
  }

  getValue(): number {
    return this.result
  }
}`

const pyCode = `def greet(name: str) -> str:
    return f"Hello, {name}!"

def farewell(name: str) -> str:
    return f"Goodbye, {name}!"`

const goCode = `package main

func Sum(nums []int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}`

describe('chunkBatch', () => {
	test('processes multiple files and returns results for each', async () => {
		const files: FileInput[] = [
			{ filepath: 'math.ts', code: tsCode1 },
			{ filepath: 'calc.ts', code: tsCode2 },
			{ filepath: 'greet.py', code: pyCode },
		]

		const results = await chunkBatch(files)

		expect(results).toHaveLength(3)

		for (const result of results) {
			expect(result.error).toBeNull()
			expect(result.chunks).not.toBeNull()
			expect(result.chunks!.length).toBeGreaterThan(0)
		}

		const mathResult = results.find((r) => r.filepath === 'math.ts')
		expect(mathResult?.chunks?.[0]?.context.language).toBe('typescript')

		const pyResult = results.find((r) => r.filepath === 'greet.py')
		expect(pyResult?.chunks?.[0]?.context.language).toBe('python')
	})

	test('handles unsupported file types gracefully', async () => {
		const files: FileInput[] = [
			{ filepath: 'valid.ts', code: tsCode1 },
			{ filepath: 'invalid.xyz', code: 'some content' },
			{ filepath: 'also-valid.py', code: pyCode },
		]

		const results = await chunkBatch(files)

		expect(results).toHaveLength(3)

		const validTs = results.find((r) => r.filepath === 'valid.ts')
		expect(validTs?.error).toBeNull()
		expect(validTs?.chunks).not.toBeNull()

		const invalid = results.find((r) => r.filepath === 'invalid.xyz')
		expect(invalid?.error).not.toBeNull()
		expect(invalid?.chunks).toBeNull()
		expect(invalid?.error?.message).toContain('Unsupported file type')

		const validPy = results.find((r) => r.filepath === 'also-valid.py')
		expect(validPy?.error).toBeNull()
		expect(validPy?.chunks).not.toBeNull()
	})

	test('returns empty array for empty input', async () => {
		const results = await chunkBatch([])
		expect(results).toHaveLength(0)
	})

	test('respects maxChunkSize option', async () => {
		const largeCode = Array.from(
			{ length: 20 },
			(_, i) =>
				`export function func${i}(x: number): number { return x * ${i} }`,
		).join('\n\n')

		const files: FileInput[] = [{ filepath: 'large.ts', code: largeCode }]

		const smallChunks = await chunkBatch(files, { maxChunkSize: 100 })
		const largeChunks = await chunkBatch(files, { maxChunkSize: 2000 })

		expect(smallChunks[0]?.chunks).not.toBeNull()
		expect(largeChunks[0]?.chunks).not.toBeNull()
		expect(smallChunks[0]!.chunks!.length).toBeGreaterThan(
			largeChunks[0]!.chunks!.length,
		)
	})

	test('respects per-file options override', async () => {
		const code = Array.from(
			{ length: 10 },
			(_, i) => `export function func${i}(): void {}`,
		).join('\n')

		const files: FileInput[] = [
			{ filepath: 'default.ts', code },
			{ filepath: 'small.ts', code, options: { maxChunkSize: 50 } },
		]

		const results = await chunkBatch(files, { maxChunkSize: 2000 })

		const defaultResult = results.find((r) => r.filepath === 'default.ts')
		const smallResult = results.find((r) => r.filepath === 'small.ts')

		expect(defaultResult?.chunks).not.toBeNull()
		expect(smallResult?.chunks).not.toBeNull()
		expect(smallResult!.chunks!.length).toBeGreaterThan(
			defaultResult!.chunks!.length,
		)
	})

	test('calls onProgress callback for each file', async () => {
		const files: FileInput[] = [
			{ filepath: 'a.ts', code: tsCode1 },
			{ filepath: 'b.ts', code: tsCode2 },
			{ filepath: 'c.py', code: pyCode },
		]

		const progressCalls: Array<{
			completed: number
			total: number
			filepath: string
			success: boolean
		}> = []

		await chunkBatch(files, {
			onProgress: (completed, total, filepath, success) => {
				progressCalls.push({ completed, total, filepath, success })
			},
		})

		expect(progressCalls).toHaveLength(3)

		for (const call of progressCalls) {
			expect(call.total).toBe(3)
			expect(call.success).toBe(true)
		}

		const completedValues = progressCalls.map((c) => c.completed).sort()
		expect(completedValues).toEqual([1, 2, 3])
	})

	test('onProgress reports failures correctly', async () => {
		const files: FileInput[] = [
			{ filepath: 'valid.ts', code: tsCode1 },
			{ filepath: 'invalid.xyz', code: 'content' },
		]

		const progressCalls: Array<{ filepath: string; success: boolean }> = []

		await chunkBatch(files, {
			onProgress: (_, __, filepath, success) => {
				progressCalls.push({ filepath, success })
			},
		})

		const validCall = progressCalls.find((c) => c.filepath === 'valid.ts')
		const invalidCall = progressCalls.find((c) => c.filepath === 'invalid.xyz')

		expect(validCall?.success).toBe(true)
		expect(invalidCall?.success).toBe(false)
	})

	test('processes with different concurrency levels', async () => {
		const files: FileInput[] = Array.from({ length: 20 }, (_, i) => ({
			filepath: `file${i}.ts`,
			code: `export const x${i} = ${i}`,
		}))

		const results1 = await chunkBatch(files, { concurrency: 1 })
		const results10 = await chunkBatch(files, { concurrency: 10 })

		expect(results1).toHaveLength(20)
		expect(results10).toHaveLength(20)
		expect(results1.filter((r) => r.error === null)).toHaveLength(20)
		expect(results10.filter((r) => r.error === null)).toHaveLength(20)
	})

	test('handles mixed language files', async () => {
		const files: FileInput[] = [
			{ filepath: 'app.ts', code: tsCode1 },
			{ filepath: 'utils.py', code: pyCode },
			{ filepath: 'main.go', code: goCode },
		]

		const results = await chunkBatch(files)

		expect(results).toHaveLength(3)

		const tsResult = results.find((r) => r.filepath === 'app.ts')
		const pyResult = results.find((r) => r.filepath === 'utils.py')
		const goResult = results.find((r) => r.filepath === 'main.go')

		expect(tsResult?.chunks?.[0]?.context.language).toBe('typescript')
		expect(pyResult?.chunks?.[0]?.context.language).toBe('python')
		expect(goResult?.chunks?.[0]?.context.language).toBe('go')
	})

	test('chunks contain valid byte and line ranges', async () => {
		const files: FileInput[] = [{ filepath: 'test.ts', code: tsCode1 }]

		const results = await chunkBatch(files)
		const chunks = results[0]?.chunks

		expect(chunks).not.toBeNull()

		for (const chunk of chunks!) {
			expect(chunk.byteRange.start).toBeGreaterThanOrEqual(0)
			expect(chunk.byteRange.end).toBeGreaterThan(chunk.byteRange.start)
			expect(chunk.lineRange.start).toBeGreaterThanOrEqual(0)
			expect(chunk.lineRange.end).toBeGreaterThanOrEqual(chunk.lineRange.start)

			const sliced = tsCode1.slice(chunk.byteRange.start, chunk.byteRange.end)
			expect(chunk.text).toBe(sliced)
		}
	})
})

describe('chunkBatchStream', () => {
	test('yields results for all files', async () => {
		const files: FileInput[] = [
			{ filepath: 'a.ts', code: tsCode1 },
			{ filepath: 'b.ts', code: tsCode2 },
			{ filepath: 'c.py', code: pyCode },
		]

		const results: BatchResult[] = []
		for await (const result of chunkBatchStream(files)) {
			results.push(result)
		}

		expect(results).toHaveLength(3)

		for (const result of results) {
			expect(result.error).toBeNull()
			expect(result.chunks).not.toBeNull()
		}
	})

	test('yields results incrementally', async () => {
		const files: FileInput[] = Array.from({ length: 5 }, (_, i) => ({
			filepath: `file${i}.ts`,
			code: `export const x${i} = ${i}`,
		}))

		const results: BatchResult[] = []
		let yieldCount = 0

		for await (const result of chunkBatchStream(files)) {
			yieldCount++
			results.push(result)
			expect(results).toHaveLength(yieldCount)
		}

		expect(results).toHaveLength(5)
	})

	test('handles errors in stream', async () => {
		const files: FileInput[] = [
			{ filepath: 'valid.ts', code: tsCode1 },
			{ filepath: 'invalid.xyz', code: 'content' },
		]

		const results: BatchResult[] = []
		for await (const result of chunkBatchStream(files)) {
			results.push(result)
		}

		expect(results).toHaveLength(2)

		const hasError = results.some((r) => r.error !== null)
		const hasSuccess = results.some((r) => r.error === null)

		expect(hasError).toBe(true)
		expect(hasSuccess).toBe(true)
	})

	test('yields nothing for empty input', async () => {
		const results: BatchResult[] = []
		for await (const result of chunkBatchStream([])) {
			results.push(result)
		}

		expect(results).toHaveLength(0)
	})

	test('respects options in stream mode', async () => {
		const files: FileInput[] = [{ filepath: 'test.ts', code: tsCode1 }]

		const results: BatchResult[] = []
		for await (const result of chunkBatchStream(files, { maxChunkSize: 50 })) {
			results.push(result)
		}

		expect(results).toHaveLength(1)
		expect(results[0]?.chunks).not.toBeNull()
		expect(results[0]!.chunks!.length).toBeGreaterThan(1)
	})

	test('calls onProgress in stream mode', async () => {
		const files: FileInput[] = [
			{ filepath: 'a.ts', code: tsCode1 },
			{ filepath: 'b.ts', code: tsCode2 },
		]

		const progressCalls: number[] = []

		for await (const _ of chunkBatchStream(files, {
			onProgress: (completed) => {
				progressCalls.push(completed)
			},
		})) {
		}

		expect(progressCalls.length).toBeGreaterThanOrEqual(2)
	})

	test('stream can be consumed partially', async () => {
		const files: FileInput[] = Array.from({ length: 10 }, (_, i) => ({
			filepath: `file${i}.ts`,
			code: `export const x${i} = ${i}`,
		}))

		const results: BatchResult[] = []
		let count = 0

		for await (const result of chunkBatchStream(files)) {
			results.push(result)
			count++
			if (count >= 3) break
		}

		expect(results).toHaveLength(3)
	})
})

describe('createChunker batch methods', () => {
	test('chunker.chunkBatch uses default options', async () => {
		const chunker = createChunker({ maxChunkSize: 100 })

		const largeCode = Array.from(
			{ length: 10 },
			(_, i) =>
				`export function func${i}(x: number): number { return x * ${i} }`,
		).join('\n\n')

		const files: FileInput[] = [{ filepath: 'test.ts', code: largeCode }]

		const results = await chunker.chunkBatch(files)

		expect(results).toHaveLength(1)
		expect(results[0]?.chunks).not.toBeNull()
		expect(results[0]!.chunks!.length).toBeGreaterThan(1)
	})

	test('chunker.chunkBatch allows option overrides', async () => {
		const chunker = createChunker({ maxChunkSize: 100 })

		const files: FileInput[] = [{ filepath: 'test.ts', code: tsCode1 }]

		const smallChunks = await chunker.chunkBatch(files)
		const largeChunks = await chunker.chunkBatch(files, { maxChunkSize: 5000 })

		expect(smallChunks[0]!.chunks!.length).toBeGreaterThanOrEqual(
			largeChunks[0]!.chunks!.length,
		)
	})

	test('chunker.chunkBatchStream yields results', async () => {
		const chunker = createChunker()

		const files: FileInput[] = [
			{ filepath: 'a.ts', code: tsCode1 },
			{ filepath: 'b.py', code: pyCode },
		]

		const results: BatchResult[] = []
		for await (const result of chunker.chunkBatchStream(files)) {
			results.push(result)
		}

		expect(results).toHaveLength(2)
	})
})

describe('batch edge cases', () => {
	test('handles empty files', async () => {
		const files: FileInput[] = [
			{ filepath: 'empty.ts', code: '' },
			{ filepath: 'whitespace.ts', code: '   \n\n   ' },
		]

		const results = await chunkBatch(files)

		expect(results).toHaveLength(2)

		for (const result of results) {
			expect(result.error).toBeNull()
			expect(result.chunks).toHaveLength(0)
		}
	})

	test('handles malformed code gracefully', async () => {
		const files: FileInput[] = [
			{ filepath: 'broken.ts', code: 'function broken( { return' },
			{ filepath: 'valid.ts', code: tsCode1 },
		]

		const results = await chunkBatch(files)

		expect(results).toHaveLength(2)

		const validResult = results.find((r) => r.filepath === 'valid.ts')
		expect(validResult?.error).toBeNull()
		expect(validResult?.chunks).not.toBeNull()
	})

	test('handles large number of files', async () => {
		const files: FileInput[] = Array.from({ length: 100 }, (_, i) => ({
			filepath: `file${i}.ts`,
			code: `export const value${i} = ${i}`,
		}))

		const results = await chunkBatch(files, { concurrency: 20 })

		expect(results).toHaveLength(100)

		const successCount = results.filter((r) => r.error === null).length
		expect(successCount).toBe(100)
	})

	test('all files are processed regardless of order', async () => {
		const files: FileInput[] = [
			{ filepath: 'first.ts', code: 'export const a = 1' },
			{ filepath: 'second.ts', code: 'export const b = 2' },
			{ filepath: 'third.ts', code: 'export const c = 3' },
		]

		const results = await chunkBatch(files)

		const filepaths = results.map((r) => r.filepath).sort()
		expect(filepaths).toEqual(['first.ts', 'second.ts', 'third.ts'])
	})

	test('concurrent processing does not corrupt results', async () => {
		const files: FileInput[] = Array.from({ length: 50 }, (_, i) => ({
			filepath: `file${i}.ts`,
			code: `export const uniqueValue${i} = "${i}-${'x'.repeat(i)}"`,
		}))

		const results = await chunkBatch(files, { concurrency: 25 })

		for (let i = 0; i < 50; i++) {
			const result = results.find((r) => r.filepath === `file${i}.ts`)
			expect(result).toBeDefined()
			expect(result?.chunks).not.toBeNull()
			expect(result?.chunks?.[0]?.text).toContain(`uniqueValue${i}`)
		}
	})
})
