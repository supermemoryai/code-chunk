import { describe, expect, test } from 'bun:test'
import { type Chunk, chunk, createChunker, type Language } from '../src'
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
// Chunker Factory Tests
// ============================================================================

describe('createChunker', () => {
	test('creates a reusable chunker instance', async () => {
		const chunker = createChunker('test.ts', { maxChunkSize: 500 })

		const code1 = 'const a = 1'
		const code2 = 'const b = 2'

		const chunks1 = await chunker.chunk(code1)
		const chunks2 = await chunker.chunk(code2)

		expect(chunks1.length).toBeGreaterThan(0)
		expect(chunks2.length).toBeGreaterThan(0)
	})

	test('chunker.stream yields chunks', async () => {
		const chunker = createChunker('test.ts')
		const code = `
function a() { return 1 }
function b() { return 2 }
`
		const chunks: Chunk[] = []
		for await (const c of chunker.stream(code)) {
			chunks.push(c)
		}

		expect(chunks.length).toBeGreaterThan(0)
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
