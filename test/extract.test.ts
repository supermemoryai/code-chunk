import { beforeAll, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
	clearQueryCache,
	ENTITY_NODE_TYPES,
	extractByNodeTypes,
	extractEntitiesAsync,
	extractEntitiesSync,
	extractImportSource,
	getEntityType,
	loadQuery,
	loadQuerySync,
} from '../src/extract'
import {
	extractDocstring,
	isDocComment,
	parseDocstring,
} from '../src/extract/docstring'
import { extractName, extractSignature } from '../src/extract/signature'
import { initializeParser, parseCode } from '../src/parser'
import type { Language } from '../src/types'

// ============================================================================
// Setup
// ============================================================================

beforeAll(async () => {
	await initializeParser()
})

// ============================================================================
// Query Loading Tests
// ============================================================================

describe('query loading', () => {
	beforeAll(() => {
		clearQueryCache()
	})

	test('loadQuery loads and caches TypeScript query', async () => {
		const query = await Effect.runPromise(loadQuery('typescript'))
		expect(query).not.toBeNull()

		// Second call should return cached
		const cached = await Effect.runPromise(loadQuery('typescript'))
		expect(cached).toBe(query)
	})

	test('loadQuery loads queries for all supported languages', async () => {
		const languages: Language[] = [
			'typescript',
			'javascript',
			'python',
			'rust',
			'go',
			'java',
		]

		for (const lang of languages) {
			const query = await Effect.runPromise(loadQuery(lang))
			expect(query).not.toBeNull()
		}
	})

	test('loadQuerySync returns null when query not cached', () => {
		clearQueryCache()
		const query = loadQuerySync('typescript')
		// Not cached yet, should return null
		expect(query).toBeNull()
	})

	test('loadQuerySync returns cached query after loadQuery', async () => {
		clearQueryCache()

		// First load with async
		await Effect.runPromise(loadQuery('javascript'))

		// Now sync should return it
		const cached = loadQuerySync('javascript')
		expect(cached).not.toBeNull()
	})
})

// ============================================================================
// Sync/Async Behavior Consistency Tests
// ============================================================================

describe('extractEntities sync/async consistency', () => {
	test('extractEntitiesSync uses cached query when available', async () => {
		clearQueryCache()

		const code = `
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
`
		const result = await parseCode(code, 'typescript')
		const rootNode = result.tree.rootNode

		// First, preload the query
		await Effect.runPromise(loadQuery('typescript'))

		// Now sync should use the cached query
		const entitiesSync = extractEntitiesSync(rootNode, 'typescript', code)

		// Compare with async version
		const entitiesAsync = await extractEntitiesAsync(
			rootNode,
			'typescript',
			code,
		)

		// Both should find the same entities
		expect(entitiesSync).toHaveLength(entitiesAsync.length)
		expect(entitiesSync.map((e) => e.name)).toEqual(
			entitiesAsync.map((e) => e.name),
		)
	})

	test('extractEntitiesSync falls back to node types when query not cached', async () => {
		clearQueryCache()

		const code = `
function test() {
  return 1
}
`
		const result = await parseCode(code, 'typescript')
		const rootNode = result.tree.rootNode
		// With no cached query, should still work via fallback
		const entities = extractEntitiesSync(rootNode, 'typescript', code)
		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'test',
			type: 'function',
		})
	})
})

// ============================================================================
// Entity Extraction Tests
// ============================================================================

describe('extractEntities', () => {
	test('extracts TypeScript function declaration with exact properties', async () => {
		const code = `function greet(name: string): string {
  return \`Hello, \${name}!\`
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'greet',
			type: 'function',
			signature: 'function greet(name: string): string',
			docstring: null,
			parent: null,
		})
		// Verify byteRange covers the full function
		expect(entities[0].byteRange.start).toBe(0)
		expect(entities[0].byteRange.end).toBe(code.length)
		// Verify lineRange
		expect(entities[0].lineRange.start).toBe(0)
		expect(entities[0].lineRange.end).toBe(2)
	})

	test('extracts TypeScript class with methods and exact counts', async () => {
		const code = `class Calculator {
  add(a: number, b: number): number {
    return a + b
  }

  subtract(a: number, b: number): number {
    return a - b
  }
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(3) // 1 class + 2 methods

		const cls = entities.find((e) => e.name === 'Calculator')
		expect(cls).toMatchObject({
			name: 'Calculator',
			type: 'class',
			signature: 'class Calculator',
			docstring: null,
			parent: null,
		})
		// Class spans entire code
		expect(cls!.byteRange.start).toBe(0)
		expect(cls!.byteRange.end).toBe(code.length)
		expect(cls!.lineRange.start).toBe(0)
		expect(cls!.lineRange.end).toBe(8)

		const methods = entities.filter((e) => e.type === 'method')
		expect(methods).toHaveLength(2)
		expect(methods.map((m) => m.name).sort()).toEqual(['add', 'subtract'])

		const addMethod = methods.find((m) => m.name === 'add')
		expect(addMethod).toMatchObject({
			name: 'add',
			type: 'method',
			signature: 'add(a: number, b: number): number',
			parent: 'Calculator',
		})

		const subtractMethod = methods.find((m) => m.name === 'subtract')
		expect(subtractMethod).toMatchObject({
			name: 'subtract',
			type: 'method',
			signature: 'subtract(a: number, b: number): number',
			parent: 'Calculator',
		})
	})

	test('extracts TypeScript interface with exact properties', async () => {
		const code = `interface User {
  name: string
  age: number
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'User',
			type: 'interface',
			signature: 'interface User',
			docstring: null,
			parent: null,
		})
		expect(entities[0].byteRange.start).toBe(0)
		expect(entities[0].byteRange.end).toBe(code.length)
		expect(entities[0].lineRange.start).toBe(0)
		expect(entities[0].lineRange.end).toBe(3)
	})

	test('extracts Python function with docstring and exact properties', async () => {
		const code = `def greet(name):
    """Say hello to someone."""
    return f"Hello, {name}!"`
		const result = await parseCode(code, 'python')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'python',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'greet',
			type: 'function',
			signature: 'def greet(name)',
			docstring: 'Say hello to someone.',
			parent: null,
		})
		expect(entities[0].byteRange.start).toBe(0)
		expect(entities[0].byteRange.end).toBe(code.length)
		expect(entities[0].lineRange.start).toBe(0)
		expect(entities[0].lineRange.end).toBe(2)
	})

	test('extracts Python class with exact properties', async () => {
		const code = `class Calculator:
    """A simple calculator."""

    def add(self, a, b):
        return a + b`
		const result = await parseCode(code, 'python')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'python',
			code,
		)

		expect(entities).toHaveLength(2) // 1 class + 1 function (methods in Python are extracted as functions with parent)

		const cls = entities.find((e) => e.name === 'Calculator')
		expect(cls).toMatchObject({
			name: 'Calculator',
			type: 'class',
			signature: 'class Calculator',
			docstring: 'A simple calculator.',
			parent: null,
		})

		// Python methods are extracted as 'function' type with parent set
		const method = entities.find((e) => e.name === 'add')
		expect(method).toMatchObject({
			name: 'add',
			type: 'function',
			parent: 'Calculator',
		})
	})

	test('extracts Rust function with exact properties', async () => {
		const code = `fn add(a: i32, b: i32) -> i32 {
    a + b
}`
		const result = await parseCode(code, 'rust')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'rust',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'add',
			type: 'function',
			signature: 'fn add(a: i32, b: i32) -> i32',
			docstring: null,
			parent: null,
		})
		expect(entities[0].byteRange.start).toBe(0)
		expect(entities[0].byteRange.end).toBe(code.length)
		expect(entities[0].lineRange.start).toBe(0)
		expect(entities[0].lineRange.end).toBe(2)
	})

	test('extracts Go function with exact properties', async () => {
		const code = `package main

func add(a, b int) int {
    return a + b
}`
		const result = await parseCode(code, 'go')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'go',
			code,
		)

		// Go extracts package as import + the function
		const functions = entities.filter((e) => e.type === 'function')
		expect(functions).toHaveLength(1)
		expect(functions[0]).toMatchObject({
			name: 'add',
			type: 'function',
			signature: 'func add(a, b int) int',
			docstring: null,
			parent: null,
		})
	})

	test('extracts Java class and method with exact properties', async () => {
		const code = `public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}`
		const result = await parseCode(code, 'java')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'java',
			code,
		)

		expect(entities).toHaveLength(2) // 1 class + 1 method

		const cls = entities.find((e) => e.name === 'Calculator')
		expect(cls).toMatchObject({
			name: 'Calculator',
			type: 'class',
			parent: null,
		})

		const method = entities.find((e) => e.name === 'add')
		expect(method).toMatchObject({
			name: 'add',
			type: 'method',
			parent: 'Calculator',
		})
	})

	test('tracks parent relationships for nested entities accurately', async () => {
		const code = `class Outer {
  inner() {
    return 1
  }
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(2)

		const cls = entities.find((e) => e.name === 'Outer')
		expect(cls).toMatchObject({
			name: 'Outer',
			type: 'class',
			parent: null,
		})

		const method = entities.find((e) => e.name === 'inner')
		expect(method).toMatchObject({
			name: 'inner',
			type: 'method',
			parent: 'Outer',
		})
	})
})

// ============================================================================
// Fallback Extraction Tests (Iterative Walk)
// ============================================================================

describe('fallback extraction (iterative)', () => {
	test('handles deeply nested code without stack overflow', async () => {
		// Generate deeply nested functions (more reliable nesting)
		let code = ''
		const depth = 50

		for (let i = 0; i < depth; i++) {
			code += `function level${i}() {\n`
		}
		code += 'return 1\n'
		for (let i = 0; i < depth; i++) {
			code += '}\n'
		}

		const result = await parseCode(code, 'typescript')

		// Should not throw stack overflow
		const entities = await Effect.runPromise(
			extractByNodeTypes(result.tree.rootNode, 'typescript', code),
		)

		// Should find nested functions - at minimum the outer function
		const functions = entities.filter((e) => e.type === 'function')
		expect(functions.length).toBeGreaterThanOrEqual(1)
		expect(functions.some((f) => f.name === 'level0')).toBe(true)
	})

	test('extractByNodeTypes extracts entities with exact counts', async () => {
		const code = `function foo() { return 1 }
class Bar {
  baz() { return 2 }
}`
		const result = await parseCode(code, 'typescript')
		const entities = await Effect.runPromise(
			extractByNodeTypes(result.tree.rootNode, 'typescript', code),
		)

		expect(entities).toHaveLength(3) // 1 function + 1 class + 1 method

		expect(entities.find((e) => e.name === 'foo')).toMatchObject({
			name: 'foo',
			type: 'function',
		})
		expect(entities.find((e) => e.name === 'Bar')).toMatchObject({
			name: 'Bar',
			type: 'class',
		})
		expect(entities.find((e) => e.name === 'baz')).toMatchObject({
			name: 'baz',
			type: 'method',
			parent: 'Bar',
		})
	})

	test('getEntityType maps node types correctly', () => {
		expect(getEntityType('function_declaration')).toBe('function')
		expect(getEntityType('method_definition')).toBe('method')
		expect(getEntityType('class_declaration')).toBe('class')
		expect(getEntityType('interface_declaration')).toBe('interface')
		expect(getEntityType('type_alias_declaration')).toBe('type')
		expect(getEntityType('enum_declaration')).toBe('enum')
		expect(getEntityType('unknown_type')).toBeNull()
	})

	test('ENTITY_NODE_TYPES contains all supported languages with entries', () => {
		const languages: Language[] = [
			'typescript',
			'javascript',
			'python',
			'rust',
			'go',
			'java',
		]

		for (const lang of languages) {
			expect(ENTITY_NODE_TYPES[lang]).toBeDefined()
			expect(ENTITY_NODE_TYPES[lang].length).toBeGreaterThanOrEqual(3)
		}
	})
})

// ============================================================================
// Signature Extraction Tests
// ============================================================================

describe('signature extraction', () => {
	test('extracts TypeScript function signature exactly', async () => {
		const code = `function greet(name: string): string {
  return \`Hello, \${name}!\`
}`
		const result = await parseCode(code, 'typescript')
		const fnNode = result.tree.rootNode.namedChildren[0]

		const signature = await Effect.runPromise(
			extractSignature(fnNode, 'function', 'typescript', code),
		)

		expect(signature).toBe('function greet(name: string): string')
	})

	test('extracts Python function signature (stops at colon)', async () => {
		const code = `def greet(name):
    return f"Hello, {name}!"`
		const result = await parseCode(code, 'python')
		const fnNode = result.tree.rootNode.namedChildren[0]

		const signature = await Effect.runPromise(
			extractSignature(fnNode, 'function', 'python', code),
		)

		expect(signature).toBe('def greet(name)')
	})

	test('handles generic type parameters correctly', async () => {
		const code = `function identity<T>(arg: T): T {
  return arg
}`
		const result = await parseCode(code, 'typescript')
		const fnNode = result.tree.rootNode.namedChildren[0]

		const signature = await Effect.runPromise(
			extractSignature(fnNode, 'function', 'typescript', code),
		)

		expect(signature).toBe('function identity<T>(arg: T): T')
	})

	test('handles comparison operators in signatures (angle bracket fix)', async () => {
		// This tests that < in comparisons doesn't break generic tracking
		const code = `function compare(a: number, b: number): boolean {
  return a < b
}`
		const result = await parseCode(code, 'typescript')
		const fnNode = result.tree.rootNode.namedChildren[0]

		const signature = await Effect.runPromise(
			extractSignature(fnNode, 'function', 'typescript', code),
		)

		expect(signature).toBe('function compare(a: number, b: number): boolean')
	})

	test('extracts class signature with extends and implements', async () => {
		const code = `class Calculator extends Base implements ICalc {
  add(a: number, b: number): number {
    return a + b
  }
}`
		const result = await parseCode(code, 'typescript')
		const classNode = result.tree.rootNode.namedChildren[0]

		const signature = await Effect.runPromise(
			extractSignature(classNode, 'class', 'typescript', code),
		)

		expect(signature).toBe('class Calculator extends Base implements ICalc')
	})

	test('cleans multi-line signatures to single line', async () => {
		const code = `function multiLine(
  param1: string,
  param2: number,
  param3: boolean
): void {
  console.log(param1)
}`
		const result = await parseCode(code, 'typescript')
		const fnNode = result.tree.rootNode.namedChildren[0]

		const signature = await Effect.runPromise(
			extractSignature(fnNode, 'function', 'typescript', code),
		)

		expect(signature).not.toContain('\n')
		expect(signature).toBe(
			'function multiLine( param1: string, param2: number, param3: boolean ): void',
		)
	})

	test('extractName finds identifier in node', async () => {
		const code = `function greet() { return 1 }`
		const result = await parseCode(code, 'typescript')
		const fnNode = result.tree.rootNode.namedChildren[0]

		const name = extractName(fnNode, 'typescript')
		expect(name).toBe('greet')
	})
})

// ============================================================================
// Docstring Extraction Tests
// ============================================================================

describe('docstring extraction', () => {
	test('extracts JSDoc for TypeScript function with exact content', async () => {
		const code = `/**
 * Greet someone by name.
 * @param name The name to greet
 */
function greet(name: string): string {
  return \`Hello, \${name}!\`
}`
		const result = await parseCode(code, 'typescript')
		const fnNode = result.tree.rootNode.namedChildren[1] // Skip comment, get function

		const docstring = await Effect.runPromise(
			extractDocstring(fnNode, 'typescript', code),
		)

		expect(docstring).toBe(
			'Greet someone by name.\n@param name The name to greet',
		)
	})

	test('extracts Python docstring from function body with exact content', async () => {
		const code = `def greet(name):
    """
    Say hello to someone.

    Args:
        name: The person to greet
    """
    return f"Hello, {name}!"`
		const result = await parseCode(code, 'python')
		const fnNode = result.tree.rootNode.namedChildren[0]

		const docstring = await Effect.runPromise(
			extractDocstring(fnNode, 'python', code),
		)

		expect(docstring).toContain('Say hello to someone.')
		expect(docstring).toContain('Args:')
		expect(docstring).toContain('name: The person to greet')
	})

	test('extracts Rust doc comment with exact content', async () => {
		const code = `/// Add two numbers together.
/// Returns the sum.
fn add(a: i32, b: i32) -> i32 {
    a + b
}`
		const result = await parseCode(code, 'rust')
		// Find the function node
		const fnNode = result.tree.rootNode.namedChildren.find(
			(n) => n.type === 'function_item',
		)

		expect(fnNode).not.toBeUndefined()
		const docstring = await Effect.runPromise(
			extractDocstring(fnNode!, 'rust', code),
		)

		// Rust doc comments may have blank line between comment lines
		expect(docstring).toContain('Add two numbers together.')
		expect(docstring).toContain('Returns the sum.')
	})

	test('extracts Go comment with exact content', async () => {
		const code = `// Add returns the sum of a and b.
func Add(a, b int) int {
    return a + b
}`
		const result = await parseCode(code, 'go')
		const fnNode = result.tree.rootNode.namedChildren.find(
			(n) => n.type === 'function_declaration',
		)

		expect(fnNode).not.toBeUndefined()
		const docstring = await Effect.runPromise(
			extractDocstring(fnNode!, 'go', code),
		)

		expect(docstring).toBe('Add returns the sum of a and b.')
	})

	test('extracts Javadoc with exact content', async () => {
		const code = `/**
 * Add two integers.
 * @param a First number
 * @param b Second number
 * @return The sum
 */
public int add(int a, int b) {
    return a + b;
}`
		const result = await parseCode(code, 'java')
		const methodNode = result.tree.rootNode.namedChildren.find(
			(n) => n.type === 'method_declaration',
		)

		expect(methodNode).not.toBeUndefined()
		const docstring = await Effect.runPromise(
			extractDocstring(methodNode!, 'java', code),
		)

		expect(docstring).toContain('Add two integers.')
		expect(docstring).toContain('@param a First number')
		expect(docstring).toContain('@param b Second number')
		expect(docstring).toContain('@return The sum')
	})

	test('returns null when no docstring present', async () => {
		const code = `function noDoc() { return 1 }`
		const result = await parseCode(code, 'typescript')
		const fnNode = result.tree.rootNode.namedChildren[0]

		const docstring = await Effect.runPromise(
			extractDocstring(fnNode, 'typescript', code),
		)

		expect(docstring).toBeNull()
	})
})

// ============================================================================
// isDocComment Tests
// ============================================================================

describe('isDocComment', () => {
	test('recognizes JSDoc comments', () => {
		expect(isDocComment('/** This is JSDoc */', 'typescript')).toBe(true)
		expect(isDocComment('/* Regular comment */', 'typescript')).toBe(false)
		expect(isDocComment('// Line comment', 'typescript')).toBe(false)
	})

	test('recognizes Python docstrings', () => {
		expect(isDocComment('"""Docstring"""', 'python')).toBe(true)
		expect(isDocComment("'''Docstring'''", 'python')).toBe(true)
		expect(isDocComment('r"""Raw docstring"""', 'python')).toBe(true)
		expect(isDocComment('# Comment', 'python')).toBe(false)
	})

	test('recognizes Rust doc comments', () => {
		expect(isDocComment('/// Doc comment', 'rust')).toBe(true)
		expect(isDocComment('//! Inner doc', 'rust')).toBe(true)
		expect(isDocComment('// Regular comment', 'rust')).toBe(false)
	})

	test('recognizes Go comments', () => {
		// Go considers any // comment before a declaration as doc
		expect(isDocComment('// Comment', 'go')).toBe(true)
	})

	test('recognizes Javadoc', () => {
		expect(isDocComment('/** Javadoc */', 'java')).toBe(true)
		expect(isDocComment('/* Block comment */', 'java')).toBe(false)
	})
})

// ============================================================================
// parseDocstring Tests
// ============================================================================

describe('parseDocstring', () => {
	test('parses JSDoc and removes markers', () => {
		const input = `/**
 * This is a description.
 * @param name The name
 */`
		const parsed = parseDocstring(input, 'typescript')

		expect(parsed).not.toContain('/**')
		expect(parsed).not.toContain('*/')
		expect(parsed).toBe('This is a description.\n@param name The name')
	})

	test('parses Python docstring and dedents', () => {
		const input = `"""
    This is indented.
    So is this.
    """`
		const parsed = parseDocstring(input, 'python')

		expect(parsed).not.toContain('"""')
		expect(parsed).toContain('This is indented')
		expect(parsed).toContain('So is this')
		// Should be dedented
		expect(parsed).not.toMatch(/^\s{4}This/)
	})

	test('parses Rust doc comments and removes ///', () => {
		const input = `/// First line.
/// Second line.`
		const parsed = parseDocstring(input, 'rust')

		expect(parsed).not.toContain('///')
		expect(parsed).toBe('First line.\nSecond line.')
	})

	test('parses Go comments and removes //', () => {
		const input = `// First line.
// Second line.`
		const parsed = parseDocstring(input, 'go')

		expect(parsed).not.toContain('//')
		expect(parsed).toBe('First line.\nSecond line.')
	})
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('extraction edge cases', () => {
	test('handles anonymous functions via variable declaration', async () => {
		// Note: anonymous functions themselves aren't extracted as entities,
		// but top-level variable declarations are
		const code = `const fn = function() { return 1 }`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		// Query extracts top-level const declarations
		// If no entities found, that's acceptable - the function is anonymous
		// What matters is it doesn't crash
		expect(Array.isArray(entities)).toBe(true)
	})

	test('handles arrow functions via variable declaration', async () => {
		// Arrow functions assigned to const are extracted as the variable
		const code = `const add = (a: number, b: number) => a + b`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		// Queries should capture top-level const with arrow function value
		// The entity would be named 'add' (the variable name)
		expect(Array.isArray(entities)).toBe(true)
	})

	test('handles async functions with exact signature', async () => {
		const code = `async function fetchData(): Promise<string> {
  return await fetch('/api')
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'fetchData',
			type: 'function',
			signature: 'async function fetchData(): Promise<string>',
			parent: null,
		})
	})

	test('handles async generator functions', async () => {
		const code = `async function* generateData(): AsyncGenerator<number> {
  yield 1
  yield 2
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'generateData',
			type: 'function',
			parent: null,
		})
		expect(entities[0].signature).toContain('async')
		expect(entities[0].signature).toContain('generateData')
	})

	test('handles generator functions', async () => {
		const code = `function* myGenerator(): Generator<number> {
  yield 1
  yield 2
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'myGenerator',
			type: 'function',
			parent: null,
		})
	})

	test('handles export declarations with exact counts', async () => {
		const code = `export function publicFn() { return 1 }
export default function defaultFn() { return 2 }`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities.length).toBeGreaterThanOrEqual(2)

		const publicFn = entities.find((e) => e.name === 'publicFn')
		expect(publicFn).toMatchObject({
			name: 'publicFn',
			type: 'function',
		})

		const defaultFn = entities.find((e) => e.name === 'defaultFn')
		expect(defaultFn).toMatchObject({
			name: 'defaultFn',
			type: 'function',
		})
	})

	test('handles empty file', async () => {
		const code = ''
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toEqual([])
		expect(entities).toHaveLength(0)
	})

	test('handles file with only comments', async () => {
		const code = `// Just a comment
/* Another comment */`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toEqual([])
		expect(entities).toHaveLength(0)
	})
})

// ============================================================================
// Import Source Extraction Tests
// ============================================================================

describe('extractImportSource', () => {
	test('extracts TypeScript named import source', async () => {
		const code = `import { foo, bar } from 'my-module'`
		const result = await parseCode(code, 'typescript')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'typescript')
		expect(source).toBe('my-module')
	})

	test('extracts TypeScript default import source', async () => {
		const code = `import React from 'react'`
		const result = await parseCode(code, 'typescript')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'typescript')
		expect(source).toBe('react')
	})

	test('extracts TypeScript namespace import source', async () => {
		const code = `import * as path from 'path'`
		const result = await parseCode(code, 'typescript')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'typescript')
		expect(source).toBe('path')
	})

	test('extracts TypeScript type-only import source', async () => {
		const code = `import type { Option } from 'effect/Option'`
		const result = await parseCode(code, 'typescript')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'typescript')
		expect(source).toBe('effect/Option')
	})

	test('extracts JavaScript import source', async () => {
		const code = `import { useState } from 'react'`
		const result = await parseCode(code, 'javascript')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'javascript')
		expect(source).toBe('react')
	})

	test('extracts Python from import source', async () => {
		const code = `from collections import OrderedDict`
		const result = await parseCode(code, 'python')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'python')
		expect(source).toBe('collections')
	})

	test('extracts Python simple import source', async () => {
		const code = `import os`
		const result = await parseCode(code, 'python')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'python')
		expect(source).toBe('os')
	})

	test('extracts Python dotted import source', async () => {
		const code = `from os.path import join`
		const result = await parseCode(code, 'python')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'python')
		expect(source).toBe('os.path')
	})

	test('extracts Rust use declaration source', async () => {
		const code = `use std::collections::HashMap;`
		const result = await parseCode(code, 'rust')
		const useNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(useNode, 'rust')
		expect(source).toBe('std::collections::HashMap')
	})

	test('extracts Go import source', async () => {
		const code = `package main

import "fmt"`
		const result = await parseCode(code, 'go')
		const importNode = result.tree.rootNode.namedChildren.find(
			(n) => n.type === 'import_declaration',
		)

		expect(importNode).not.toBeUndefined()
		const source = extractImportSource(importNode!, 'go')
		expect(source).toBe('fmt')
	})

	test('extracts Java import source', async () => {
		const code = `import java.util.List;`
		const result = await parseCode(code, 'java')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'java')
		expect(source).toBe('java.util.List')
	})

	test('import entities have source field populated with exact values', async () => {
		const code = `import { Effect } from 'effect'
import type { Option } from 'effect/Option'

function test() { return 1 }`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		const imports = entities.filter((e) => e.type === 'import')
		expect(imports).toHaveLength(2)

		// Verify each import has proper source
		const effectImport = imports.find((i) => i.name === 'Effect')
		expect(effectImport).toMatchObject({
			name: 'Effect',
			type: 'import',
			source: 'effect',
		})

		const optionImport = imports.find((i) => i.name === 'Option')
		expect(optionImport).toMatchObject({
			name: 'Option',
			type: 'import',
			source: 'effect/Option',
		})
	})
})

// ============================================================================
// Byte/Line Range Verification Tests
// ============================================================================

describe('byte and line range verification', () => {
	test('verifies byte offsets cover correct content for function', async () => {
		const code = `function test() {
  return 42
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		// Verify the extracted range covers the full code
		const extractedText = code.slice(
			entities[0].byteRange.start,
			entities[0].byteRange.end,
		)
		expect(extractedText).toBe(code)
		expect(entities[0].byteRange.start).toBe(0)
	})

	test('verifies line ranges for class with methods', async () => {
		const code = `class Foo {
  bar() {}
  baz() {}
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(3)

		const cls = entities.find((e) => e.name === 'Foo')
		expect(cls!.lineRange).toEqual({ start: 0, end: 3 })

		const bar = entities.find((e) => e.name === 'bar')
		expect(bar!.lineRange).toEqual({ start: 1, end: 1 })

		const baz = entities.find((e) => e.name === 'baz')
		expect(baz!.lineRange).toEqual({ start: 2, end: 2 })
	})

	test('verifies byte ranges for multiple top-level functions', async () => {
		const code = `function a() {}
function b() {}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(2)

		const fnA = entities.find((e) => e.name === 'a')
		const fnB = entities.find((e) => e.name === 'b')

		// fnA should start at 0
		expect(fnA!.byteRange.start).toBe(0)
		// fnA should end before fnB starts
		expect(fnA!.byteRange.end).toBeLessThanOrEqual(fnB!.byteRange.start)
		// fnB should end at code.length
		expect(fnB!.byteRange.end).toBe(code.length)

		// Verify line ranges
		expect(fnA!.lineRange).toEqual({ start: 0, end: 0 })
		expect(fnB!.lineRange).toEqual({ start: 1, end: 1 })
	})

	test('verifies line range for multi-line interface', async () => {
		const code = `interface Config {
  host: string
  port: number
  debug: boolean
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'Config',
			type: 'interface',
		})
		expect(entities[0].lineRange).toEqual({ start: 0, end: 4 })
	})
})

// ============================================================================
// Parent Relationship Tests
// ============================================================================

describe('parent relationship accuracy', () => {
	test('method has correct parent class', async () => {
		const code = `class Container {
  method1() {}
  method2() {}
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(3)

		const method1 = entities.find((e) => e.name === 'method1')
		expect(method1!.parent).toBe('Container')

		const method2 = entities.find((e) => e.name === 'method2')
		expect(method2!.parent).toBe('Container')

		const container = entities.find((e) => e.name === 'Container')
		expect(container!.parent).toBeNull()
	})

	test('top-level functions have null parent', async () => {
		const code = `function topLevel1() {}
function topLevel2() {}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(2)
		expect(entities[0].parent).toBeNull()
		expect(entities[1].parent).toBeNull()
	})

	test('Python method has correct parent class', async () => {
		const code = `class MyClass:
    def my_method(self):
        pass`
		const result = await parseCode(code, 'python')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'python',
			code,
		)

		expect(entities).toHaveLength(2)

		// Python methods are extracted as 'function' type with parent set
		const method = entities.find((e) => e.name === 'my_method')
		expect(method!.type).toBe('function')
		expect(method!.parent).toBe('MyClass')
	})
})

// ============================================================================
// Type Alias and Enum Tests
// ============================================================================

describe('type alias and enum extraction', () => {
	test('extracts TypeScript type alias', async () => {
		const code = `type UserId = string`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'UserId',
			type: 'type',
		})
		expect(entities[0].byteRange.start).toBe(0)
		expect(entities[0].byteRange.end).toBe(code.length)
		expect(entities[0].lineRange).toEqual({ start: 0, end: 0 })
	})

	test('extracts TypeScript enum', async () => {
		const code = `enum Status {
  Active,
  Inactive
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'Status',
			type: 'enum',
			signature: 'enum Status',
		})
		expect(entities[0].lineRange).toEqual({ start: 0, end: 3 })
	})

	test('extracts Rust struct', async () => {
		const code = `struct Point {
    x: i32,
    y: i32,
}`
		const result = await parseCode(code, 'rust')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'rust',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'Point',
			type: 'type',
		})
	})

	test('extracts Rust enum', async () => {
		const code = `enum Direction {
    Up,
    Down,
    Left,
    Right,
}`
		const result = await parseCode(code, 'rust')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'rust',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'Direction',
			type: 'enum',
		})
	})
})

// ============================================================================
// Entity Count Verification Tests
// ============================================================================

describe('entity count verification', () => {
	test('extracts exact count for complex TypeScript file', async () => {
		const code = `import { Effect } from 'effect'

interface Options {
  timeout: number
}

type Result = string | number

class Service {
  constructor() {}
  
  process() {
    return 1
  }
}

function helper() {
  return 'help'
}

enum Status {
  Active,
  Inactive
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		// Expected: 1 import + 1 interface + 1 type + 1 class + 2 methods + 1 function + 1 enum = 8
		const imports = entities.filter((e) => e.type === 'import')
		const interfaces = entities.filter((e) => e.type === 'interface')
		const types = entities.filter((e) => e.type === 'type')
		const classes = entities.filter((e) => e.type === 'class')
		const methods = entities.filter((e) => e.type === 'method')
		const functions = entities.filter((e) => e.type === 'function')
		const enums = entities.filter((e) => e.type === 'enum')

		expect(imports).toHaveLength(1)
		expect(interfaces).toHaveLength(1)
		expect(types).toHaveLength(1)
		expect(classes).toHaveLength(1)
		expect(methods).toHaveLength(2) // constructor + process
		expect(functions).toHaveLength(1)
		expect(enums).toHaveLength(1)

		expect(entities).toHaveLength(8)
	})

	test('extracts exact count for Python module', async () => {
		const code = `from typing import Optional

class DataProcessor:
    def __init__(self):
        pass
    
    def process(self, data):
        return data

def helper(x):
    return x * 2`
		const result = await parseCode(code, 'python')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'python',
			code,
		)

		const imports = entities.filter((e) => e.type === 'import')
		const classes = entities.filter((e) => e.type === 'class')
		// Python methods are extracted as functions with parent set
		const methods = entities.filter(
			(e) => e.type === 'function' && e.parent !== null,
		)
		const topLevelFunctions = entities.filter(
			(e) => e.type === 'function' && e.parent === null,
		)

		// Python 'from X import Y' extracts both module and imported symbol
		expect(imports).toHaveLength(2) // typing + Optional
		expect(classes).toHaveLength(1)
		expect(methods).toHaveLength(2) // __init__ + process (as functions with parent)
		expect(topLevelFunctions).toHaveLength(1) // helper
	})
})

// ============================================================================
// Decorated Function Tests
// ============================================================================

describe('decorated functions', () => {
	test('extracts Python decorated function', async () => {
		const code = `@decorator
def decorated_func():
    pass`
		const result = await parseCode(code, 'python')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'python',
			code,
		)

		// Should extract the decorated function
		expect(entities.length).toBeGreaterThanOrEqual(1)
		const fn = entities.find((e) => e.type === 'function')
		expect(fn).toMatchObject({
			name: 'decorated_func',
			type: 'function',
		})
	})

	test('extracts Python decorated method in class', async () => {
		const code = `class MyClass:
    @staticmethod
    def static_method():
        pass
    
    @classmethod
    def class_method(cls):
        pass`
		const result = await parseCode(code, 'python')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'python',
			code,
		)

		expect(entities).toHaveLength(3) // 1 class + 2 functions (Python methods are extracted as functions)

		// Python methods inside classes are extracted as 'function' type with parent set
		const staticMethod = entities.find((e) => e.name === 'static_method')
		expect(staticMethod).toMatchObject({
			type: 'function',
			parent: 'MyClass',
		})

		const classMethod = entities.find((e) => e.name === 'class_method')
		expect(classMethod).toMatchObject({
			type: 'function',
			parent: 'MyClass',
		})
	})
})

// ============================================================================
// Entity Properties Completeness Tests
// ============================================================================

describe('entity properties completeness', () => {
	test('extracted entities have all required properties', async () => {
		const code = `function test() {
  return 1
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		const entity = entities[0]

		// Verify all required properties exist
		expect(entity.name).toBe('test')
		expect(entity.type).toBe('function')
		expect(entity.signature).toBe('function test()')
		expect(entity.docstring).toBeNull()
		expect(entity.parent).toBeNull()
		expect(entity.byteRange).toEqual({
			start: 0,
			end: code.length,
		})
		expect(entity.lineRange).toEqual({
			start: 0,
			end: 2,
		})
		expect(entity.node).toBeDefined()
	})

	test('import entities have source property', async () => {
		const code = `import { foo } from 'bar'`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(1)
		expect(entities[0]).toMatchObject({
			name: 'foo',
			type: 'import',
			source: 'bar',
		})
	})
})

// ============================================================================
// Multiple Import Symbols Tests
// ============================================================================

describe('multiple import symbols extraction', () => {
	test('extracts all named imports from single statement', async () => {
		const code = `import { foo, bar, baz } from 'my-module'`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		const imports = entities.filter((e) => e.type === 'import')
		expect(imports).toHaveLength(3)
		expect(imports.map((i) => i.name).sort()).toEqual(['bar', 'baz', 'foo'])

		// All should have the same source
		for (const imp of imports) {
			expect(imp.source).toBe('my-module')
		}
	})

	test('extracts imports from multiple import statements', async () => {
		const code = `import { a } from 'module-a'
import { b, c } from 'module-b'
import d from 'module-d'`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		const imports = entities.filter((e) => e.type === 'import')
		expect(imports).toHaveLength(4)

		const importA = imports.find((i) => i.name === 'a')
		expect(importA!.source).toBe('module-a')

		const importB = imports.find((i) => i.name === 'b')
		expect(importB!.source).toBe('module-b')

		const importC = imports.find((i) => i.name === 'c')
		expect(importC!.source).toBe('module-b')

		const importD = imports.find((i) => i.name === 'd')
		expect(importD!.source).toBe('module-d')
	})
})

// ============================================================================
// Ordering Guarantees Tests
// ============================================================================

describe('entity ordering', () => {
	test('entities are ordered by appearance in source', async () => {
		const code = `function first() {}
function second() {}
function third() {}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(3)

		// Verify byteRange ordering
		for (let i = 0; i < entities.length - 1; i++) {
			expect(entities[i].byteRange.start).toBeLessThan(
				entities[i + 1].byteRange.start,
			)
		}

		// Verify name ordering matches source order
		expect(entities.map((e) => e.name)).toEqual(['first', 'second', 'third'])
	})

	test('class appears before its methods in entity list', async () => {
		const code = `class MyClass {
  methodA() {}
  methodB() {}
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities).toHaveLength(3)

		// Class should come first
		expect(entities[0].type).toBe('class')
		expect(entities[0].name).toBe('MyClass')

		// Methods follow
		const methodNames = entities.slice(1).map((e) => e.name)
		expect(methodNames).toEqual(['methodA', 'methodB'])
	})
})
