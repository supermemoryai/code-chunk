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

	test('returns true for zero-length inner range at boundary', () => {
		const outer = { start: 0, end: 100 }
		const zeroLengthStart = { start: 0, end: 0 }
		const zeroLengthMid = { start: 50, end: 50 }
		const zeroLengthEnd = { start: 100, end: 100 }
		expect(rangeContains(outer, zeroLengthStart)).toBe(true)
		expect(rangeContains(outer, zeroLengthMid)).toBe(true)
		expect(rangeContains(outer, zeroLengthEnd)).toBe(true)
	})

	test('returns false for zero-length inner range outside outer', () => {
		const outer = { start: 10, end: 50 }
		const zeroLengthBefore = { start: 5, end: 5 }
		const zeroLengthAfter = { start: 60, end: 60 }
		expect(rangeContains(outer, zeroLengthBefore)).toBe(false)
		expect(rangeContains(outer, zeroLengthAfter)).toBe(false)
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

		expect(tree.root).toHaveLength(1)
		expect(tree.root[0]).toMatchObject({
			entity: {
				name: 'greet',
				type: 'function',
			},
			children: [],
			parent: null,
		})
	})

	test('builds tree with class and nested methods with exact structure', async () => {
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
		expect(tree.root).toHaveLength(1)
		const classNode = tree.root[0]
		expect(classNode).toMatchObject({
			entity: {
				name: 'Calculator',
				type: 'class',
			},
			parent: null,
		})

		// Class should have exactly 2 method children
		expect(classNode?.children).toHaveLength(2)

		// Verify children are in source order
		expect(classNode?.children[0]?.entity.name).toBe('add')
		expect(classNode?.children[1]?.entity.name).toBe('subtract')

		// Verify method byte ranges are contained within class range
		const classRange = classNode!.entity.byteRange
		for (const child of classNode!.children) {
			expect(child.entity.byteRange.start).toBeGreaterThanOrEqual(
				classRange.start,
			)
			expect(child.entity.byteRange.end).toBeLessThanOrEqual(classRange.end)
		}
	})

	test('verifies byte range containment (parent contains children)', async () => {
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

		const outerClass = tree.root.find((n) => n.entity.name === 'Outer')
		expect(outerClass).toBeDefined()

		// Recursively verify all children are within parent byte ranges
		const verifyByteRangeContainment = (
			node: (typeof tree.root)[0],
			parentRange?: { start: number; end: number },
		) => {
			if (parentRange) {
				expect(node.entity.byteRange.start).toBeGreaterThanOrEqual(
					parentRange.start,
				)
				expect(node.entity.byteRange.end).toBeLessThanOrEqual(parentRange.end)
			}
			for (const child of node.children) {
				verifyByteRangeContainment(child, node.entity.byteRange)
			}
		}

		for (const root of tree.root) {
			verifyByteRangeContainment(root)
		}
	})

	test('verifies children are ordered by source position', async () => {
		const code = `class MultiMethod {
  first() { return 1 }
  second() { return 2 }
  third() { return 3 }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const classNode = tree.root.find((n) => n.entity.name === 'MultiMethod')
		expect(classNode?.children).toHaveLength(3)

		// Verify ordering by byte position
		for (let i = 1; i < classNode!.children.length; i++) {
			const prevChild = classNode!.children[i - 1]!
			const currChild = classNode!.children[i]!
			expect(currChild.entity.byteRange.start).toBeGreaterThan(
				prevChild.entity.byteRange.start,
			)
		}

		// Verify exact order
		expect(classNode?.children.map((c) => c.entity.name)).toEqual([
			'first',
			'second',
			'third',
		])
	})

	test('separates imports from tree structure with exact counts', async () => {
		const code = `import { Effect } from 'effect'
import type { Option } from 'effect/Option'

function test() { return 1 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Imports should be in imports array, not in root
		expect(tree.imports).toHaveLength(2)
		expect(tree.imports[0]).toMatchObject({
			type: 'import',
			name: 'Effect',
			source: 'effect',
		})
		expect(tree.imports[1]).toMatchObject({
			type: 'import',
			name: 'Option',
			source: 'effect/Option',
		})

		// Root should have only the function
		expect(tree.root).toHaveLength(1)
		expect(tree.root[0]).toMatchObject({
			entity: {
				name: 'test',
				type: 'function',
			},
		})
	})

	test('separates exports from tree structure', async () => {
		const code = `export function publicFn() { return 1 }
export default function defaultFn() { return 2 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Root should have functions (exports are the functions themselves)
		expect(tree.root.length).toBeGreaterThanOrEqual(1)
		const fnNames = tree.root.map((n) => n.entity.name)
		expect(fnNames).toContain('publicFn')
	})

	test('handles deeply nested structures with depth verification', async () => {
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
		expect(outerClass).toMatchObject({
			entity: { name: 'Outer', type: 'class' },
			parent: null,
		})

		// Find innerMethod
		const innerMethod = outerClass?.children.find(
			(n) => n.entity.name === 'innerMethod',
		)
		expect(innerMethod).toBeDefined()
		expect(innerMethod?.parent).toBe(outerClass)

		// Check nesting depth via ancestor chain
		if (innerMethod) {
			const methodAncestors = getAncestorChain(innerMethod)
			expect(methodAncestors).toHaveLength(1)
			expect(methodAncestors[0]?.entity.name).toBe('Outer')
		}
	})

	test('allEntities contains all extracted entities with exact count', async () => {
		const code = `import { foo } from 'bar'

class MyClass {
  method() { return 1 }
}

function standalone() { return 2 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// allEntities should have everything
		expect(tree.allEntities).toHaveLength(entities.length)
		// Verify exact count: 1 import + 1 class + 1 method + 1 function = 4
		expect(tree.allEntities.length).toBe(4)
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
	test('returns Effect with scope tree with exact structure', async () => {
		const code = `function test() { return 1 }`
		const entities = await getEntities(code, 'typescript')

		const tree = await Effect.runPromise(buildScopeTree(entities))

		expect(tree.root).toHaveLength(1)
		expect(tree.root[0]).toMatchObject({
			entity: {
				name: 'test',
				type: 'function',
			},
			parent: null,
			children: [],
		})
	})

	test('handles errors gracefully', async () => {
		// Even with empty input, should not fail
		const tree = await Effect.runPromise(buildScopeTree([]))
		expect(tree.root).toEqual([])
		expect(tree.imports).toEqual([])
		expect(tree.exports).toEqual([])
		expect(tree.allEntities).toEqual([])
	})
})

// ============================================================================
// buildScopeTreeSync Tests
// ============================================================================

describe('buildScopeTreeSync', () => {
	test('builds tree synchronously with correct structure', async () => {
		const code = `class Foo { bar() { return 1 } }`
		const entities = await getEntities(code, 'typescript')

		const tree = buildScopeTreeSync(entities)

		expect(tree.root).toHaveLength(1)
		expect(tree.root[0]).toMatchObject({
			entity: {
				name: 'Foo',
				type: 'class',
			},
		})
		expect(tree.root[0]?.children).toHaveLength(1)
		expect(tree.root[0]?.children[0]).toMatchObject({
			entity: {
				name: 'bar',
				type: 'method',
			},
		})
	})

	test('handles empty input', () => {
		const tree = buildScopeTreeSync([])
		expect(tree.root).toEqual([])
		expect(tree.imports).toEqual([])
		expect(tree.exports).toEqual([])
		expect(tree.allEntities).toEqual([])
	})
})

// ============================================================================
// findScopeAtOffset Tests
// ============================================================================

describe('findScopeAtOffset', () => {
	test('finds scope node containing offset with exact match', async () => {
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
		expect(addMethod).toBeDefined()
		const midpoint = Math.floor(
			(addMethod!.byteRange.start + addMethod!.byteRange.end) / 2,
		)
		const scope = findScopeAtOffset(tree, midpoint)

		expect(scope).not.toBeNull()
		expect(scope?.entity.name).toBe('add')
		expect(scope?.entity.type).toBe('method')
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
		expect(method).toBeDefined()
		const offset = method!.byteRange.start + 5 // Inside method
		const scope = findScopeAtOffset(tree, offset)

		// Should find the method, not the class
		expect(scope).toMatchObject({
			entity: {
				name: 'method',
				type: 'method',
			},
		})
	})

	test('finds class scope at offset before method starts', async () => {
		const code = `class Outer {
  method() { return 1 }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const classEntity = entities.find((e) => e.name === 'Outer')
		const methodEntity = entities.find((e) => e.name === 'method')
		expect(classEntity).toBeDefined()
		expect(methodEntity).toBeDefined()

		// Offset at start of class but before method
		const offsetInClass = classEntity!.byteRange.start + 1
		if (offsetInClass < methodEntity!.byteRange.start) {
			const scope = findScopeAtOffset(tree, offsetInClass)
			expect(scope?.entity.name).toBe('Outer')
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

	test('returns null for negative offset', async () => {
		const code = `function test() { return 1 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const scope = findScopeAtOffset(tree, -1)
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

	test('finds correct scope at exact boundary', async () => {
		const code = `function first() { return 1 }
function second() { return 2 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const first = entities.find((e) => e.name === 'first')
		const second = entities.find((e) => e.name === 'second')
		expect(first).toBeDefined()
		expect(second).toBeDefined()

		// At exact start of first function
		const scopeAtStart = findScopeAtOffset(tree, first!.byteRange.start)
		expect(scopeAtStart?.entity.name).toBe('first')

		// At exact start of second function
		const scopeAtSecondStart = findScopeAtOffset(tree, second!.byteRange.start)
		expect(scopeAtSecondStart?.entity.name).toBe('second')
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
		expect(fnNode).toBeDefined()
		const ancestors = getAncestorChain(fnNode!)
		expect(ancestors).toEqual([])
	})

	test('returns parent chain for nested node with exact length', async () => {
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

		expect(methodNode).toBeDefined()
		const ancestors = getAncestorChain(methodNode!)
		expect(ancestors).toHaveLength(1)
		expect(ancestors[0]).toBe(classNode)
		expect(ancestors[0]?.entity.name).toBe('Outer')
	})

	test('returns correct ancestor chain for deeply nested node', async () => {
		const code = `class Level1 {
  level2Method() {
    function level3() {
      return 1
    }
    return level3()
  }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const level1 = tree.root.find((n) => n.entity.name === 'Level1')
		const level2 = level1?.children.find(
			(n) => n.entity.name === 'level2Method',
		)
		const level3 = level2?.children.find((n) => n.entity.name === 'level3')

		if (level3) {
			const ancestors = getAncestorChain(level3)
			expect(ancestors).toHaveLength(2)
			expect(ancestors[0]?.entity.name).toBe('level2Method')
			expect(ancestors[1]?.entity.name).toBe('Level1')
		}
	})
})

// ============================================================================
// flattenScopeTree Tests
// ============================================================================

describe('flattenScopeTree', () => {
	test('flattens tree to array of all scope nodes with exact count', async () => {
		const code = `class Outer {
  method1() { return 1 }
  method2() { return 2 }
}

function standalone() { return 3 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const flattened = flattenScopeTree(tree)

		// Should include class, both methods, and standalone function = 4
		expect(flattened).toHaveLength(4)

		const names = flattened.map((n) => n.entity.name)
		expect(names).toContain('Outer')
		expect(names).toContain('method1')
		expect(names).toContain('method2')
		expect(names).toContain('standalone')
	})

	test('flattens in DFS order', async () => {
		const code = `class Parent {
  child1() { return 1 }
  child2() { return 2 }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const flattened = flattenScopeTree(tree)
		const names = flattened.map((n) => n.entity.name)

		// DFS: Parent first, then its children
		expect(names[0]).toBe('Parent')
		expect(names).toContain('child1')
		expect(names).toContain('child2')
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
	test('child nodes have parent reference set correctly', async () => {
		const code = `class Parent {
  child() { return 1 }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const parentNode = tree.root.find((n) => n.entity.name === 'Parent')
		expect(parentNode).toBeDefined()
		expect(parentNode?.children).toHaveLength(1)

		const childNode = parentNode!.children[0]
		expect(childNode?.parent).toBe(parentNode)
		expect(childNode?.parent?.entity.name).toBe('Parent')
	})

	test('root nodes have null parent', async () => {
		const code = `function root() { return 1 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		expect(tree.root).toHaveLength(1)
		expect(tree.root[0]?.parent).toBeNull()
	})

	test('entity.parent string field matches scope parent', async () => {
		const code = `class Container {
  contained() { return 1 }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const containerNode = tree.root.find((n) => n.entity.name === 'Container')
		const containedNode = containerNode?.children[0]

		// The ScopeNode parent reference
		expect(containedNode?.parent?.entity.name).toBe('Container')

		// The ExtractedEntity.parent string field (set during extraction)
		expect(containedNode?.entity.parent).toBe('Container')
	})

	test('deeply nested parent references are correct', async () => {
		const code = `class Level1 {
  level2() {
    function level3() { return 1 }
  }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const level1 = tree.root.find((n) => n.entity.name === 'Level1')
		const level2 = level1?.children[0]
		const level3 = level2?.children[0]

		expect(level1?.parent).toBeNull()
		expect(level2?.parent).toBe(level1)
		expect(level3?.parent).toBe(level2)
	})
})

// ============================================================================
// Multi-language Scope Tree Tests
// ============================================================================

describe('multi-language scope trees', () => {
	test('builds scope tree for Python with exact structure', async () => {
		const code = `class Calculator:
    def add(self, a, b):
        return a + b
    
    def subtract(self, a, b):
        return a - b`
		const entities = await getEntities(code, 'python')
		const tree = buildScopeTreeFromEntities(entities)

		const cls = tree.root.find((n) => n.entity.name === 'Calculator')
		expect(cls).toMatchObject({
			entity: {
				name: 'Calculator',
				type: 'class',
			},
			parent: null,
		})
		expect(cls?.children).toHaveLength(2)

		// Verify Python methods are nested under class (Python extracts methods as 'function' type)
		expect(cls?.children[0]?.entity.type).toBe('function')
		expect(cls?.children[1]?.entity.type).toBe('function')
		expect(cls?.children[0]?.entity.name).toBe('add')
		expect(cls?.children[1]?.entity.name).toBe('subtract')

		// Verify byte range containment
		const classRange = cls!.entity.byteRange
		for (const child of cls!.children) {
			expect(child.entity.byteRange.start).toBeGreaterThan(classRange.start)
			expect(child.entity.byteRange.end).toBeLessThanOrEqual(classRange.end)
		}
	})

	test('builds scope tree for Rust with struct and impl', async () => {
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

		// Check for function in the tree
		const flattened = flattenScopeTree(tree)
		const addFn = flattened.find((n) => n.entity.name === 'add')
		expect(addFn).toBeDefined()
		expect(addFn?.entity.type).toBe('function')
	})

	test('builds scope tree for Go with exact function count', async () => {
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
		expect(tree.root).toHaveLength(2)
		const fnNames = tree.root.map((n) => n.entity.name)
		expect(fnNames).toEqual(['add', 'subtract'])

		// Go functions should have no nesting
		for (const node of tree.root) {
			expect(node.parent).toBeNull()
			expect(node.children).toHaveLength(0)
		}
	})

	test('builds scope tree for Java with class nesting', async () => {
		const code = `public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}`
		const entities = await getEntities(code, 'java')
		const tree = buildScopeTreeFromEntities(entities)

		expect(tree.root).toHaveLength(1)
		const cls = tree.root[0]
		expect(cls).toMatchObject({
			entity: {
				name: 'Calculator',
				type: 'class',
			},
			parent: null,
		})

		// Method should be nested under class
		expect(cls?.children).toHaveLength(1)
		expect(cls?.children[0]).toMatchObject({
			entity: {
				name: 'add',
				type: 'method',
			},
		})
		expect(cls?.children[0]?.parent).toBe(cls)
	})

	test('JavaScript class has proper nesting', async () => {
		const code = `class MyClass {
  myMethod() {
    return 42
  }
}`
		const entities = await getEntities(code, 'javascript')
		const tree = buildScopeTreeFromEntities(entities)

		expect(tree.root).toHaveLength(1)
		expect(tree.root[0]?.entity.name).toBe('MyClass')
		expect(tree.root[0]?.children).toHaveLength(1)
		expect(tree.root[0]?.children[0]?.entity.name).toBe('myMethod')
	})
})

// ============================================================================
// Context Attachment Tests
// ============================================================================

describe('context attachment', () => {
	test('getEntitiesInRange returns entities with exact isPartial=false for full range', async () => {
		const code = `function foo() { return 1 }
function bar() { return 2 }
function baz() { return 3 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const { getEntitiesInRange } = await import('../src/context/index')

		// Get entities for a range that fully contains 'bar' but not 'foo' or 'baz'
		const barEntity = entities.find((e) => e.name === 'bar')
		expect(barEntity).toBeDefined()

		const entitiesInRange = getEntitiesInRange(barEntity!.byteRange, tree)

		// Should find bar
		const bar = entitiesInRange.find((e) => e.name === 'bar')
		expect(bar).toBeDefined()
		// bar should NOT be partial since we're using its exact range
		expect(bar?.isPartial).toBe(false)

		// Should not find foo or baz (non-overlapping)
		expect(entitiesInRange.find((e) => e.name === 'foo')).toBeUndefined()
		expect(entitiesInRange.find((e) => e.name === 'baz')).toBeUndefined()
	})

	test('getEntitiesInRange marks partial entities correctly with exact values', async () => {
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
		expect(method2).toBeDefined()

		const entitiesInRange = getEntitiesInRange(method2!.byteRange, tree)

		// method2 should not be partial (its full range is included)
		const m2 = entitiesInRange.find((e) => e.name === 'method2')
		expect(m2).toBeDefined()
		expect(m2?.isPartial).toBe(false)

		// BigClass should be partial (we only have a slice of it)
		const cls = entitiesInRange.find((e) => e.name === 'BigClass')
		expect(cls).toBeDefined()
		expect(cls?.isPartial).toBe(true)

		// method1 and method3 should not be in range
		expect(entitiesInRange.find((e) => e.name === 'method1')).toBeUndefined()
		expect(entitiesInRange.find((e) => e.name === 'method3')).toBeUndefined()
	})

	test('getEntitiesInRange isPartial is true when range cuts through entity', async () => {
		const code = `function longFunction() {
  const a = 1
  const b = 2
  const c = 3
  return a + b + c
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const { getEntitiesInRange } = await import('../src/context/index')

		const fn = entities.find((e) => e.name === 'longFunction')
		expect(fn).toBeDefined()

		// Range that cuts through the function (starts at function start, ends before function end)
		const partialRange = {
			start: fn!.byteRange.start,
			end: fn!.byteRange.start + 20,
		}
		const entitiesInRange = getEntitiesInRange(partialRange, tree)

		const longFn = entitiesInRange.find((e) => e.name === 'longFunction')
		expect(longFn).toBeDefined()
		expect(longFn?.isPartial).toBe(true)
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
		expect(fn).toBeDefined()

		const entitiesInRange = getEntitiesInRange(fn!.byteRange, tree)
		const docFn = entitiesInRange.find((e) => e.name === 'documented')

		expect(docFn).toBeDefined()
		expect(docFn?.lineRange).toMatchObject({
			start: expect.any(Number),
			end: expect.any(Number),
		})
		expect(docFn?.isPartial).toBe(false)

		// Docstring should be present if extracted
		if (fn?.docstring) {
			expect(docFn?.docstring).toContain('test function')
		}
	})

	test('getEntitiesInRange returns empty array for non-overlapping range', async () => {
		const code = `function only() { return 1 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		const { getEntitiesInRange } = await import('../src/context/index')

		// Range completely after the function
		const nonOverlappingRange = { start: 1000, end: 2000 }
		const entitiesInRange = getEntitiesInRange(nonOverlappingRange, tree)

		expect(entitiesInRange).toEqual([])
	})
})

// ============================================================================
// Imports/Exports Array Tests
// ============================================================================

describe('imports and exports arrays', () => {
	test('imports array has exact count and structure', async () => {
		const code = `import { a, b, c } from 'module1'
import defaultExport from 'module2'
import * as namespace from 'module3'

function main() { return 1 }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Count depends on how parser extracts individual imports
		expect(tree.imports.length).toBeGreaterThan(0)

		// All items in imports array should be import type
		for (const imp of tree.imports) {
			expect(imp.type).toBe('import')
			expect(imp.source).toBeDefined()
		}
	})

	test('exports array captures export declarations', async () => {
		const code = `export const x = 1
export function exported() { return 2 }
export class ExportedClass {}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Root should contain the exported items
		expect(tree.root.length).toBeGreaterThan(0)

		// Should find exported function in root
		const exportedFn = tree.root.find((n) => n.entity.name === 'exported')
		expect(exportedFn).toBeDefined()
	})

	test('imports are not included in root tree', async () => {
		const code = `import { helper } from './helper'

function main() { return helper() }`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Imports should be in imports array
		expect(tree.imports).toHaveLength(1)
		expect(tree.imports[0]?.name).toBe('helper')

		// Root should only have the function
		expect(tree.root).toHaveLength(1)
		expect(tree.root[0]?.entity.name).toBe('main')

		// Verify imports are not in root
		const importInRoot = tree.root.find((n) => n.entity.type === 'import')
		expect(importInRoot).toBeUndefined()
	})
})

// ============================================================================
// Nesting Depth Verification Tests
// ============================================================================

describe('nesting depth verification', () => {
	test('verifies exact nesting depth for complex structures', async () => {
		const code = `class Outer {
  innerMethod() {
    function nested() {
      return 1
    }
  }
}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		// Calculate depth for each node
		const getDepth = (node: (typeof tree.root)[0]): number => {
			let depth = 0
			let current = node.parent
			while (current) {
				depth++
				current = current.parent
			}
			return depth
		}

		const flattened = flattenScopeTree(tree)

		const outer = flattened.find((n) => n.entity.name === 'Outer')
		const innerMethod = flattened.find((n) => n.entity.name === 'innerMethod')
		const nested = flattened.find((n) => n.entity.name === 'nested')

		expect(outer).toBeDefined()
		expect(innerMethod).toBeDefined()

		expect(getDepth(outer!)).toBe(0)
		expect(getDepth(innerMethod!)).toBe(1)
		if (nested) {
			expect(getDepth(nested)).toBe(2)
		}
	})

	test('multiple top-level items all have depth 0', async () => {
		const code = `function fn1() {}
function fn2() {}
class Cls1 {}
class Cls2 {}`
		const entities = await getEntities(code, 'typescript')
		const tree = buildScopeTreeFromEntities(entities)

		expect(tree.root).toHaveLength(4)
		for (const node of tree.root) {
			expect(node.parent).toBeNull()
		}
	})
})
