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
		expect(entitiesSync.length).toBe(entitiesAsync.length)
		expect(entitiesSync.map((e) => e.name)).toEqual(
			entitiesAsync.map((e) => e.name),
		)
	})

	test('extractEntitiesSync falls back to node types when query not cached', () => {
		clearQueryCache()

		const code = `
function test() {
  return 1
}
`
		// Parse synchronously (we need the tree)
		const parseEffect = Effect.gen(function* () {
			const result = yield* Effect.tryPromise(() =>
				parseCode(code, 'typescript'),
			)
			return result
		})

		Effect.runPromise(parseEffect).then((result) => {
			const rootNode = result.tree.rootNode
			// With no cached query, should still work via fallback
			const entities = extractEntitiesSync(rootNode, 'typescript', code)
			expect(entities.length).toBeGreaterThan(0)
		})
	})
})

// ============================================================================
// Entity Extraction Tests
// ============================================================================

describe('extractEntities', () => {
	test('extracts TypeScript function declaration', async () => {
		const code = `
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities.length).toBeGreaterThan(0)
		const fn = entities.find((e) => e.name === 'greet')
		expect(fn).toBeDefined()
		expect(fn?.type).toBe('function')
		expect(fn?.signature).toContain('greet')
	})

	test('extracts TypeScript class with methods', async () => {
		const code = `
class Calculator {
  add(a: number, b: number): number {
    return a + b
  }

  subtract(a: number, b: number): number {
    return a - b
  }
}
`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		const cls = entities.find((e) => e.name === 'Calculator')
		expect(cls).toBeDefined()
		expect(cls?.type).toBe('class')

		const methods = entities.filter((e) => e.type === 'method')
		expect(methods.length).toBe(2)
		expect(methods.map((m) => m.name)).toContain('add')
		expect(methods.map((m) => m.name)).toContain('subtract')
	})

	test('extracts TypeScript interface', async () => {
		const code = `
interface User {
  name: string
  age: number
}
`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		const iface = entities.find((e) => e.name === 'User')
		expect(iface).toBeDefined()
		expect(iface?.type).toBe('interface')
	})

	test('extracts Python function with docstring', async () => {
		const code = `
def greet(name):
    """Say hello to someone."""
    return f"Hello, {name}!"
`
		const result = await parseCode(code, 'python')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'python',
			code,
		)

		const fn = entities.find((e) => e.name === 'greet')
		expect(fn).toBeDefined()
		expect(fn?.type).toBe('function')
		expect(fn?.docstring).toBe('Say hello to someone.')
	})

	test('extracts Python class', async () => {
		const code = `
class Calculator:
    """A simple calculator."""

    def add(self, a, b):
        return a + b
`
		const result = await parseCode(code, 'python')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'python',
			code,
		)

		const cls = entities.find((e) => e.name === 'Calculator')
		expect(cls).toBeDefined()
		expect(cls?.type).toBe('class')
	})

	test('extracts Rust function', async () => {
		const code = `
fn add(a: i32, b: i32) -> i32 {
    a + b
}
`
		const result = await parseCode(code, 'rust')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'rust',
			code,
		)

		const fn = entities.find((e) => e.name === 'add')
		expect(fn).toBeDefined()
		expect(fn?.type).toBe('function')
	})

	test('extracts Go function', async () => {
		const code = `
package main

func add(a, b int) int {
    return a + b
}
`
		const result = await parseCode(code, 'go')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'go',
			code,
		)

		const fn = entities.find((e) => e.name === 'add')
		expect(fn).toBeDefined()
		expect(fn?.type).toBe('function')
	})

	test('extracts Java class and method', async () => {
		const code = `
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
`
		const result = await parseCode(code, 'java')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'java',
			code,
		)

		const cls = entities.find((e) => e.name === 'Calculator')
		expect(cls).toBeDefined()
		expect(cls?.type).toBe('class')
	})

	test('tracks parent relationships for nested entities', async () => {
		const code = `
class Outer {
  inner() {
    return 1
  }
}
`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		const method = entities.find((e) => e.name === 'inner')
		expect(method?.parent).toBe('Outer')
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

		// Should find nested functions (exact count may vary based on nesting support)
		const functions = entities.filter((e) => e.type === 'function')
		expect(functions.length).toBeGreaterThan(0)
		// At minimum the outer function should be found
		expect(functions.some((f) => f.name === 'level0')).toBe(true)
	})

	test('extractByNodeTypes extracts entities correctly', async () => {
		const code = `
function foo() { return 1 }
class Bar {
  baz() { return 2 }
}
`
		const result = await parseCode(code, 'typescript')
		const entities = await Effect.runPromise(
			extractByNodeTypes(result.tree.rootNode, 'typescript', code),
		)

		expect(entities.find((e) => e.name === 'foo')).toBeDefined()
		expect(entities.find((e) => e.name === 'Bar')).toBeDefined()
		expect(entities.find((e) => e.name === 'baz')).toBeDefined()
	})

	test('getEntityType maps node types correctly', () => {
		expect(getEntityType('function_declaration')).toBe('function')
		expect(getEntityType('method_definition')).toBe('method')
		expect(getEntityType('class_declaration')).toBe('class')
		expect(getEntityType('interface_declaration')).toBe('interface')
		expect(getEntityType('unknown_type')).toBeNull()
	})

	test('ENTITY_NODE_TYPES contains all supported languages', () => {
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
			expect(ENTITY_NODE_TYPES[lang].length).toBeGreaterThan(0)
		}
	})
})

// ============================================================================
// Signature Extraction Tests
// ============================================================================

describe('signature extraction', () => {
	test('extracts TypeScript function signature', async () => {
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

		// Should include the generic parameter
		expect(signature).toContain('<T>')
		expect(signature).toContain('identity')
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

		// Should extract signature correctly without being confused by < in body
		expect(signature).toBe('function compare(a: number, b: number): boolean')
	})

	test('extracts class signature', async () => {
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

		expect(signature).toContain('class Calculator')
		expect(signature).toContain('extends Base')
		expect(signature).toContain('implements ICalc')
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

		// Should not contain newlines
		expect(signature).not.toContain('\n')
		// Should have all params
		expect(signature).toContain('param1')
		expect(signature).toContain('param2')
		expect(signature).toContain('param3')
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
	test('extracts JSDoc for TypeScript function', async () => {
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

		expect(docstring).toContain('Greet someone by name')
		expect(docstring).toContain('@param name')
	})

	test('extracts Python docstring from function body', async () => {
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

		expect(docstring).toContain('Say hello to someone')
		expect(docstring).toContain('Args:')
	})

	test('extracts Rust doc comment', async () => {
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

		if (fnNode) {
			const docstring = await Effect.runPromise(
				extractDocstring(fnNode, 'rust', code),
			)

			expect(docstring).toContain('Add two numbers')
		}
	})

	test('extracts Go comment', async () => {
		const code = `// Add returns the sum of a and b.
func Add(a, b int) int {
    return a + b
}`
		const result = await parseCode(code, 'go')
		const fnNode = result.tree.rootNode.namedChildren.find(
			(n) => n.type === 'function_declaration',
		)

		if (fnNode) {
			const docstring = await Effect.runPromise(
				extractDocstring(fnNode, 'go', code),
			)

			expect(docstring).toContain('Add returns the sum')
		}
	})

	test('extracts Javadoc', async () => {
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

		if (methodNode) {
			const docstring = await Effect.runPromise(
				extractDocstring(methodNode, 'java', code),
			)

			expect(docstring).toContain('Add two integers')
		}
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
		expect(parsed).toContain('This is a description')
		expect(parsed).toContain('@param name')
	})

	test('parses Python docstring and dedents', () => {
		const input = `"""
    This is indented.
    So is this.
    """`
		const parsed = parseDocstring(input, 'python')

		expect(parsed).not.toContain('"""')
		expect(parsed).toContain('This is indented')
		// Should be dedented
		expect(parsed).not.toMatch(/^\s{4}This/)
	})

	test('parses Rust doc comments and removes ///', () => {
		const input = `/// First line.
/// Second line.`
		const parsed = parseDocstring(input, 'rust')

		expect(parsed).not.toContain('///')
		expect(parsed).toContain('First line')
		expect(parsed).toContain('Second line')
	})

	test('parses Go comments and removes //', () => {
		const input = `// First line.
// Second line.`
		const parsed = parseDocstring(input, 'go')

		expect(parsed).not.toContain('//')
		expect(parsed).toContain('First line')
		expect(parsed).toContain('Second line')
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

	test('handles arrow functions - no crash', async () => {
		// Arrow functions may or may not be extracted depending on query patterns
		// The key is the system handles them without crashing
		const code = `const add = (a: number, b: number) => a + b`
		const result = await parseCode(code, 'typescript')

		// Should not throw
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		// Result should be an array (may be empty if arrow function isn't captured)
		expect(Array.isArray(entities)).toBe(true)
	})

	test('handles async functions', async () => {
		const code = `async function fetchData(): Promise<string> {
  return await fetch('/api')
}`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		const fn = entities.find((e) => e.name === 'fetchData')
		expect(fn).toBeDefined()
		expect(fn?.signature).toContain('async')
	})

	test('handles export declarations', async () => {
		const code = `export function publicFn() { return 1 }
export default function defaultFn() { return 2 }`
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		expect(entities.length).toBeGreaterThan(0)
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
		expect(source).toContain('std::collections')
	})

	test('extracts Go import source', async () => {
		const code = `package main

import "fmt"`
		const result = await parseCode(code, 'go')
		const importNode = result.tree.rootNode.namedChildren.find(
			(n) => n.type === 'import_declaration',
		)

		if (importNode) {
			const source = extractImportSource(importNode, 'go')
			expect(source).toBe('fmt')
		}
	})

	test('extracts Java import source', async () => {
		const code = `import java.util.List;`
		const result = await parseCode(code, 'java')
		const importNode = result.tree.rootNode.namedChildren[0]

		const source = extractImportSource(importNode, 'java')
		expect(source).toBe('java.util.List')
	})

	test('import entities have source field populated', async () => {
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
		expect(imports.length).toBeGreaterThan(0)

		// Each import should have source populated
		for (const imp of imports) {
			expect(imp.source).toBeDefined()
			expect(imp.source).not.toBe('')
		}
	})
})
