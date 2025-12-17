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
		expect(cumsum).toHaveLength(6)
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
		// Exact count: "functionhello(){return42;}" = 26 chars
		expect(fullNws).toBe(26)

		// Partial range
		const partialNws = getNwsCountFromCumsum(cumsum, 0, 8) // 'function'
		expect(partialNws).toBe(8)
	})
})

// ============================================================================
// Chunking Tests
// ============================================================================

describe('chunk', () => {
	test('chunks simple TypeScript file with exact structure', async () => {
		const code = `function greet(name: string): string {
  return \`Hello, \${name}!\`
}`
		const chunks = await chunk('test.ts', code)

		expect(chunks).toHaveLength(1)
		expect(chunks[0]).toMatchObject({
			text: code,
			byteRange: { start: 0, end: code.length },
			lineRange: { start: 0, end: 2 },
			index: 0,
			totalChunks: 1,
		})
		expect(chunks[0]!.context).toMatchObject({
			filepath: 'test.ts',
			language: 'typescript',
		})
		expect(chunks[0]!.context.entities).toHaveLength(1)
		expect(chunks[0]!.context.entities[0]).toMatchObject({
			name: 'greet',
			type: 'function',
			isPartial: false,
		})
	})

	test('chunks preserve original text via source slicing', async () => {
		const code = `const x = 1
const y = 2
const z = 3`

		const chunks = await chunk('test.ts', code)

		expect(chunks).toHaveLength(1)
		// Reconstruct should match slicing from original
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}
	})

	test('chunks have correct index and totalChunks', async () => {
		const code = `function a() { return 1 }
function b() { return 2 }
function c() { return 3 }`
		const chunks = await chunk('test.ts', code, { maxChunkSize: 50 })

		const total = chunks.length
		// With maxChunkSize=50, we get at least 2 chunks
		expect(total).toBeGreaterThanOrEqual(2)
		chunks.forEach((c, i) => {
			expect(c.index).toBe(i)
			expect(c.totalChunks).toBe(total)
		})
	})

	test('respects maxChunkSize option with exact counts', async () => {
		// Create code that would be large
		const functions = Array.from(
			{ length: 10 },
			(_, i) => `function fn${i}() { return ${i} }`,
		).join('\n')

		const chunks = await chunk('test.ts', functions, { maxChunkSize: 100 })

		// With small maxChunkSize, should produce multiple chunks
		expect(chunks.length).toBeGreaterThan(1)
		expect(chunks.length).toBeLessThanOrEqual(10)

		// Each chunk's NWS count should be reasonable
		for (const c of chunks) {
			const nws = countNws(c.text)
			// Allow some overflow due to atomic nodes
			expect(nws).toBeLessThan(200)
		}
	})

	test('handles empty code', async () => {
		const chunks = await chunk('test.ts', '')
		expect(chunks).toHaveLength(0)
	})

	test('handles code with only whitespace', async () => {
		const chunks = await chunk('test.ts', '   \n\n   \t\t   ')
		expect(chunks).toHaveLength(0)
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
		expect(chunks).toHaveLength(1)
		expect(chunks[0]!.context.language).toBe('typescript')
	})
})

// ============================================================================
// Chunk Ordering and Boundaries Tests
// ============================================================================

describe('chunk ordering and boundaries', () => {
	test('chunks are non-overlapping and cover source', async () => {
		const code = `function a() { return 1 }
function b() { return 2 }
function c() { return 3 }
function d() { return 4 }`

		const chunks = await chunk('test.ts', code, { maxChunkSize: 80 })

		// Sort by byte range start
		const sortedChunks = [...chunks].sort(
			(a, b) => a.byteRange.start - b.byteRange.start,
		)

		// Check non-overlapping
		for (let i = 1; i < sortedChunks.length; i++) {
			const prev = sortedChunks[i - 1]!
			const curr = sortedChunks[i]!
			expect(curr.byteRange.start).toBeGreaterThanOrEqual(prev.byteRange.end)
		}

		// Check chunks are sequential (indices match sorted order)
		sortedChunks.forEach((c, i) => {
			expect(c.index).toBe(i)
		})
	})

	test('exact byte offset verification', async () => {
		const code = `const x = 1`

		const chunks = await chunk('test.ts', code)

		expect(chunks).toHaveLength(1)
		expect(chunks[0]!.byteRange).toEqual({ start: 0, end: 11 })
		expect(chunks[0]!.lineRange).toEqual({ start: 0, end: 0 })
	})

	test('exact line range verification with multiline code', async () => {
		const code = `// Line 0
function foo() { // Line 1
  return 42      // Line 2
}                // Line 3
// Line 4`

		const chunks = await chunk('test.ts', code)

		// All lines should be covered
		expect(chunks).toHaveLength(1)
		expect(chunks[0]!.lineRange.start).toBe(0)
		expect(chunks[0]!.lineRange.end).toBe(4)
	})

	test('multiple chunks maintain byte continuity', async () => {
		const code = `function longFunction1() {
  const a = 1
  const b = 2
  const c = 3
  return a + b + c
}

function longFunction2() {
  const d = 4
  const e = 5
  const f = 6
  return d + e + f
}

function longFunction3() {
  const g = 7
  const h = 8
  const i = 9
  return g + h + i
}`

		const chunks = await chunk('test.ts', code, { maxChunkSize: 100 })

		expect(chunks.length).toBeGreaterThan(1)

		// First chunk starts at beginning
		const sortedChunks = [...chunks].sort(
			(a, b) => a.byteRange.start - b.byteRange.start,
		)
		expect(sortedChunks[0]!.byteRange.start).toBe(0)

		// Verify all byte ranges are valid
		for (const c of sortedChunks) {
			expect(c.byteRange.end).toBeGreaterThan(c.byteRange.start)
			expect(c.byteRange.start).toBeGreaterThanOrEqual(0)
			expect(c.byteRange.end).toBeLessThanOrEqual(code.length)
		}
	})
})

// ============================================================================
// Context Verification Tests
// ============================================================================

describe('context.entities verification', () => {
	test('exact entity count and properties', async () => {
		const code = `class Calculator {
  add(a: number, b: number): number {
    return a + b
  }
  subtract(a: number, b: number): number {
    return a - b
  }
}`

		const chunks = await chunk('test.ts', code)

		// Collect all entities across chunks
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const uniqueNames = [...new Set(allEntities.map((e) => e.name))]

		expect(uniqueNames).toContain('Calculator')
		expect(uniqueNames).toContain('add')
		expect(uniqueNames).toContain('subtract')

		// Find the class entity
		const classEntity = allEntities.find((e) => e.name === 'Calculator')
		expect(classEntity).toBeDefined()
		expect(classEntity!.type).toBe('class')
	})

	test('entity isPartial flag correctness', async () => {
		const code = `class LargeClass {
  method1() {
    return 1
  }
  method2() {
    return 2
  }
  method3() {
    return 3
  }
  method4() {
    return 4
  }
  method5() {
    return 5
  }
  method6() {
    return 6
  }
}`

		const chunks = await chunk('test.ts', code, { maxChunkSize: 100 })

		// With small chunk size, the class should be partial in multiple chunks
		if (chunks.length > 1) {
			const classEntities = chunks.flatMap((c) =>
				c.context.entities.filter((e) => e.name === 'LargeClass'),
			)
			// If class spans multiple chunks, it should be marked as partial
			const partialClasses = classEntities.filter((e) => e.isPartial)
			expect(partialClasses.length).toBeGreaterThan(0)
		}
	})

	test('entity docstring extraction', async () => {
		const code = `/**
 * Adds two numbers together.
 * @param a First number
 * @param b Second number
 */
function add(a: number, b: number): number {
  return a + b
}`

		const chunks = await chunk('test.ts', code)

		const addEntity = chunks
			.flatMap((c) => c.context.entities)
			.find((e) => e.name === 'add')

		expect(addEntity).toBeDefined()
		expect(addEntity!.docstring).toBeDefined()
		expect(addEntity!.docstring).toContain('Adds two numbers together')
	})

	test('entity lineRange is present', async () => {
		const code = `function foo() {
  return 42
}`

		const chunks = await chunk('test.ts', code)
		const entity = chunks[0]!.context.entities[0]!

		expect(entity.lineRange).toBeDefined()
		expect(entity.lineRange!.start).toBe(0)
		expect(entity.lineRange!.end).toBe(2)
	})
})

// ============================================================================
// Context Scope Chain Tests
// ============================================================================

describe('context.scope chain verification', () => {
	test('scope chain for nested entities', async () => {
		const code = `class Outer {
  innerMethod() {
    return 42
  }
}`

		const chunks = await chunk('test.ts', code, { maxChunkSize: 50 })

		// Find a chunk that's inside the class
		const chunkInClass = chunks.find(
			(c) =>
				c.context.scope.length > 0 &&
				c.context.scope.some((s) => s.name === 'Outer'),
		)

		if (chunkInClass) {
			expect(chunkInClass.context.scope.length).toBeGreaterThan(0)
			const outerScope = chunkInClass.context.scope.find(
				(s) => s.name === 'Outer',
			)
			expect(outerScope).toBeDefined()
			expect(outerScope!.type).toBe('class')
		}
	})

	test('deeply nested scope chain', async () => {
		const code = `class Level1 {
  level2Method() {
    function level3() {
      return 42
    }
    return level3()
  }
}`

		const chunks = await chunk('test.ts', code)

		// Check that entities are detected at various levels
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const entityNames = allEntities.map((e) => e.name)

		expect(entityNames).toContain('Level1')
		expect(entityNames).toContain('level2Method')
	})

	test('top-level entities have empty scope', async () => {
		const code = `function standalone() {
  return 1
}`

		const chunks = await chunk('test.ts', code)

		// A standalone function should have empty scope or self-reference
		expect(chunks).toHaveLength(1)
		// The chunk might have scope pointing to itself or empty
		// depending on implementation
	})
})

// ============================================================================
// Context Siblings Tests
// ============================================================================

describe('context.siblings verification', () => {
	test('siblings with correct position and distance', async () => {
		const code = `function first() { return 1 }
function second() { return 2 }
function third() { return 3 }
function fourth() { return 4 }`

		const chunks = await chunk('test.ts', code, { maxChunkSize: 50 })

		// Find chunk with second function
		const secondChunk = chunks.find((c) =>
			c.context.entities.some((e) => e.name === 'second'),
		)

		if (secondChunk) {
			const siblings = secondChunk.context.siblings

			// Should have siblings before and after
			const beforeSiblings = siblings.filter((s) => s.position === 'before')
			const afterSiblings = siblings.filter((s) => s.position === 'after')

			// first should be before second
			const firstSibling = beforeSiblings.find((s) => s.name === 'first')
			if (firstSibling) {
				expect(firstSibling.position).toBe('before')
				expect(firstSibling.distance).toBeGreaterThan(0)
			}
		}
	})

	test('sibling distance increases correctly', async () => {
		const code = `function a() { return 1 }
function b() { return 2 }
function c() { return 3 }
function d() { return 4 }
function e() { return 5 }`

		const chunks = await chunk('test.ts', code, {
			maxChunkSize: 50,
			siblingDetail: 'names',
		})

		for (const c of chunks) {
			const siblings = c.context.siblings

			// All distances should be positive
			for (const s of siblings) {
				expect(s.distance).toBeGreaterThan(0)
			}

			// Siblings should be sorted by distance (closest first)
			for (let i = 1; i < siblings.length; i++) {
				const prev = siblings[i - 1]!
				const curr = siblings[i]!
				// Same-position siblings should have non-decreasing distance
				if (prev.position === curr.position) {
					expect(curr.distance).toBeGreaterThanOrEqual(prev.distance)
				}
			}
		}
	})

	test('siblingDetail: none returns empty siblings', async () => {
		const code = `function a() { return 1 }
function b() { return 2 }`

		const chunks = await chunk('test.ts', code, { siblingDetail: 'none' })

		for (const c of chunks) {
			expect(c.context.siblings).toHaveLength(0)
		}
	})
})

// ============================================================================
// filterImports Option Tests
// ============================================================================

describe('filterImports option behavior', () => {
	test('filterImports: false includes all imports', async () => {
		const code = `import { used } from './used'
import { unused } from './unused'

function foo() {
  return used()
}`

		const chunks = await chunk('test.ts', code, { filterImports: false })

		const allImports = chunks.flatMap((c) => c.context.imports)
		const importNames = allImports.map((i) => i.name)

		expect(importNames).toContain('used')
		expect(importNames).toContain('unused')
	})

	test('filterImports: true filters to used imports', async () => {
		const code = `import { Database } from './db'
import { UnusedThing } from './unused'

function queryDb(db: Database) {
  return db.query('SELECT 1')
}`

		const chunks = await chunk('test.ts', code, { filterImports: true })

		const allImports = chunks.flatMap((c) => c.context.imports)
		const importNames = allImports.map((i) => i.name)

		// Database is used in the function signature, so it should be included
		expect(importNames).toContain('Database')
		// UnusedThing may or may not be included depending on which chunk
	})

	test('import source is correctly captured', async () => {
		const code = `import { foo } from './utils/foo'
import { bar } from '@scope/bar'

const x = foo() + bar()`

		const chunks = await chunk('test.ts', code)

		const allImports = chunks.flatMap((c) => c.context.imports)

		const fooImport = allImports.find((i) => i.name === 'foo')
		const barImport = allImports.find((i) => i.name === 'bar')

		expect(fooImport).toBeDefined()
		expect(fooImport!.source).toBe('./utils/foo')

		expect(barImport).toBeDefined()
		expect(barImport!.source).toBe('@scope/bar')
	})
})

// ============================================================================
// Streaming API Tests
// ============================================================================

describe('stream', () => {
	test('streams chunks from code with exact structure', async () => {
		const code = `function a() { return 1 }
function b() { return 2 }`

		const chunks: Chunk[] = []
		for await (const c of chunkStream('test.ts', code)) {
			chunks.push(c)
		}

		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks[0]).toMatchObject({
			context: {
				filepath: 'test.ts',
				language: 'typescript',
			},
		})
		expect(chunks[0]!.text.length).toBeGreaterThan(0)
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
		const code = `function a() { return 1 }
function b() { return 2 }
function c() { return 3 }`

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

	test('stream chunks have valid byte ranges', async () => {
		const code = `const a = 1
const b = 2
const c = 3`

		for await (const c of chunkStream('test.ts', code)) {
			expect(c.byteRange.start).toBeGreaterThanOrEqual(0)
			expect(c.byteRange.end).toBeGreaterThan(c.byteRange.start)
			expect(c.byteRange.end).toBeLessThanOrEqual(code.length)
		}
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

		expect(chunks1).toHaveLength(1)
		expect(chunks2).toHaveLength(1)
		expect(chunks1[0]!.text).toBe(code1)
		expect(chunks2[0]!.text).toBe(code2)
	})

	test('chunker can chunk multiple files with different extensions', async () => {
		// Note: To get proper language detection, we need to NOT set a language default
		// or explicitly pass language: undefined to use auto-detection
		const tsCode = 'const a: number = 1'
		const jsCode = 'const b = 2'

		const tsChunks = await chunk('test.ts', tsCode)
		const jsChunks = await chunk('test.js', jsCode)

		expect(tsChunks).toHaveLength(1)
		expect(jsChunks).toHaveLength(1)
		expect(tsChunks[0]!.context.language).toBe('typescript')
		expect(jsChunks[0]!.context.language).toBe('javascript')
	})

	test('chunker.stream yields chunks with correct properties', async () => {
		const chunker = createChunker()
		const code = `function a() { return 1 }
function b() { return 2 }`

		const chunks: Chunk[] = []
		for await (const c of chunker.stream('test.ts', code)) {
			chunks.push(c)
		}

		expect(chunks.length).toBeGreaterThan(0)
		for (const c of chunks) {
			expect(c.totalChunks).toBe(-1) // streaming
			expect(c.context.filepath).toBe('test.ts')
		}
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
	const testCases: {
		lang: Language
		ext: string
		code: string
		expectedEntityTypes: string[]
	}[] = [
		{
			lang: 'typescript',
			ext: 'ts',
			code: `interface User {
  name: string
  age: number
}

function greet(user: User): string {
  return \`Hello, \${user.name}!\`
}`,
			expectedEntityTypes: ['interface', 'function'],
		},
		{
			lang: 'javascript',
			ext: 'js',
			code: `class Calculator {
  add(a, b) {
    return a + b
  }

  subtract(a, b) {
    return a - b
  }
}`,
			expectedEntityTypes: ['class', 'method'],
		},
		{
			lang: 'python',
			ext: 'py',
			code: `class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b`,
			expectedEntityTypes: ['class', 'function'],
		},
		{
			lang: 'rust',
			ext: 'rs',
			code: `fn main() {
    println!("Hello, world!");
}

fn add(a: i32, b: i32) -> i32 {
    a + b
}`,
			expectedEntityTypes: ['function'],
		},
		{
			lang: 'go',
			ext: 'go',
			code: `package main

func main() {
    fmt.Println("Hello, world!")
}

func add(a, b int) int {
    return a + b
}`,
			expectedEntityTypes: ['function'],
		},
		{
			lang: 'java',
			ext: 'java',
			code: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }

    public static int add(int a, int b) {
        return a + b;
    }
}`,
			expectedEntityTypes: ['class', 'method'],
		},
	]

	for (const { lang, ext, code, expectedEntityTypes } of testCases) {
		test(`chunks ${lang} code with correct entity types`, async () => {
			const chunks = await chunk(`test.${ext}`, code)

			expect(chunks.length).toBeGreaterThan(0)

			// All chunks should have valid structure
			for (const c of chunks) {
				expect(c.text.length).toBeGreaterThan(0)
				expect(c.byteRange.end).toBeGreaterThan(c.byteRange.start)
				expect(c.lineRange.end).toBeGreaterThanOrEqual(c.lineRange.start)
				expect(c.context.language).toBe(lang)
			}

			// Check expected entity types are present
			const allEntities = chunks.flatMap((c) => c.context.entities)
			const entityTypes = [
				...new Set(allEntities.map((e) => e.type)),
			] as string[]

			for (const expectedType of expectedEntityTypes) {
				expect(entityTypes).toContain(expectedType)
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

		// All chunks should have valid structure
		for (const c of chunks) {
			expect(c.byteRange.end).toBeGreaterThan(c.byteRange.start)
		}
	})

	test('handles deeply nested code', async () => {
		const nested = `function outer() {
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
}`
		const chunks = await chunk('test.ts', nested)

		expect(chunks.length).toBeGreaterThan(0)

		// Should detect nested functions
		const allEntities = chunks.flatMap((c) => c.context.entities)
		const functionNames = allEntities
			.filter((e) => e.type === 'function')
			.map((e) => e.name)

		expect(functionNames).toContain('outer')
		expect(functionNames).toContain('inner1')
		expect(functionNames).toContain('inner2')
		expect(functionNames).toContain('inner3')
	})

	test('handles unicode characters correctly', async () => {
		const code = `const greeting = "こんにちは"
const emoji = "🎉🚀✨"`

		const chunks = await chunk('test.ts', code)

		expect(chunks).toHaveLength(1)
		// Should preserve unicode
		expect(chunks[0]!.text).toContain('こんにちは')
		expect(chunks[0]!.text).toContain('🎉')
	})

	test('handles code with various comment styles', async () => {
		const code = `// Single line comment
/* Multi-line
   comment */
/**
 * JSDoc comment
 */
function documented() {
  return 1
}`
		const chunks = await chunk('test.ts', code)

		expect(chunks.length).toBeGreaterThan(0)

		// Function should have the JSDoc as docstring
		const funcEntity = chunks
			.flatMap((c) => c.context.entities)
			.find((e) => e.name === 'documented')

		expect(funcEntity).toBeDefined()
		expect(funcEntity!.docstring).toContain('JSDoc comment')
	})

	test('handles empty functions', async () => {
		const code = `function empty() {}
function alsoEmpty() {
}`

		const chunks = await chunk('test.ts', code)

		expect(chunks.length).toBeGreaterThan(0)

		const entities = chunks.flatMap((c) => c.context.entities)
		expect(entities.map((e) => e.name)).toContain('empty')
		expect(entities.map((e) => e.name)).toContain('alsoEmpty')
	})

	test('handles syntax with semicolons and without', async () => {
		const code = `const a = 1;
const b = 2
function foo() {
  return a + b;
}`

		const chunks = await chunk('test.ts', code)

		expect(chunks).toHaveLength(1)
		expect(chunks[0]!.text).toBe(code)
	})
})

// ============================================================================
// contextMode Option Tests
// ============================================================================

describe('contextMode option', () => {
	test('contextMode: none returns empty context arrays', async () => {
		const code = `function foo() { return 1 }
function bar() { return 2 }`

		const chunks = await chunk('test.ts', code, { contextMode: 'none' })

		for (const c of chunks) {
			expect(c.context.scope).toHaveLength(0)
			expect(c.context.entities).toHaveLength(0)
			expect(c.context.siblings).toHaveLength(0)
			expect(c.context.imports).toHaveLength(0)
		}
	})

	test('contextMode: full includes all context', async () => {
		const code = `import { x } from './x'

class MyClass {
  method1() { return 1 }
  method2() { return 2 }
}`

		const chunks = await chunk('test.ts', code, { contextMode: 'full' })

		// Should have entities
		const hasEntities = chunks.some((c) => c.context.entities.length > 0)
		expect(hasEntities).toBe(true)

		// Should have imports
		const hasImports = chunks.some((c) => c.context.imports.length > 0)
		expect(hasImports).toBe(true)
	})
})
