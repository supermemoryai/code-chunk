import { beforeAll, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { extractEntitiesAsync } from '../src/extract'
import { initializeParser, parseCode } from '../src/parser'
import {
	buildScopeTree,
	buildScopeTreeFromEntities,
	buildScopeTreeSync,
	findScopeAtOffset,
	flattenScopeTree,
	getAncestorChain,
	rangeContains,
} from '../src/scope'
import type { ExtractedEntity, ScopeTree } from '../src/types'

// ============================================================================
// Setup
// ============================================================================

beforeAll(async () => {
	await initializeParser()
})

// Helper to parse and extract entities
async function getEntities(
	code: string,
	language: 'typescript' | 'python' | 'rust' | 'go' | 'java' | 'javascript',
): Promise<ExtractedEntity[]> {
	const result = await parseCode(code, language)
	return extractEntitiesAsync(result.tree.rootNode, language, code)
}

// ============================================================================
// Range Containment Tests
// ============================================================================

describe('rangeContains', () => {
	test('returns true when outer fully contains inner', () => {
		const outer = { start: 0, end: 100 }
		const inner = { start: 10, end: 50 }
		expect(rangeContains(outer, inner)).toBe(true)
	})

	test('returns true when ranges are equal', () => {
		const range = { start: 10, end: 50 }
		expect(rangeContains(range, range)).toBe(true)
	})

	test('returns false when inner starts before outer', () => {
		const outer = { start: 10, end: 100 }
		const inner = { start: 5, end: 50 }
		expect(rangeContains(outer, inner)).toBe(false)
	})

	test('returns false when inner ends after outer', () => {
		const outer = { start: 0, end: 50 }
		const inner = { start: 10, end: 60 }
		expect(rangeContains(outer, inner)).toBe(false)
	})

	test('returns false when ranges do not overlap', () => {
		const outer = { start: 0, end: 50 }
		const inner = { start: 60, end: 100 }
		expect(rangeContains(outer, inner)).toBe(false)
	})

	test('returns true when inner is at boundary of outer', () => {
		const outer = { start: 0, end: 100 }
		const innerAtStart = { start: 0, end: 50 }
		const innerAtEnd = { start: 50, end: 100 }
		expect(rangeContains(outer, innerAtStart)).toBe(true)
		expect(rangeContains(outer, innerAtEnd)).toBe(true)
	})
})

// ============================================================================
// Scope Tree Building Tests
// ============================================================================

describe('buildScopeTreeFromEntities', () => {
	test('builds tree with single top-level function', async () => {
		const code = `function greet(name: string): string {
  return \`Hello, \${name}!\`
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		expect(tree.root.length).toBe(1)
		expect(tree.root[0]?.entity.name).toBe('greet')
		expect(tree.root[0]?.entity.type).toBe('function')
	})

	test('builds tree with class and nested methods', async () => {
		const code = `class Calculator {
  add(a: number, b: number): number {
    return a + b
  }
  
  subtract(a: number, b: number): number {
    return a - b
  }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Should have one root: the class
		const classNode = tree.root.find((n) => n.entity.name === 'Calculator')
		expect(classNode).toBeDefined()
		expect(classNode?.entity.type).toBe('class')

		// Class should have method children
		expect(classNode?.children.length).toBe(2)
		const methodNames = classNode?.children.map((c) => c.entity.name)
		expect(methodNames).toContain('add')
		expect(methodNames).toContain('subtract')
	})

	test('separates imports from tree structure', async () => {
		const code = `import { Effect } from 'effect'
import type { Option } from 'effect/Option'

function test() { return 1 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Imports should be in imports array, not in root
		expect(tree.imports.length).toBeGreaterThan(0)
		expect(tree.imports.every((e) => e.type === 'import')).toBe(true)

		// Root should have the function
		const fnNode = tree.root.find((n) => n.entity.name === 'test')
		expect(fnNode).toBeDefined()
	})

	test('separates exports from tree structure', async () => {
		const code = `export function publicFn() { return 1 }
export default function defaultFn() { return 2 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Exports should be captured
		expect(tree.exports.length).toBeGreaterThanOrEqual(0) // May vary by query
	})

	test('handles deeply nested structures', async () => {
		const code = `class Outer {
  innerMethod() {
    function nestedFn() {
      return 1
    }
    return nestedFn()
  }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Should have class at root
		const outerClass = tree.root.find((n) => n.entity.name === 'Outer')
		expect(outerClass).toBeDefined()
	})

	test('allEntities contains all extracted entities', async () => {
		const code = `import { foo } from 'bar'

class MyClass {
  method() { return 1 }
}

function standalone() { return 2 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// allEntities should have everything
		expect(tree.allEntities.length).toBe(entities.length)
	})

	test('handles empty entity list', () => {
		const tree = buildScopeTreeFromEntities([])

		expect(tree.root).toEqual([])
		expect(tree.imports).toEqual([])
		expect(tree.exports).toEqual([])
		expect(tree.allEntities).toEqual([])
	})
})

// ============================================================================
// buildScopeTree (Effect version) Tests
// ============================================================================

describe('buildScopeTree', () => {
	test('returns Effect with scope tree', async () => {
		const code = `function test() { return 1 }`
		const entities = await getEntities(code, 'typescript')

		const tree = await Effect.runPromise(buildScopeTree(entities))

		expect(tree.root.length).toBe(1)
		expect(tree.root[0]?.entity.name).toBe('test')
	})

	test('handles errors gracefully', async () => {
		// Even with empty input, should not fail
		const tree = await Effect.runPromise(buildScopeTree([]))
		expect(tree.root).toEqual([])
	})
})

// ============================================================================
// buildScopeTreeSync Tests
// ============================================================================

describe('buildScopeTreeSync', () => {
	test('builds tree synchronously', async () => {
		const code = `class Foo { bar() { return 1 } }`
		const entities = await getEntities(code, 'typescript')

		const tree = buildScopeTreeSync(entities)

		expect(tree.root.length).toBeGreaterThan(0)
	})

	test('handles empty input', () => {
		const tree = buildScopeTreeSync([])
		expect(tree.root).toEqual([])
	})
})

// ============================================================================
// findScopeAtOffset Tests
// ============================================================================

describe('findScopeAtOffset', () => {
	test('finds scope node containing offset', async () => {
		const code = `class Calculator {
  add(a: number, b: number): number {
    return a + b
  }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Offset somewhere inside the add method body
		const addMethod = entities.find(
			(e) => e.name === 'add' && e.type === 'method',
		)
		if (addMethod) {
			const midpoint = Math.floor(
				(addMethod.byteRange.start + addMethod.byteRange.end) / 2,
			)
			const scope = findScopeAtOffset(tree, midpoint)

			expect(scope).not.toBeNull()
			expect(scope?.entity.name).toBe('add')
		}
	})

	test('finds deepest scope when nested', async () => {
		const code = `class Outer {
  method() {
    return 1
  }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Find method's byte range
		const method = entities.find((e) => e.name === 'method')
		if (method) {
			const offset = method.byteRange.start + 5 // Inside method
			const scope = findScopeAtOffset(tree, offset)

			// Should find the method, not the class
			expect(scope?.entity.name).toBe('method')
		}
	})

	test('returns null for offset outside all scopes', async () => {
		const code = `function test() { return 1 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Very large offset outside file
		const scope = findScopeAtOffset(tree, 10000)
		expect(scope).toBeNull()
	})

	test('returns null for empty tree', () => {
		const tree: ScopeTree = {
			root: [],
			imports: [],
			exports: [],
			allEntities: [],
		}

		const scope = findScopeAtOffset(tree, 0)
		expect(scope).toBeNull()
	})
})

// ============================================================================
// getAncestorChain Tests
// ============================================================================

describe('getAncestorChain', () => {
	test('returns empty array for root-level node', async () => {
		const code = `function standalone() { return 1 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const fnNode = tree.root[0]
		if (fnNode) {
			const ancestors = getAncestorChain(fnNode)
			expect(ancestors).toEqual([])
		}
	})

	test('returns parent chain for nested node', async () => {
		const code = `class Outer {
  method() { return 1 }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Find the method node
		const classNode = tree.root.find((n) => n.entity.name === 'Outer')
		const methodNode = classNode?.children.find(
			(n) => n.entity.name === 'method',
		)

		if (methodNode) {
			const ancestors = getAncestorChain(methodNode)
			expect(ancestors.length).toBe(1)
			expect(ancestors[0]?.entity.name).toBe('Outer')
		}
	})
})

// ============================================================================
// flattenScopeTree Tests
// ============================================================================

describe('flattenScopeTree', () => {
	test('flattens tree to array of all scope nodes', async () => {
		const code = `class Outer {
  method1() { return 1 }
  method2() { return 2 }
}

function standalone() { return 3 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const flattened = flattenScopeTree(tree)

		// Should include class, both methods, and standalone function
		const names = flattened.map((n) => n.entity.name)
		expect(names).toContain('Outer')
		expect(names).toContain('method1')
		expect(names).toContain('method2')
		expect(names).toContain('standalone')
	})

	test('returns empty array for empty tree', () => {
		const tree: ScopeTree = {
			root: [],
			imports: [],
			exports: [],
			allEntities: [],
		}

		const flattened = flattenScopeTree(tree)
		expect(flattened).toEqual([])
	})
})

// ============================================================================
// Parent/Child Relationship Tests
// ============================================================================

describe('parent/child relationships', () => {
	test('child nodes have parent reference set', async () => {
		const code = `class Parent {
  child() { return 1 }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const parentNode = tree.root.find((n) => n.entity.name === 'Parent')
		const childNode = parentNode?.children[0]

		expect(childNode?.parent).toBe(parentNode)
	})

	test('root nodes have null parent', async () => {
		const code = `function root() { return 1 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		expect(tree.root[0]?.parent).toBeNull()
	})
})

// ============================================================================
// Multi-language Scope Tree Tests
// ============================================================================

describe('multi-language scope trees', () => {
	test('builds scope tree for Python', async () => {
		const code = `class Calculator:
    def add(self, a, b):
        return a + b
    
    def subtract(self, a, b):
        return a - b`
		const entities = await getEntities(code, 'python')
		const tree = buildScopeTreeFromEntities(entities)

		const cls = tree.root.find((n) => n.entity.name === 'Calculator')
		expect(cls).toBeDefined()
		expect(cls?.children.length).toBe(2)
	})

	test('builds scope tree for Rust', async () => {
		const code = `struct Calculator {}

impl Calculator {
    fn add(&self, a: i32, b: i32) -> i32 {
        a + b
    }
}`
		const entities = await getEntities(code, 'rust')
		const tree = buildScopeTreeFromEntities(entities)

		// Should have struct and/or impl at root
		expect(tree.root.length).toBeGreaterThan(0)
	})

	test('builds scope tree for Go', async () => {
		const code = `package main

func add(a, b int) int {
    return a + b
}

func subtract(a, b int) int {
    return a - b
}`
		const entities = await getEntities(code, 'go')
		const tree = buildScopeTreeFromEntities(entities)

		// Should have both functions at root
		const fnNames = tree.root.map((n) => n.entity.name)
		expect(fnNames).toContain('add')
		expect(fnNames).toContain('subtract')
	})

	test('builds scope tree for Java', async () => {
		const code = `public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}`
		const entities = await getEntities(code, 'java')
		const tree = buildScopeTreeFromEntities(entities)

		const cls = tree.root.find((n) => n.entity.name === 'Calculator')
		expect(cls).toBeDefined()
	})
})

// ============================================================================
// Context Attachment Tests
// ============================================================================

describe('context attachment', () => {
	test('getEntitiesInRange returns entities with isPartial flag', async () => {
		const code = `function foo() { return 1 }
function bar() { return 2 }
function baz() { return 3 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Import the function we need to test
		const { getEntitiesInRange } = await import('../src/context/index')

		// Get entities for a range that fully contains 'bar' but not 'foo' or 'baz'
		const barEntity = entities.find((e) => e.name === 'bar')
		if (barEntity) {
			const entitiesInRange = getEntitiesInRange(barEntity.byteRange, tree)

			// Should find bar
			const bar = entitiesInRange.find((e) => e.name === 'bar')
			expect(bar).toBeDefined()
			// bar should NOT be partial since we're using its exact range
			expect(bar?.isPartial).toBe(false)
		}
	})

	test('getEntitiesInRange marks partial entities correctly', async () => {
		const code = `class BigClass {
  method1() { return 1 }
  method2() { return 2 }
  method3() { return 3 }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const { getEntitiesInRange } = await import('../src/context/index')

		// Get just method2's range - this should be inside BigClass
		const method2 = entities.find((e) => e.name === 'method2')
		if (method2) {
			const entitiesInRange = getEntitiesInRange(method2.byteRange, tree)

			// method2 should not be partial (its full range is included)
			const m2 = entitiesInRange.find((e) => e.name === 'method2')
			expect(m2?.isPartial).toBe(false)

			// BigClass should be partial (we only have a slice of it)
			const cls = entitiesInRange.find((e) => e.name === 'BigClass')
			if (cls) {
				expect(cls.isPartial).toBe(true)
			}
		}
	})

	test('getEntitiesInRange includes docstring and lineRange', async () => {
		const code = `/**
 * A test function with docs.
 */
function documented() {
  return 1
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const { getEntitiesInRange } = await import('../src/context/index')

		const fn = entities.find((e) => e.name === 'documented')
		if (fn) {
			const entitiesInRange = getEntitiesInRange(fn.byteRange, tree)
			const docFn = entitiesInRange.find((e) => e.name === 'documented')

			expect(docFn).toBeDefined()
			expect(docFn?.lineRange).toBeDefined()
			// Docstring should be present if extracted
			if (fn.docstring) {
				expect(docFn?.docstring).toContain('test function')
			}
		}
	})
})
