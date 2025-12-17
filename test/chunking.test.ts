import { describe, expect, test } from 'bun:test'
import {
	type Chunk,
	chunk,
	chunkStream,
	createChunker,
	type Language,
} from '../src'
import {
	countNws,
	getNwsCountFromCumsum,
	preprocessNwsCumsum,
} from '../src/chunking/nws'

// ============================================================================
// NWS (Non-Whitespace) Preprocessing Tests
// ============================================================================

describe('NWS preprocessing', () => {
	test('countNws counts non-whitespace characters', () => {
		expect(countNws('hello')).toBe(5)
		expect(countNws('hello world')).toBe(10)
		expect(countNws('  hello  ')).toBe(5)
		expect(countNws('\t\n\r ')).toBe(0)
		expect(countNws('')).toBe(0)
	})

	test('preprocessNwsCumsum builds cumulative sum array', () => {
		const code = 'ab cd'
		const cumsum = preprocessNwsCumsum(code)

		// cumsum[i] = count of NWS chars in code[0..i-1]
		expect(cumsum[0]).toBe(0) // before any chars
		expect(cumsum[1]).toBe(1) // after 'a'
		expect(cumsum[2]).toBe(2) // after 'ab'
		expect(cumsum[3]).toBe(2) // after 'ab ' (space doesn't count)
		expect(cumsum[4]).toBe(3) // after 'ab c'
		expect(cumsum[5]).toBe(4) // after 'ab cd'
	})

	test('getNwsCountFromCumsum returns O(1) range queries', () => {
		const code = 'function hello() { return 42; }'
		const cumsum = preprocessNwsCumsum(code)

		// Full range
		const fullNws = getNwsCountFromCumsum(cumsum, 0, code.length)
		expect(fullNws).toBe(countNws(code))

		// Partial range
		const partialNws = getNwsCountFromCumsum(cumsum, 0, 8) // 'function'
		expect(partialNws).toBe(8)
	})
})

// ============================================================================
// Chunking Tests
// ============================================================================

describe('chunk', () => {
	test('chunks simple TypeScript file', async () => {
		const code = `
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
`
		const chunks = await chunk('test.ts', code)

		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks[0]).toHaveProperty('text')
		expect(chunks[0]).toHaveProperty('byteRange')
		expect(chunks[0]).toHaveProperty('lineRange')
		expect(chunks[0]).toHaveProperty('context')
		expect(chunks[0]).toHaveProperty('index')
		expect(chunks[0]).toHaveProperty('totalChunks')
	})

	test('chunks preserve original text via source slicing', async () => {
		const code = `const x = 1
const y = 2
const z = 3`

		const chunks = await chunk('test.ts', code)

		// Reconstruct should match slicing from original
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}
	})

	test('chunks have correct index and totalChunks', async () => {
		const code = `
function a() { return 1 }
function b() { return 2 }
function c() { return 3 }
`
		const chunks = await chunk('test.ts', code)

		const total = chunks.length
		chunks.forEach((c, i) => {
			expect(c.index).toBe(i)
			expect(c.totalChunks).toBe(total)
		})
	})

	test('respects maxChunkSize option', async () => {
		// Create code that would be large
		const functions = Array.from(
			{ length: 10 },
			(_, i) => `function fn${i}() { return ${i} }`,
		).join('\n')

		const chunks = await chunk('test.ts', functions, { maxChunkSize: 100 })

		// With small maxChunkSize, should produce multiple chunks
		expect(chunks.length).toBeGreaterThan(1)

		// Each chunk's NWS count should be reasonable
		for (const c of chunks) {
			const nws = countNws(c.text)
			// Allow some overflow due to atomic nodes
			expect(nws).toBeLessThan(200)
		}
	})

	test('handles empty code', async () => {
		const chunks = await chunk('test.ts', '')
		expect(chunks).toEqual([])
	})

	test('handles code with only whitespace', async () => {
		const chunks = await chunk('test.ts', '   \n\n   \t\t   ')
		expect(chunks.length).toBe(0)
	})

	test('throws UnsupportedLanguageError for unknown extension', async () => {
		await expect(chunk('test.xyz', 'code')).rejects.toThrow(
			'Unsupported file type',
		)
	})

	test('allows language override via options', async () => {
		const code = 'const x = 1'

		// Even with wrong extension, should work with language override
		const chunks = await chunk('test.txt', code, { language: 'typescript' })
		expect(chunks.length).toBeGreaterThan(0)
	})
})

// ============================================================================
// Streaming API Tests
// ============================================================================

describe('stream', () => {
	test('streams chunks from code', async () => {
		const code = `
function a() { return 1 }
function b() { return 2 }
`
		const chunks: Chunk[] = []
		for await (const c of chunkStream('test.ts', code)) {
			chunks.push(c)
		}

		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks[0]).toHaveProperty('text')
		expect(chunks[0]).toHaveProperty('context')
	})

	test('stream respects options', async () => {
		const functions = Array.from(
			{ length: 10 },
			(_, i) => `function fn${i}() { return ${i} }`,
		).join('\n')

		const chunks: Chunk[] = []
		for await (const c of chunkStream('test.ts', functions, {
			maxChunkSize: 100,
		})) {
			chunks.push(c)
		}

		// With small maxChunkSize, should produce multiple chunks
		expect(chunks.length).toBeGreaterThan(1)
	})

	test('stream yields chunks with correct index (totalChunks is -1 for streaming)', async () => {
		const code = `
function a() { return 1 }
function b() { return 2 }
function c() { return 3 }
`
		const chunks: Chunk[] = []
		for await (const c of chunkStream('test.ts', code)) {
			chunks.push(c)
		}

		// Streaming doesn't know total upfront, so totalChunks is -1
		chunks.forEach((c, i) => {
			expect(c.index).toBe(i)
			expect(c.totalChunks).toBe(-1)
		})
	})
})

// ============================================================================
// Chunker Factory Tests
// ============================================================================

describe('createChunker', () => {
	test('creates a reusable chunker instance', async () => {
		const chunker = createChunker({ maxChunkSize: 500 })

		const code1 = 'const a = 1'
		const code2 = 'const b = 2'

		const chunks1 = await chunker.chunk('test.ts', code1)
		const chunks2 = await chunker.chunk('test.ts', code2)

		expect(chunks1.length).toBeGreaterThan(0)
		expect(chunks2.length).toBeGreaterThan(0)
	})

	test('chunker can chunk multiple files with different extensions', async () => {
		const chunker = createChunker({ maxChunkSize: 500 })

		const tsCode = 'const a: number = 1'
		const jsCode = 'const b = 2'

		const tsChunks = await chunker.chunk('test.ts', tsCode)
		const jsChunks = await chunker.chunk('test.js', jsCode)

		expect(tsChunks.length).toBeGreaterThan(0)
		expect(jsChunks.length).toBeGreaterThan(0)
	})

	test('chunker.stream yields chunks', async () => {
		const chunker = createChunker()
		const code = `
function a() { return 1 }
function b() { return 2 }
`
		const chunks: Chunk[] = []
		for await (const c of chunker.stream('test.ts', code)) {
			chunks.push(c)
		}

		expect(chunks.length).toBeGreaterThan(0)
	})

	test('chunker allows per-call option overrides', async () => {
		const chunker = createChunker({ maxChunkSize: 1500 })

		const functions = Array.from(
			{ length: 10 },
			(_, i) => `function fn${i}() { return ${i} }`,
		).join('\n')

		// Override maxChunkSize for this specific call
		const chunks = await chunker.chunk('test.ts', functions, {
			maxChunkSize: 100,
		})

		// With small maxChunkSize, should produce multiple chunks
		expect(chunks.length).toBeGreaterThan(1)
	})
})

// ============================================================================
// Multi-language Chunking Tests
// ============================================================================

describe('multi-language chunking', () => {
	const testCases: { lang: Language; ext: string; code: string }[] = [
		{
			lang: 'typescript',
			ext: 'ts',
			code: `
interface User {
  name: string
  age: number
}

function greet(user: User): string {
  return \`Hello, \${user.name}!\`
}
`,
		},
		{
			lang: 'javascript',
			ext: 'js',
			code: `
class Calculator {
  add(a, b) {
    return a + b
  }

  subtract(a, b) {
    return a - b
  }
}
`,
		},
		{
			lang: 'python',
			ext: 'py',
			code: `
class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b
`,
		},
		{
			lang: 'rust',
			ext: 'rs',
			code: `
fn main() {
    println!("Hello, world!");
}

fn add(a: i32, b: i32) -> i32 {
    a + b
}
`,
		},
		{
			lang: 'go',
			ext: 'go',
			code: `
package main

func main() {
    fmt.Println("Hello, world!")
}

func add(a, b int) int {
    return a + b
}
`,
		},
		{
			lang: 'java',
			ext: 'java',
			code: `
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }

    public static int add(int a, int b) {
        return a + b;
    }
}
`,
		},
	]

	for (const { lang, ext, code } of testCases) {
		test(`chunks ${lang} code correctly`, async () => {
			const chunks = await chunk(`test.${ext}`, code)

			expect(chunks.length).toBeGreaterThan(0)

			// All chunks should have valid structure
			for (const c of chunks) {
				expect(c.text.length).toBeGreaterThan(0)
				expect(c.byteRange.end).toBeGreaterThan(c.byteRange.start)
				expect(c.lineRange.end).toBeGreaterThanOrEqual(c.lineRange.start)
			}
		})
	}
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
	test('handles very long single line', async () => {
		const longLine = `const x = ${'"a"'.repeat(1000)}`
		const chunks = await chunk('test.ts', longLine, { maxChunkSize: 100 })

		// Should handle without crashing
		expect(chunks.length).toBeGreaterThan(0)
	})

	test('handles deeply nested code', async () => {
		const nested = `
function outer() {
  function inner1() {
    function inner2() {
      function inner3() {
        return 42
      }
      return inner3()
    }
    return inner2()
  }
  return inner1()
}
`
		const chunks = await chunk('test.ts', nested)
		expect(chunks.length).toBeGreaterThan(0)
	})

	test('handles unicode characters', async () => {
		const code = `
const greeting = "こんにちは"
const emoji = "🎉🚀✨"
`
		const chunks = await chunk('test.ts', code)

		expect(chunks.length).toBeGreaterThan(0)
		// Should preserve unicode
		const allText = chunks.map((c) => c.text).join('')
		expect(allText).toContain('こんにちは')
		expect(allText).toContain('🎉')
	})

	test('handles code with comments', async () => {
		const code = `
// Single line comment
/* Multi-line
   comment */
/**
 * JSDoc comment
 */
function documented() {
  return 1
}
`
		const chunks = await chunk('test.ts', code)
		expect(chunks.length).toBeGreaterThan(0)
	})
})

// ============================================================================
// Integration Tests - End-to-End Flow
// ============================================================================

describe('integration: end-to-end flow', () => {
	test('full pipeline: parse -> extract -> scope -> chunk -> context', async () => {
		console.log('\n--- Integration Test: Full Pipeline ---\n')

		// Realistic TypeScript file with imports, class, methods, and docstrings
		const code = `
import { Database } from './db'
import { Logger } from './utils'

/**
 * Service for managing user accounts.
 * Handles CRUD operations and authentication.
 */
export class UserService {
  private db: Database
  private logger: Logger

  constructor(db: Database, logger: Logger) {
    this.db = db
    this.logger = logger
  }

  /**
   * Fetch a user by their unique ID.
   * @param id - The user's unique identifier
   * @returns The user object or null if not found
   */
  async getUser(id: string): Promise<User | null> {
    this.logger.info(\`Fetching user: \${id}\`)
    return this.db.query('SELECT * FROM users WHERE id = ?', [id])
  }

  /**
   * Create a new user account.
   * @param data - The user data to insert
   * @returns The created user with generated ID
   */
  async createUser(data: CreateUserInput): Promise<User> {
    this.logger.info('Creating new user')
    const result = await this.db.insert('users', data)
    return { id: result.insertId, ...data }
  }

  /**
   * Delete a user by ID.
   * @param id - The user's unique identifier
   */
  async deleteUser(id: string): Promise<void> {
    this.logger.warn(\`Deleting user: \${id}\`)
    await this.db.delete('users', { id })
  }
}

/**
 * Helper function to validate user input.
 */
function validateUserInput(input: unknown): input is CreateUserInput {
  return typeof input === 'object' && input !== null && 'email' in input
}
`

		const filepath = 'services/user.ts'
		console.log(`[1/5] Input: ${filepath} (${code.length} bytes)`)

		// Step 1: Run the chunker
		console.log('[2/5] Running chunk() with maxChunkSize=500...')
		const startTime = performance.now()
		const chunks = await chunk(filepath, code, {
			maxChunkSize: 500,
			siblingDetail: 'signatures',
			filterImports: true,
		})
		const elapsed = (performance.now() - startTime).toFixed(2)
		console.log(
			`[3/5] Chunking complete: ${chunks.length} chunks in ${elapsed}ms`,
		)

		// Validate basic structure
		expect(chunks.length).toBeGreaterThan(0)

		// Step 2: Log each chunk with context
		console.log('\n[4/5] Chunk details:')
		for (const c of chunks) {
			console.log(`\n  Chunk ${c.index + 1}/${c.totalChunks}:`)
			console.log(
				`    - Lines: ${c.lineRange.start + 1}-${c.lineRange.end + 1}`,
			)
			console.log(`    - Bytes: ${c.byteRange.start}-${c.byteRange.end}`)
			console.log(`    - NWS chars: ~${c.text.replace(/\s/g, '').length}`)

			// Context info
			const ctx = c.context
			console.log(`    - Filepath: ${ctx.filepath}`)
			console.log(`    - Language: ${ctx.language}`)

			if (ctx.scope.length > 0) {
				const scopeChain = ctx.scope
					.map((s) => `${s.type}:${s.name}`)
					.join(' > ')
				console.log(`    - Scope: ${scopeChain}`)
			}

			if (ctx.entities.length > 0) {
				console.log(`    - Entities (${ctx.entities.length}):`)
				for (const e of ctx.entities) {
					const partial = e.isPartial ? ' [PARTIAL]' : ''
					const doc = e.docstring ? ` // "${e.docstring.slice(0, 30)}..."` : ''
					console.log(`        * ${e.type}: ${e.name}${partial}${doc}`)
				}
			}

			if (ctx.siblings.length > 0) {
				console.log(`    - Siblings (${ctx.siblings.length}):`)
				for (const s of ctx.siblings) {
					console.log(
						`        * ${s.type}: ${s.name} (${s.position}, distance=${s.distance})`,
					)
				}
			}

			if (ctx.imports.length > 0) {
				console.log(
					`    - Imports: ${ctx.imports.map((i) => `${i.name} from "${i.source}"`).join(', ')}`,
				)
			}

			// Show full chunk text with indentation
			console.log('    - Text:')
			const lines = c.text.split('\n')
			for (const line of lines) {
				console.log(`        ${line}`)
			}
		}

		// Step 3: Validate context correctness
		console.log('\n[5/5] Validating context...')

		// All chunks should have filepath and language
		for (const c of chunks) {
			expect(c.context.filepath).toBe(filepath)
			expect(c.context.language).toBe('typescript')
		}

		// At least one chunk should have the UserService class in scope or entities
		const hasUserService = chunks.some(
			(c) =>
				c.context.entities.some((e) => e.name === 'UserService') ||
				c.context.scope.some((s) => s.name === 'UserService'),
		)
		expect(hasUserService).toBe(true)

		// Check that methods are detected
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const methodNames = allEntities
			.filter((e) => e.type === 'method')
			.map((e) => e.name)
		expect(methodNames).toContain('getUser')
		expect(methodNames).toContain('createUser')
		expect(methodNames).toContain('deleteUser')

		// Check imports are captured
		const allImports = chunks.flatMap((c) => c.context.imports)
		const importNames = allImports.map((i) => i.name)
		// With filterImports=true, we should have imports that are used in chunks
		console.log(
			`    - Total unique imports found: ${[...new Set(importNames)].join(', ')}`,
		)

		// Verify chunks can reconstruct original code (no gaps/overlaps)
		const sortedChunks = [...chunks].sort(
			(a, b) => a.byteRange.start - b.byteRange.start,
		)
		let lastEnd = sortedChunks[0]?.byteRange.start ?? 0
		for (const c of sortedChunks) {
			// Chunks should not overlap
			expect(c.byteRange.start).toBeGreaterThanOrEqual(lastEnd)
			lastEnd = c.byteRange.end
		}

		console.log('\n--- Integration Test Complete ---\n')
	})

	test('streaming: processes chunks incrementally', async () => {
		console.log('\n--- Integration Test: Streaming ---\n')

		const code = `
function processItem(item: Item): Result {
  const validated = validate(item)
  const transformed = transform(validated)
  return finalize(transformed)
}

function validate(item: Item): ValidatedItem {
  if (!item.id) throw new Error('Missing id')
  return { ...item, validated: true }
}

function transform(item: ValidatedItem): TransformedItem {
  return { ...item, transformed: true }
}

function finalize(item: TransformedItem): Result {
  return { success: true, data: item }
}
`

		console.log('[1/3] Starting stream with maxChunkSize=200...')
		let chunkCount = 0
		const startTime = performance.now()

		for await (const c of chunkStream('pipeline.ts', code, {
			maxChunkSize: 200,
		})) {
			chunkCount++
			console.log(`[2/3] Received chunk ${chunkCount}:`)
			console.log(`    - Index: ${c.index} (totalChunks: ${c.totalChunks})`)
			console.log(
				`    - Entities: ${c.context.entities.map((e) => e.name).join(', ') || 'none'}`,
			)

			// In streaming mode, totalChunks is -1 (unknown upfront)
			expect(c.totalChunks).toBe(-1)
			expect(c.index).toBe(chunkCount - 1)
		}

		const elapsed = (performance.now() - startTime).toFixed(2)
		console.log(`[3/3] Stream complete: ${chunkCount} chunks in ${elapsed}ms`)

		expect(chunkCount).toBeGreaterThan(0)
		console.log('\n--- Streaming Test Complete ---\n')
	})

	test('chunker reuse: same chunker for multiple files', async () => {
		console.log('\n--- Integration Test: Chunker Reuse ---\n')

		const chunker = createChunker({ maxChunkSize: 300, siblingDetail: 'names' })

		const files = [
			{
				path: 'utils/math.ts',
				code: `
export function add(a: number, b: number): number { return a + b }
export function subtract(a: number, b: number): number { return a - b }
`,
			},
			{
				path: 'utils/string.py',
				code: `
def capitalize(s: str) -> str:
    return s.capitalize()

def lowercase(s: str) -> str:
    return s.lower()
`,
			},
			{
				path: 'utils/array.go',
				code: `
package utils

func Sum(nums []int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}
`,
			},
		]

		console.log('[1/2] Processing files with same chunker instance...')

		for (const file of files) {
			const chunks = await chunker.chunk(file.path, file.code)
			console.log(
				`    - ${file.path}: ${chunks.length} chunks, language=${chunks[0]?.context.language}`,
			)

			expect(chunks.length).toBeGreaterThan(0)
			expect(chunks[0]?.context.filepath).toBe(file.path)
		}

		console.log('[2/2] Chunker reuse test complete')
		console.log('\n--- Chunker Reuse Test Complete ---\n')
	})
})
