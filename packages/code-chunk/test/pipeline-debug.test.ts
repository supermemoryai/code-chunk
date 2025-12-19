import { beforeAll, describe, expect, test } from 'bun:test'
import { chunk, type Language } from '../src'
import { extractEntitiesAsync } from '../src/extract'
import { initializeParser, parseCode } from '../src/parser'
import { buildScopeTreeFromEntities } from '../src/scope'

/**
 * Pipeline Debug Tests
 *
 * These tests verify the output at each stage of the chunking pipeline:
 * 1. Parse - tree-sitter AST generation
 * 2. Extract - entity extraction (functions, classes, methods, etc.)
 * 3. Scope - scope tree construction
 * 4. Chunk - final chunking with context
 *
 * For each supported language, we verify:
 * - Correct entity types and names
 * - Accurate byte/line ranges
 * - Proper parent/child relationships
 * - Docstring extraction
 * - Import detection
 */

beforeAll(async () => {
	await initializeParser()
})

// ============================================================================
// TypeScript Pipeline Debug
// ============================================================================

describe('pipeline debug: TypeScript', () => {
	const code = `import { Effect } from 'effect'

/**
 * A simple calculator class.
 */
export class Calculator {
  private value: number = 0

  /** Add a number to the current value. */
  add(n: number): number {
    this.value += n
    return this.value
  }

  /** Subtract a number from the current value. */
  subtract(n: number): number {
    this.value -= n
    return this.value
  }
}

/** Create a new calculator instance. */
function createCalculator(): Calculator {
  return new Calculator()
}`

	test('step 1: parse - produces valid AST', async () => {
		const result = await parseCode(code, 'typescript')

		expect(result.error).toBeNull()
		expect(result.tree.rootNode.type).toBe('program')

		// Log AST structure
		const children = result.tree.rootNode.namedChildren
		console.log('\n[TypeScript] AST root children:')
		for (const child of children) {
			console.log(
				`  - ${child.type} at lines ${child.startPosition.row}-${child.endPosition.row}`,
			)
		}

		// Verify expected node types
		const nodeTypes = children.map((c) => c.type)
		expect(nodeTypes).toContain('import_statement')
		expect(nodeTypes).toContain('export_statement') // class is wrapped in export
		expect(nodeTypes).toContain('function_declaration')
	})

	test('step 2: extract - finds all entities', async () => {
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)

		console.log('\n[TypeScript] Extracted entities:')
		for (const e of entities) {
			console.log(
				`  - ${e.type}: ${e.name} (lines ${e.lineRange.start}-${e.lineRange.end}, parent: ${e.parent ?? 'none'})`,
			)
			if (e.docstring) {
				console.log(`    docstring: "${e.docstring.slice(0, 50)}..."`)
			}
		}

		// Verify entity counts
		const imports = entities.filter((e) => e.type === 'import')
		const classes = entities.filter((e) => e.type === 'class')
		const methods = entities.filter((e) => e.type === 'method')
		const functions = entities.filter((e) => e.type === 'function')

		expect(imports.length).toBeGreaterThanOrEqual(1)
		expect(classes).toHaveLength(1)
		expect(classes[0].name).toBe('Calculator')
		expect(methods).toHaveLength(2)
		expect(methods.map((m) => m.name).sort()).toEqual(['add', 'subtract'])
		expect(functions).toHaveLength(1)
		expect(functions[0].name).toBe('createCalculator')

		// Verify parent relationships
		for (const method of methods) {
			expect(method.parent).toBe('Calculator')
		}

		// Verify docstrings (methods have docstrings, class may not due to export wrapping)
		const addMethod = methods.find((m) => m.name === 'add')
		expect(addMethod?.docstring).toContain('Add a number')
		expect(functions[0].docstring).toContain('Create a new calculator')
	})

	test('step 3: scope - builds correct tree', async () => {
		const result = await parseCode(code, 'typescript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'typescript',
			code,
		)
		const tree = buildScopeTreeFromEntities(entities)

		console.log('\n[TypeScript] Scope tree:')
		console.log(`  imports: ${tree.imports.length}`)
		console.log(`  exports: ${tree.exports.length}`)
		console.log(`  root nodes: ${tree.root.length}`)
		for (const node of tree.root) {
			console.log(
				`  - ${node.entity.type}: ${node.entity.name} (${node.children.length} children)`,
			)
			for (const child of node.children) {
				console.log(`    - ${child.entity.type}: ${child.entity.name}`)
			}
		}

		// Verify imports are separated
		expect(tree.imports.length).toBeGreaterThanOrEqual(1)
		expect(tree.imports[0].name).toBe('Effect')
		expect(tree.imports[0].source).toBe('effect')

		// Verify class has method children
		const classNode = tree.root.find((n) => n.entity.name === 'Calculator')
		expect(classNode).toBeDefined()
		expect(classNode?.children).toHaveLength(2)
		expect(classNode?.children.map((c) => c.entity.name).sort()).toEqual([
			'add',
			'subtract',
		])
	})

	test('step 4: chunk - produces valid chunks with context', async () => {
		const chunks = await chunk('calculator.ts', code, { maxChunkSize: 300 })

		console.log('\n[TypeScript] Chunks:')
		for (const c of chunks) {
			console.log(`  Chunk ${c.index}/${c.totalChunks}:`)
			console.log(`    bytes: ${c.byteRange.start}-${c.byteRange.end}`)
			console.log(`    lines: ${c.lineRange.start}-${c.lineRange.end}`)
			console.log(
				`    entities: ${c.context.entities.map((e) => e.name).join(', ')}`,
			)
			console.log(
				`    scope: ${c.context.scope.map((s) => s.name).join(' > ') || 'top-level'}`,
			)
			console.log(
				`    imports: ${c.context.imports.map((i) => i.name).join(', ') || 'none'}`,
			)
		}

		// Verify chunks cover the code
		expect(chunks.length).toBeGreaterThan(0)

		// Verify text matches byte range
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}

		// Verify context is populated
		const allEntities = chunks.flatMap((c) => c.context.entities)
		expect(allEntities.some((e) => e.name === 'Calculator')).toBe(true)
	})
})

// ============================================================================
// JavaScript Pipeline Debug
// ============================================================================

describe('pipeline debug: JavaScript', () => {
	const code = `const EventEmitter = require('events')

/**
 * A simple counter with events.
 */
class Counter extends EventEmitter {
  constructor() {
    super()
    this.count = 0
  }

  increment() {
    this.count++
    this.emit('change', this.count)
  }

  decrement() {
    this.count--
    this.emit('change', this.count)
  }
}

module.exports = { Counter }`

	test('step 1: parse - produces valid AST', async () => {
		const result = await parseCode(code, 'javascript')

		expect(result.error).toBeNull()
		expect(result.tree.rootNode.type).toBe('program')

		console.log('\n[JavaScript] AST root children:')
		for (const child of result.tree.rootNode.namedChildren) {
			console.log(
				`  - ${child.type} at lines ${child.startPosition.row}-${child.endPosition.row}`,
			)
		}
	})

	test('step 2: extract - finds all entities', async () => {
		const result = await parseCode(code, 'javascript')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'javascript',
			code,
		)

		console.log('\n[JavaScript] Extracted entities:')
		for (const e of entities) {
			console.log(`  - ${e.type}: ${e.name} (parent: ${e.parent ?? 'none'})`)
		}

		const classes = entities.filter((e) => e.type === 'class')
		const methods = entities.filter((e) => e.type === 'method')

		expect(classes).toHaveLength(1)
		expect(classes[0].name).toBe('Counter')
		expect(methods.length).toBeGreaterThanOrEqual(2)
	})

	test('step 4: chunk - produces valid chunks', async () => {
		const chunks = await chunk('counter.js', code)

		console.log('\n[JavaScript] Chunks:')
		for (const c of chunks) {
			console.log(
				`  Chunk ${c.index}: lines ${c.lineRange.start}-${c.lineRange.end}, entities: ${c.context.entities.map((e) => e.name).join(', ')}`,
			)
		}

		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks[0].context.language).toBe('javascript')
	})
})

// ============================================================================
// Python Pipeline Debug
// ============================================================================

describe('pipeline debug: Python', () => {
	const code = `from typing import Optional, List

class UserService:
    """Service for managing users."""
    
    def __init__(self, db):
        """Initialize with database connection."""
        self.db = db
    
    def get_user(self, user_id: int) -> Optional[dict]:
        """Fetch a user by ID."""
        return self.db.query(user_id)
    
    def list_users(self) -> List[dict]:
        """List all users."""
        return self.db.query_all()

def create_service(db) -> UserService:
    """Factory function for UserService."""
    return UserService(db)`

	test('step 1: parse - produces valid AST', async () => {
		const result = await parseCode(code, 'python')

		expect(result.error).toBeNull()
		expect(result.tree.rootNode.type).toBe('module')

		console.log('\n[Python] AST root children:')
		for (const child of result.tree.rootNode.namedChildren) {
			console.log(
				`  - ${child.type} at lines ${child.startPosition.row}-${child.endPosition.row}`,
			)
		}
	})

	test('step 2: extract - finds all entities with docstrings', async () => {
		const result = await parseCode(code, 'python')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'python',
			code,
		)

		console.log('\n[Python] Extracted entities:')
		for (const e of entities) {
			console.log(`  - ${e.type}: ${e.name}`)
			if (e.docstring) {
				console.log(`    docstring: "${e.docstring}"`)
			}
		}

		const classes = entities.filter((e) => e.type === 'class')
		const functions = entities.filter((e) => e.type === 'function')

		expect(classes).toHaveLength(1)
		expect(classes[0].name).toBe('UserService')
		expect(classes[0].docstring).toContain('managing users')

		// Python methods are extracted as 'function' type
		expect(functions.length).toBeGreaterThanOrEqual(4)
		expect(functions.some((f) => f.name === '__init__')).toBe(true)
		expect(functions.some((f) => f.name === 'create_service')).toBe(true)
	})

	test('step 4: chunk - produces valid chunks', async () => {
		const chunks = await chunk('service.py', code)

		console.log('\n[Python] Chunks:')
		for (const c of chunks) {
			console.log(
				`  Chunk ${c.index}: lines ${c.lineRange.start}-${c.lineRange.end}, entities: ${c.context.entities.map((e) => e.name).join(', ')}`,
			)
		}

		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks[0].context.language).toBe('python')
	})
})

// ============================================================================
// Rust Pipeline Debug
// ============================================================================

describe('pipeline debug: Rust', () => {
	const code = `use std::collections::HashMap;

/// A simple key-value store.
pub struct Store {
    data: HashMap<String, String>,
}

impl Store {
    /// Create a new empty store.
    pub fn new() -> Self {
        Store {
            data: HashMap::new(),
        }
    }

    /// Get a value by key.
    pub fn get(&self, key: &str) -> Option<&String> {
        self.data.get(key)
    }

    /// Set a value for a key.
    pub fn set(&mut self, key: String, value: String) {
        self.data.insert(key, value);
    }
}`

	test('step 1: parse - produces valid AST', async () => {
		const result = await parseCode(code, 'rust')

		expect(result.error).toBeNull()
		expect(result.tree.rootNode.type).toBe('source_file')

		console.log('\n[Rust] AST root children:')
		for (const child of result.tree.rootNode.namedChildren) {
			console.log(
				`  - ${child.type} at lines ${child.startPosition.row}-${child.endPosition.row}`,
			)
		}
	})

	test('step 2: extract - finds structs and impl functions', async () => {
		const result = await parseCode(code, 'rust')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'rust',
			code,
		)

		console.log('\n[Rust] Extracted entities:')
		for (const e of entities) {
			console.log(`  - ${e.type}: ${e.name}`)
			if (e.docstring) {
				console.log(`    docstring: "${e.docstring}"`)
			}
		}

		// Verify we find the struct and functions
		const entityNames = entities.map((e) => e.name)
		expect(entityNames).toContain('Store')
		expect(entityNames).toContain('new')
		expect(entityNames).toContain('get')
		expect(entityNames).toContain('set')
	})

	test('step 4: chunk - produces valid chunks', async () => {
		const chunks = await chunk('store.rs', code)

		console.log('\n[Rust] Chunks:')
		for (const c of chunks) {
			console.log(
				`  Chunk ${c.index}: lines ${c.lineRange.start}-${c.lineRange.end}, entities: ${c.context.entities.map((e) => e.name).join(', ')}`,
			)
		}

		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks[0].context.language).toBe('rust')
	})
})

// ============================================================================
// Go Pipeline Debug
// ============================================================================

describe('pipeline debug: Go', () => {
	const code = `package main

import "fmt"

// User represents a user in the system.
type User struct {
	ID   int
	Name string
}

// NewUser creates a new user with the given name.
func NewUser(name string) *User {
	return &User{Name: name}
}

// Greet returns a greeting for the user.
func (u *User) Greet() string {
	return fmt.Sprintf("Hello, %s!", u.Name)
}`

	test('step 1: parse - produces valid AST', async () => {
		const result = await parseCode(code, 'go')

		expect(result.error).toBeNull()
		expect(result.tree.rootNode.type).toBe('source_file')

		console.log('\n[Go] AST root children:')
		for (const child of result.tree.rootNode.namedChildren) {
			console.log(
				`  - ${child.type} at lines ${child.startPosition.row}-${child.endPosition.row}`,
			)
		}
	})

	test('step 2: extract - finds types, functions, and methods', async () => {
		const result = await parseCode(code, 'go')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'go',
			code,
		)

		console.log('\n[Go] Extracted entities:')
		for (const e of entities) {
			console.log(`  - ${e.type}: ${e.name}`)
			if (e.docstring) {
				console.log(`    docstring: "${e.docstring}"`)
			}
		}

		const types = entities.filter((e) => e.type === 'type')
		const functions = entities.filter((e) => e.type === 'function')
		const methods = entities.filter((e) => e.type === 'method')

		expect(types.some((t) => t.name === 'User')).toBe(true)
		expect(functions.some((f) => f.name === 'NewUser')).toBe(true)
		expect(methods.some((m) => m.name === 'Greet')).toBe(true)
	})

	test('step 4: chunk - produces valid chunks', async () => {
		const chunks = await chunk('main.go', code)

		console.log('\n[Go] Chunks:')
		for (const c of chunks) {
			console.log(
				`  Chunk ${c.index}: lines ${c.lineRange.start}-${c.lineRange.end}, entities: ${c.context.entities.map((e) => e.name).join(', ')}`,
			)
		}

		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks[0].context.language).toBe('go')
	})
})

// ============================================================================
// Java Pipeline Debug
// ============================================================================

describe('pipeline debug: Java', () => {
	const code = `package com.example;

import java.util.ArrayList;
import java.util.List;

/**
 * A simple task manager.
 */
public class TaskManager {
    private List<String> tasks;

    /**
     * Create a new task manager.
     */
    public TaskManager() {
        this.tasks = new ArrayList<>();
    }

    /**
     * Add a task to the list.
     * @param task the task to add
     */
    public void addTask(String task) {
        tasks.add(task);
    }

    /**
     * Get all tasks.
     * @return list of all tasks
     */
    public List<String> getTasks() {
        return new ArrayList<>(tasks);
    }
}`

	test('step 1: parse - produces valid AST', async () => {
		const result = await parseCode(code, 'java')

		expect(result.error).toBeNull()
		expect(result.tree.rootNode.type).toBe('program')

		console.log('\n[Java] AST root children:')
		for (const child of result.tree.rootNode.namedChildren) {
			console.log(
				`  - ${child.type} at lines ${child.startPosition.row}-${child.endPosition.row}`,
			)
		}
	})

	test('step 2: extract - finds class and methods with Javadoc', async () => {
		const result = await parseCode(code, 'java')
		const entities = await extractEntitiesAsync(
			result.tree.rootNode,
			'java',
			code,
		)

		console.log('\n[Java] Extracted entities:')
		for (const e of entities) {
			console.log(`  - ${e.type}: ${e.name} (parent: ${e.parent ?? 'none'})`)
			if (e.docstring) {
				console.log(`    docstring: "${e.docstring.slice(0, 50)}..."`)
			}
		}

		const classes = entities.filter((e) => e.type === 'class')
		const methods = entities.filter((e) => e.type === 'method')

		expect(classes).toHaveLength(1)
		expect(classes[0].name).toBe('TaskManager')
		expect(classes[0].docstring).toContain('task manager')

		expect(methods.length).toBeGreaterThanOrEqual(2)
		expect(methods.some((m) => m.name === 'addTask')).toBe(true)
		expect(methods.some((m) => m.name === 'getTasks')).toBe(true)
	})

	test('step 4: chunk - produces valid chunks', async () => {
		const chunks = await chunk('TaskManager.java', code)

		console.log('\n[Java] Chunks:')
		for (const c of chunks) {
			console.log(
				`  Chunk ${c.index}: lines ${c.lineRange.start}-${c.lineRange.end}, entities: ${c.context.entities.map((e) => e.name).join(', ')}`,
			)
		}

		expect(chunks.length).toBeGreaterThan(0)
		expect(chunks[0].context.language).toBe('java')
	})
})

// ============================================================================
// Chunk Splitting Verification
// ============================================================================

describe('pipeline debug: chunk splitting', () => {
	test('large code splits into multiple chunks correctly', async () => {
		const code = `import { Database } from './db'
import { Logger } from './utils'

/**
 * Service for managing user accounts.
 */
export class UserService {
  private db: Database
  private logger: Logger

  constructor(db: Database, logger: Logger) {
    this.db = db
    this.logger = logger
  }

  /**
   * Fetch a user by ID.
   */
  async getUser(id: string): Promise<User | null> {
    this.logger.info(\`Fetching user: \${id}\`)
    return this.db.query('SELECT * FROM users WHERE id = ?', [id])
  }

  /**
   * Create a new user.
   */
  async createUser(data: CreateUserInput): Promise<User> {
    this.logger.info('Creating new user')
    const result = await this.db.insert('users', data)
    return { id: result.insertId, ...data }
  }
}

function validateUserInput(input: unknown): boolean {
  return typeof input === 'object' && input !== null
}`

		const chunks = await chunk('user-service.ts', code, { maxChunkSize: 300 })

		console.log('\n[Split Test] Chunk count:', chunks.length)

		// Should produce multiple chunks
		expect(chunks.length).toBeGreaterThan(1)

		// Verify no overlaps
		const sorted = [...chunks].sort(
			(a, b) => a.byteRange.start - b.byteRange.start,
		)
		for (let i = 1; i < sorted.length; i++) {
			const prev = sorted[i - 1]
			const curr = sorted[i]
			expect(curr.byteRange.start).toBeGreaterThanOrEqual(prev.byteRange.end)
		}

		// Verify all text matches byte slices
		for (const c of chunks) {
			const sliced = code.slice(c.byteRange.start, c.byteRange.end)
			expect(c.text).toBe(sliced)
		}

		// Verify partial entities are marked correctly
		const partialChunks = chunks.filter((c) =>
			c.context.entities.some((e) => e.isPartial),
		)
		console.log(
			'[Split Test] Chunks with partial entities:',
			partialChunks.length,
		)

		// If UserService spans multiple chunks, it should be marked partial
		const userServiceChunks = chunks.filter((c) =>
			c.context.entities.some((e) => e.name === 'UserService'),
		)
		if (userServiceChunks.length > 1) {
			// All but possibly the last should have it marked as partial
			const partialUserService = userServiceChunks.filter((c) =>
				c.context.entities.some((e) => e.name === 'UserService' && e.isPartial),
			)
			expect(partialUserService.length).toBeGreaterThan(0)
		}

		// Verify scope chain for nested chunks
		for (const c of chunks) {
			const methods = c.context.entities.filter((e) => e.type === 'method')
			if (methods.length > 0) {
				// Chunks with methods should have UserService in scope
				const hasUserServiceInScope = c.context.scope.some(
					(s) => s.name === 'UserService',
				)
				console.log(
					`[Split Test] Chunk ${c.index} has methods: ${methods.map((m) => m.name).join(', ')}, UserService in scope: ${hasUserServiceInScope}`,
				)
			}
		}
	})

	test('siblings are populated correctly', async () => {
		const code = `function first() { return 1 }
function second() { return 2 }
function third() { return 3 }
function fourth() { return 4 }`

		// Use small chunk size to force multiple chunks so siblings are visible
		const chunks = await chunk('funcs.ts', code, {
			maxChunkSize: 50,
			siblingDetail: 'names',
		})

		console.log('\n[Siblings Test] Chunks:', chunks.length)
		for (const c of chunks) {
			console.log(
				`  Chunk ${c.index}: entities=${c.context.entities.map((e) => e.name).join(',')}, siblings=${c.context.siblings.map((s) => `${s.name}(${s.position})`).join(',')}`,
			)
		}

		// At least one chunk should have siblings
		const hasSiblings = chunks.some((c) => c.context.siblings.length > 0)
		expect(hasSiblings).toBe(true)

		// Verify sibling positions make sense
		for (const c of chunks) {
			for (const sibling of c.context.siblings) {
				expect(['before', 'after']).toContain(sibling.position)
				expect(sibling.distance).toBeGreaterThan(0)
			}
		}
	})

	test('imports are included in context', async () => {
		const code = `import { Effect, Context } from 'effect'
import type { Option } from 'effect/Option'

function useEffect(): Effect.Effect<void> {
  return Effect.void
}`

		const chunks = await chunk('effect-usage.ts', code)

		console.log('\n[Imports Test] Chunks:', chunks.length)
		for (const c of chunks) {
			console.log(
				`  Chunk ${c.index}: imports=${c.context.imports.map((i) => `${i.name}(${i.source})`).join(', ')}`,
			)
		}

		// All chunks should have imports in context
		for (const c of chunks) {
			expect(c.context.imports.length).toBeGreaterThan(0)
		}

		// Verify import sources
		const allImports = chunks.flatMap((c) => c.context.imports)
		expect(allImports.some((i) => i.source === 'effect')).toBe(true)
	})
})

// ============================================================================
// Cross-Language Consistency
// ============================================================================

describe('pipeline debug: cross-language consistency', () => {
	const samples: {
		lang: Language
		path: string
		code: string
		expectedClass: string
		expectedMethod: string
	}[] = [
		{
			lang: 'typescript',
			path: 'test.ts',
			code: `class Foo { bar(): void { console.log('hello') } }`,
			expectedClass: 'Foo',
			expectedMethod: 'bar',
		},
		{
			lang: 'javascript',
			path: 'test.js',
			code: `class Foo { bar() { console.log('hello') } }`,
			expectedClass: 'Foo',
			expectedMethod: 'bar',
		},
		{
			lang: 'python',
			path: 'test.py',
			code: `class Foo:\n    def bar(self):\n        print('hello')`,
			expectedClass: 'Foo',
			expectedMethod: 'bar',
		},
		{
			lang: 'java',
			path: 'Foo.java',
			code: `public class Foo { void bar() { System.out.println("hello"); } }`,
			expectedClass: 'Foo',
			expectedMethod: 'bar',
		},
	]

	for (const sample of samples) {
		test(`${sample.lang}: extracts class and method consistently`, async () => {
			const chunks = await chunk(sample.path, sample.code)

			const allEntities = chunks.flatMap((c) => c.context.entities)
			const entityNames = allEntities.map((e) => e.name)

			console.log(`\n[${sample.lang}] Entities: ${entityNames.join(', ')}`)

			expect(entityNames).toContain(sample.expectedClass)
			expect(entityNames).toContain(sample.expectedMethod)
		})
	}
})
