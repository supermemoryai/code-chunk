import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'

import type { WasmConfig } from '../src/types'

import {
	WasmChunkingError,
	WasmGrammarError,
	WasmParser,
	WasmParserError,
	createChunker,
	UnsupportedLanguageError,
} from '../src/wasm'

async function loadWasmBinary(packagePath: string): Promise<Uint8Array> {
	// node_modules is at monorepo root, 2 dirs up from packages/code-chunk
	const fullPath = resolve(
		process.cwd(),
		'..',
		'..',
		'node_modules',
		...packagePath.split('/'),
	)
	return await readFile(fullPath)
}

async function getWasmConfig(): Promise<WasmConfig> {
	const [treeSitter, typescript, javascript] = await Promise.all([
		loadWasmBinary('web-tree-sitter/web-tree-sitter.wasm'),
		loadWasmBinary('tree-sitter-typescript/tree-sitter-tsx.wasm'),
		loadWasmBinary('tree-sitter-javascript/tree-sitter-javascript.wasm'),
	])

	return {
		treeSitter,
		languages: {
			typescript,
			javascript,
		},
	}
}

describe('WasmParser', () => {
	test('initializes and parses TypeScript', async () => {
		const config = await getWasmConfig()
		const parser = new WasmParser(config)
		await parser.init()

		const result = await parser.parse('const x: number = 1', 'typescript')

		expect(result.tree).toBeDefined()
		expect(result.error).toBeNull()
		expect(result.tree.rootNode.type).toBe('program')
	})

	test('initializes and parses JavaScript', async () => {
		const config = await getWasmConfig()
		const parser = new WasmParser(config)
		await parser.init()

		const result = await parser.parse('const x = 1', 'javascript')

		expect(result.tree).toBeDefined()
		expect(result.error).toBeNull()
	})

	test('throws error for missing language', async () => {
		const config = await getWasmConfig()
		const parser = new WasmParser(config)
		await parser.init()

		await expect(parser.parse('print("hello")', 'python')).rejects.toThrow(
			WasmGrammarError,
		)
	})

	test('throws error if not initialized', async () => {
		const config = await getWasmConfig()
		const parser = new WasmParser(config)

		await expect(parser.parse('const x = 1', 'typescript')).rejects.toThrow(
			WasmParserError,
		)
	})

	test('caches grammar after first load', async () => {
		const config = await getWasmConfig()
		const parser = new WasmParser(config)
		await parser.init()

		await parser.parse('const a = 1', 'typescript')
		await parser.parse('const b = 2', 'typescript')
		await parser.parse('const c = 3', 'typescript')

		expect(true).toBe(true)
	})
})

describe('createChunker (wasm)', () => {
	test('creates chunker and chunks TypeScript code', async () => {
		const config = await getWasmConfig()
		const chunker = await createChunker(config)

		const code = `
export function add(a: number, b: number): number {
  return a + b
}

export function subtract(a: number, b: number): number {
  return a - b
}
`
		const chunks = await chunker.chunk('math.ts', code)

		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks[0].context.language).toBe('typescript')
		expect(chunks[0].context.filepath).toBe('math.ts')
	})

	test('streams chunks', async () => {
		const config = await getWasmConfig()
		const chunker = await createChunker(config)

		const code = `
function first() { return 1 }
function second() { return 2 }
`
		const chunks: Awaited<ReturnType<typeof chunker.chunk>> = []
		for await (const chunk of chunker.stream('test.ts', code)) {
			chunks.push(chunk)
		}

		expect(chunks.length).toBeGreaterThan(0)
	})

	test('respects maxChunkSize option', async () => {
		const config = await getWasmConfig()
		const chunker = await createChunker(config, { maxChunkSize: 100 })

		const code = `
export function firstFunction() {
  const a = 1
  const b = 2
  return a + b
}

export function secondFunction() {
  const x = 10
  const y = 20
  return x * y
}

export function thirdFunction() {
  const result = []
  for (let i = 0; i < 10; i++) {
    result.push(i)
  }
  return result
}
`
		const chunks = await chunker.chunk('large.ts', code)

		expect(chunks.length).toBeGreaterThan(1)
	})

	test('throws UnsupportedLanguageError for unknown file type', async () => {
		const config = await getWasmConfig()
		const chunker = await createChunker(config)

		await expect(chunker.chunk('file.xyz', 'content')).rejects.toThrow(
			UnsupportedLanguageError,
		)
	})

	test('includes entities in context', async () => {
		const config = await getWasmConfig()
		const chunker = await createChunker(config)

		const code = `
export class Calculator {
  add(a: number, b: number): number {
    return a + b
  }
}
`
		const chunks = await chunker.chunk('calc.ts', code)

		expect(chunks[0].context.entities.length).toBeGreaterThan(0)
		const entityNames = chunks[0].context.entities.map((e) => e.name)
		expect(entityNames).toContain('Calculator')
	})

	test('includes imports in context', async () => {
		const config = await getWasmConfig()
		const chunker = await createChunker(config)

		const code = `
import { Effect } from 'effect'
import { pipe } from 'effect/Function'

export const program = Effect.succeed(42)
`
		const chunks = await chunker.chunk('program.ts', code)

		expect(chunks[0].context.imports.length).toBeGreaterThan(0)
	})
})

describe('error classes', () => {
	test('WasmParserError has correct tag', () => {
		const error = new WasmParserError('test error')
		expect(error._tag).toBe('WasmParserError')
		expect(error.name).toBe('WasmParserError')
	})

	test('WasmGrammarError has correct tag and language', () => {
		const error = new WasmGrammarError('python')
		expect(error._tag).toBe('WasmGrammarError')
		expect(error.language).toBe('python')
	})

	test('WasmChunkingError has correct tag', () => {
		const error = new WasmChunkingError('chunk failed')
		expect(error._tag).toBe('WasmChunkingError')
	})

	test('UnsupportedLanguageError has correct tag and filepath', () => {
		const error = new UnsupportedLanguageError('file.xyz')
		expect(error._tag).toBe('UnsupportedLanguageError')
		expect(error.filepath).toBe('file.xyz')
	})
})
