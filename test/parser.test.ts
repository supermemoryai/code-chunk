import { beforeAll, describe, expect, test } from 'bun:test'
import { detectLanguage } from '../src'
import { initializeParser, parseCode } from '../src/parser'

// ============================================================================
// Language Detection Tests
// ============================================================================

describe('detectLanguage', () => {
	test('detects typescript from .ts extension', () => {
		expect(detectLanguage('src/index.ts')).toBe('typescript')
	})

	test('detects typescript from .tsx extension', () => {
		expect(detectLanguage('components/Button.tsx')).toBe('typescript')
	})

	test('detects javascript from .js extension', () => {
		expect(detectLanguage('lib/utils.js')).toBe('javascript')
	})

	test('detects javascript from .jsx extension', () => {
		expect(detectLanguage('components/App.jsx')).toBe('javascript')
	})

	test('detects python from .py extension', () => {
		expect(detectLanguage('scripts/main.py')).toBe('python')
	})

	test('detects rust from .rs extension', () => {
		expect(detectLanguage('src/lib.rs')).toBe('rust')
	})

	test('detects go from .go extension', () => {
		expect(detectLanguage('cmd/main.go')).toBe('go')
	})

	test('detects java from .java extension', () => {
		expect(detectLanguage('src/Main.java')).toBe('java')
	})

	test('returns null for unsupported extension', () => {
		expect(detectLanguage('README.md')).toBeNull()
		expect(detectLanguage('config.yaml')).toBeNull()
		expect(detectLanguage('Makefile')).toBeNull()
	})
})

// ============================================================================
// Parser Tests
// ============================================================================

describe('parseCode', () => {
	beforeAll(async () => {
		await initializeParser()
	})

	test('parses valid TypeScript code', async () => {
		const code = `
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
`
		const result = await parseCode(code, 'typescript')

		expect(result.tree).toBeDefined()
		expect(result.error).toBeNull()
		expect(result.tree.rootNode.type).toBe('program')
	})

	test('parses valid JavaScript code', async () => {
		const code = `
const add = (a, b) => a + b
export default add
`
		const result = await parseCode(code, 'javascript')

		expect(result.tree).toBeDefined()
		expect(result.error).toBeNull()
	})

	test('parses valid Python code', async () => {
		const code = `
def greet(name):
    return f"Hello, {name}!"
`
		const result = await parseCode(code, 'python')

		expect(result.tree).toBeDefined()
		expect(result.error).toBeNull()
	})

	test('parses valid Rust code', async () => {
		const code = `
fn main() {
    println!("Hello, world!");
}
`
		const result = await parseCode(code, 'rust')

		expect(result.tree).toBeDefined()
		expect(result.error).toBeNull()
	})

	test('parses valid Go code', async () => {
		const code = `
package main

func main() {
    fmt.Println("Hello, world!")
}
`
		const result = await parseCode(code, 'go')

		expect(result.tree).toBeDefined()
		expect(result.error).toBeNull()
	})

	test('parses valid Java code', async () => {
		const code = `
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}
`
		const result = await parseCode(code, 'java')

		expect(result.tree).toBeDefined()
		expect(result.error).toBeNull()
	})

	test('handles syntax errors gracefully (recoverable)', async () => {
		const code = `
function broken( {
  return 
}
`
		const result = await parseCode(code, 'typescript')

		// Tree-sitter always produces a tree
		expect(result.tree).toBeDefined()
		// But marks the error
		expect(result.error).not.toBeNull()
		expect(result.error?.recoverable).toBe(true)
	})

	test('parses code with multiple functions', async () => {
		const code = `
function add(a: number, b: number): number {
  return a + b
}

function subtract(a: number, b: number): number {
  return a - b
}
`
		const result = await parseCode(code, 'typescript')

		expect(result.tree).toBeDefined()
		expect(result.error).toBeNull()

		// Check that we have function declarations
		const root = result.tree.rootNode
		const functions = root.children.filter(
			(n) => n.type === 'function_declaration',
		)
		expect(functions.length).toBe(2)
	})
})
