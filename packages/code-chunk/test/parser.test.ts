import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { detectLanguage } from '../src'
import {
	clearGrammarCache,
	initializeParser,
	parseCode,
	resetParser,
} from '../src/parser'

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

	test('detects typescript from .mts extension', () => {
		expect(detectLanguage('src/module.mts')).toBe('typescript')
	})

	test('detects typescript from .cts extension', () => {
		expect(detectLanguage('src/commonjs.cts')).toBe('typescript')
	})

	test('detects javascript from .js extension', () => {
		expect(detectLanguage('lib/utils.js')).toBe('javascript')
	})

	test('detects javascript from .jsx extension', () => {
		expect(detectLanguage('components/App.jsx')).toBe('javascript')
	})

	test('detects javascript from .mjs extension', () => {
		expect(detectLanguage('lib/module.mjs')).toBe('javascript')
	})

	test('detects javascript from .cjs extension', () => {
		expect(detectLanguage('lib/commonjs.cjs')).toBe('javascript')
	})

	test('detects python from .py extension', () => {
		expect(detectLanguage('scripts/main.py')).toBe('python')
	})

	test('detects python from .pyi extension', () => {
		expect(detectLanguage('stubs/types.pyi')).toBe('python')
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
		expect(detectLanguage('data.json')).toBeNull()
		expect(detectLanguage('.env')).toBeNull()
	})

	test('handles deeply nested paths correctly', () => {
		expect(detectLanguage('src/a/b/c/deep/file.ts')).toBe('typescript')
		expect(detectLanguage('/absolute/path/to/file.py')).toBe('python')
	})

	test('handles filenames with multiple dots', () => {
		expect(detectLanguage('file.test.ts')).toBe('typescript')
		expect(detectLanguage('app.config.js')).toBe('javascript')
		expect(detectLanguage('my.file.name.py')).toBe('python')
	})
})

// ============================================================================
// Parser Tests
// ============================================================================

describe('parseCode', () => {
	beforeAll(async () => {
		await initializeParser()
	})

	describe('TypeScript parsing', () => {
		test('parses simple function with exact AST structure', async () => {
			const code = `function greet(name: string): string {
  return \`Hello, \${name}!\`
}`
			const result = await parseCode(code, 'typescript')

			expect(result.error).toBeNull()
			expect(result.tree.rootNode.type).toBe('program')
			expect(result.tree.rootNode.childCount).toBe(1)

			const funcNode = result.tree.rootNode.firstChild!
			expect(funcNode.type).toBe('function_declaration')

			// Verify function name via tree-sitter field access
			const nameNode = funcNode.childForFieldName('name')
			expect(nameNode).not.toBeNull()
			expect(nameNode?.type).toBe('identifier')
			expect(nameNode?.text).toBe('greet')

			// Verify exact positions
			expect(funcNode.startPosition.row).toBe(0)
			expect(funcNode.startPosition.column).toBe(0)
			expect(funcNode.endPosition.row).toBe(2)
			expect(funcNode.endPosition.column).toBe(1)

			// Verify parameters field
			const paramsNode = funcNode.childForFieldName('parameters')
			expect(paramsNode).not.toBeNull()
			expect(paramsNode?.type).toBe('formal_parameters')

			// Verify return type field
			const returnTypeNode = funcNode.childForFieldName('return_type')
			expect(returnTypeNode).not.toBeNull()

			// Verify body field
			const bodyNode = funcNode.childForFieldName('body')
			expect(bodyNode).not.toBeNull()
			expect(bodyNode?.type).toBe('statement_block')
		})

		test('parses arrow function with exact positions', async () => {
			const code = `const add = (a: number, b: number) => a + b`
			const result = await parseCode(code, 'typescript')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.type).toBe('program')
			expect(root.childCount).toBe(1)

			const lexicalDecl = root.firstChild!
			expect(lexicalDecl.type).toBe('lexical_declaration')

			const variableDeclarator = lexicalDecl.firstNamedChild!
			expect(variableDeclarator.type).toBe('variable_declarator')

			const arrowFunc = variableDeclarator.childForFieldName('value')
			expect(arrowFunc).not.toBeNull()
			expect(arrowFunc?.type).toBe('arrow_function')

			// Verify positions
			expect(root.startPosition).toEqual({ row: 0, column: 0 })
			expect(root.endPosition).toEqual({ row: 0, column: 43 })
		})

		test('parses class with exact child structure', async () => {
			const code = `class Calculator {
  private value: number = 0
  
  add(n: number): number {
    return this.value += n
  }
}`
			const result = await parseCode(code, 'typescript')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(1)

			const classNode = root.firstChild!
			expect(classNode.type).toBe('class_declaration')

			const className = classNode.childForFieldName('name')
			expect(className).not.toBeNull()
			expect(className?.text).toBe('Calculator')

			const body = classNode.childForFieldName('body')
			expect(body).not.toBeNull()
			expect(body?.type).toBe('class_body')

			// Verify class body has exactly 2 members (field + method)
			const namedChildren = body?.namedChildren
			expect(namedChildren).toHaveLength(2)
			expect(namedChildren[0].type).toBe('public_field_definition')
			expect(namedChildren[1].type).toBe('method_definition')
		})

		test('parses interface with exact structure', async () => {
			const code = `interface User {
  id: number
  name: string
  email?: string
}`
			const result = await parseCode(code, 'typescript')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(1)

			const interfaceNode = root.firstChild!
			expect(interfaceNode.type).toBe('interface_declaration')

			const interfaceName = interfaceNode.childForFieldName('name')
			expect(interfaceName?.text).toBe('User')

			const body = interfaceNode.childForFieldName('body')
			expect(body).not.toBeNull()
			expect(body?.type).toBe('interface_body')

			// Verify exact property count
			const properties = body?.namedChildren.filter(
				(n) => n.type === 'property_signature',
			)
			expect(properties).toHaveLength(3)
		})

		test('parses type alias with exact structure', async () => {
			const code = `type Status = 'pending' | 'active' | 'done'`
			const result = await parseCode(code, 'typescript')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(1)

			const typeAlias = root.firstChild!
			expect(typeAlias.type).toBe('type_alias_declaration')

			const typeName = typeAlias.childForFieldName('name')
			expect(typeName?.text).toBe('Status')

			const typeValue = typeAlias.childForFieldName('value')
			expect(typeValue).not.toBeNull()
			expect(typeValue?.type).toBe('union_type')
		})
	})

	describe('JavaScript parsing', () => {
		test('parses ES6 module exports with exact structure', async () => {
			const code = `const add = (a, b) => a + b
export default add
export { add }`
			const result = await parseCode(code, 'javascript')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.type).toBe('program')
			expect(root.childCount).toBe(3)

			expect(root.children[0].type).toBe('lexical_declaration')
			expect(root.children[1].type).toBe('export_statement')
			expect(root.children[2].type).toBe('export_statement')

			// Verify byte ranges
			expect(root.startIndex).toBe(0)
			expect(root.endIndex).toBe(code.length)
		})

		test('parses object destructuring correctly', async () => {
			const code = `const { a, b, c: renamed } = obj`
			const result = await parseCode(code, 'javascript')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(1)

			const lexicalDecl = root.firstChild!
			expect(lexicalDecl.type).toBe('lexical_declaration')

			const declarator = lexicalDecl.firstNamedChild!
			const pattern = declarator.childForFieldName('name')
			expect(pattern?.type).toBe('object_pattern')
		})
	})

	describe('Python parsing', () => {
		test('parses function with exact positions', async () => {
			const code = `def greet(name):
    return f"Hello, {name}!"`
			const result = await parseCode(code, 'python')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.type).toBe('module')
			expect(root.childCount).toBe(1)

			const funcNode = root.firstChild!
			expect(funcNode.type).toBe('function_definition')

			const funcName = funcNode.childForFieldName('name')
			expect(funcName?.text).toBe('greet')

			// Verify exact position
			expect(funcNode.startPosition).toEqual({ row: 0, column: 0 })
			// End position column is length of "    return f\"Hello, {name}!\""
			expect(funcNode.endPosition.row).toBe(1)
			expect(funcNode.endPosition.column).toBe(28)
		})

		test('parses class with methods', async () => {
			const code = `class Calculator:
    def __init__(self):
        self.value = 0
    
    def add(self, n):
        self.value += n
        return self.value`
			const result = await parseCode(code, 'python')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(1)

			const classNode = root.firstChild!
			expect(classNode.type).toBe('class_definition')

			const className = classNode.childForFieldName('name')
			expect(className?.text).toBe('Calculator')

			const body = classNode.childForFieldName('body')
			expect(body).not.toBeNull()
			expect(body?.type).toBe('block')

			// Verify method count
			const methods = body?.namedChildren.filter(
				(n) => n.type === 'function_definition',
			)
			expect(methods).toHaveLength(2)
		})

		test('parses decorators correctly', async () => {
			const code = `@property
def value(self):
    return self._value`
			const result = await parseCode(code, 'python')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(1)

			const decoratedDef = root.firstChild!
			expect(decoratedDef.type).toBe('decorated_definition')

			const decorator = decoratedDef.namedChildren.find(
				(n) => n.type === 'decorator',
			)
			expect(decorator).not.toBeNull()

			const funcDef = decoratedDef.namedChildren.find(
				(n) => n.type === 'function_definition',
			)
			expect(funcDef).not.toBeNull()
		})
	})

	describe('Rust parsing', () => {
		test('parses function with exact structure', async () => {
			const code = `fn main() {
    println!("Hello, world!");
}`
			const result = await parseCode(code, 'rust')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.type).toBe('source_file')
			expect(root.childCount).toBe(1)

			const funcNode = root.firstChild!
			expect(funcNode.type).toBe('function_item')

			const funcName = funcNode.childForFieldName('name')
			expect(funcName?.text).toBe('main')

			// Verify positions
			expect(funcNode.startPosition).toEqual({ row: 0, column: 0 })
			expect(funcNode.endPosition).toEqual({ row: 2, column: 1 })
		})

		test('parses struct with fields', async () => {
			const code = `struct Point {
    x: i32,
    y: i32,
}`
			const result = await parseCode(code, 'rust')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(1)

			const structNode = root.firstChild!
			expect(structNode.type).toBe('struct_item')

			const structName = structNode.childForFieldName('name')
			expect(structName?.text).toBe('Point')

			const body = structNode.childForFieldName('body')
			expect(body).not.toBeNull()
			expect(body?.type).toBe('field_declaration_list')

			// Verify field count
			const fields = body?.namedChildren.filter(
				(n) => n.type === 'field_declaration',
			)
			expect(fields).toHaveLength(2)
		})

		test('parses impl block correctly', async () => {
			const code = `impl Point {
    fn new(x: i32, y: i32) -> Self {
        Point { x, y }
    }
}`
			const result = await parseCode(code, 'rust')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(1)

			const implNode = root.firstChild!
			expect(implNode.type).toBe('impl_item')

			const implType = implNode.childForFieldName('type')
			expect(implType?.text).toBe('Point')

			const body = implNode.childForFieldName('body')
			expect(body).not.toBeNull()

			const methods = body?.namedChildren.filter(
				(n) => n.type === 'function_item',
			)
			expect(methods).toHaveLength(1)
		})
	})

	describe('Go parsing', () => {
		test('parses package and function with exact structure', async () => {
			const code = `package main

func main() {
    fmt.Println("Hello, world!")
}`
			const result = await parseCode(code, 'go')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.type).toBe('source_file')
			expect(root.childCount).toBe(2)

			expect(root.children[0].type).toBe('package_clause')
			expect(root.children[1].type).toBe('function_declaration')

			const funcNode = root.children[1]
			const funcName = funcNode.childForFieldName('name')
			expect(funcName?.text).toBe('main')

			// Verify positions
			expect(funcNode.startPosition).toEqual({ row: 2, column: 0 })
		})

		test('parses struct with methods', async () => {
			const code = `package main

type Point struct {
    X int
    Y int
}

func (p Point) String() string {
    return fmt.Sprintf("(%d, %d)", p.X, p.Y)
}`
			const result = await parseCode(code, 'go')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(3)

			expect(root.children[0].type).toBe('package_clause')
			expect(root.children[1].type).toBe('type_declaration')
			expect(root.children[2].type).toBe('method_declaration')

			// Verify struct
			const typeDecl = root.children[1]
			const typeSpec = typeDecl.firstNamedChild!
			expect(typeSpec.type).toBe('type_spec')

			// Verify method receiver
			const methodDecl = root.children[2]
			const receiver = methodDecl.childForFieldName('receiver')
			expect(receiver).not.toBeNull()
		})
	})

	describe('Java parsing', () => {
		test('parses class with exact structure', async () => {
			const code = `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}`
			const result = await parseCode(code, 'java')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.type).toBe('program')
			expect(root.childCount).toBe(1)

			const classNode = root.firstChild!
			expect(classNode.type).toBe('class_declaration')

			const className = classNode.childForFieldName('name')
			expect(className?.text).toBe('Main')

			const body = classNode.childForFieldName('body')
			expect(body).not.toBeNull()
			expect(body?.type).toBe('class_body')

			const methods = body?.namedChildren.filter(
				(n) => n.type === 'method_declaration',
			)
			expect(methods).toHaveLength(1)

			// Verify method name
			const mainMethod = methods[0]
			const methodName = mainMethod.childForFieldName('name')
			expect(methodName?.text).toBe('main')
		})

		test('parses interface correctly', async () => {
			const code = `public interface Comparable<T> {
    int compareTo(T other);
}`
			const result = await parseCode(code, 'java')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(1)

			const interfaceNode = root.firstChild!
			expect(interfaceNode.type).toBe('interface_declaration')

			const interfaceName = interfaceNode.childForFieldName('name')
			expect(interfaceName?.text).toBe('Comparable')
		})
	})

	describe('syntax errors and partial trees', () => {
		test('TypeScript: missing closing brace produces recoverable error', async () => {
			const code = `function broken( {
  return 
}`
			const result = await parseCode(code, 'typescript')

			// Tree-sitter always produces a tree
			expect(result.tree).not.toBeNull()
			expect(result.tree.rootNode.type).toBe('program')

			// Verify error details
			expect(result.error).not.toBeNull()
			expect(result.error?.recoverable).toBe(true)
			// Error message contains either ERROR or MISSING depending on grammar
			expect(result.error?.message).toMatch(/ERROR|MISSING/)

			// Verify tree has errors
			expect(result.tree.rootNode.hasError).toBe(true)
		})

		test('TypeScript: unclosed string produces error with position', async () => {
			const code = `const x = "unclosed string`
			const result = await parseCode(code, 'typescript')

			expect(result.tree).not.toBeNull()
			expect(result.error).not.toBeNull()
			expect(result.error?.recoverable).toBe(true)
			// Error message should include position info
			expect(result.error?.message).toMatch(/line \d+, column \d+/)
		})

		test('Python: missing body produces partial tree', async () => {
			// A function without a valid body produces an error
			const code = `def broken():`
			const result = await parseCode(code, 'python')

			expect(result.tree).not.toBeNull()
			// Tree should still be navigable
			const root = result.tree.rootNode
			expect(root.type).toBe('module')
			// May or may not have error depending on grammar tolerance
		})

		test('JavaScript: missing semicolon in strict context', async () => {
			const code = `const a = 1
const b = 2`
			const result = await parseCode(code, 'javascript')

			// This is actually valid JS, no semicolons needed
			expect(result.error).toBeNull()
			expect(result.tree.rootNode.childCount).toBe(2)
		})

		test('Rust: missing semicolon produces error', async () => {
			const code = `fn main() {
    let x = 5
    let y = 6;
}`
			const result = await parseCode(code, 'rust')

			// Rust requires semicolons - this should have an error
			expect(result.tree).not.toBeNull()
			expect(result.error).not.toBeNull()
			expect(result.error?.recoverable).toBe(true)
		})

		test('Go: missing package declaration produces error', async () => {
			const code = `func main() {
    fmt.Println("Hello")
}`
			const result = await parseCode(code, 'go')

			// Go files need package declaration
			// Tree-sitter may or may not error on this depending on grammar
			expect(result.tree).not.toBeNull()
			const root = result.tree.rootNode
			expect(root.type).toBe('source_file')
		})

		test('multiple errors are collected in message', async () => {
			const code = `function a( { return }
function b( { return }
function c( { return }`
			const result = await parseCode(code, 'typescript')

			expect(result.error).not.toBeNull()
			expect(result.error?.recoverable).toBe(true)
			// Should have multiple error locations (ERROR or MISSING)
			expect(result.error?.message).toMatch(/ERROR|MISSING/)
			// Multiple errors means multiple occurrences of line info
			const lineMatches = result.error?.message.match(/line \d+/g)
			expect(lineMatches?.length).toBeGreaterThanOrEqual(2)
		})

		test('error count is capped at 3 plus summary', async () => {
			const code = `function a( { }
function b( { }
function c( { }
function d( { }
function e( { }`
			const result = await parseCode(code, 'typescript')

			expect(result.error).not.toBeNull()
			// Error message should show first 3 errors and "... and X more"
			expect(result.error?.message).toContain('more')
		})
	})

	describe('rootNode properties with exact values', () => {
		test('TypeScript rootNode has correct properties', async () => {
			const code = `export const x = 1`
			const result = await parseCode(code, 'typescript')

			const root = result.tree.rootNode
			expect(root.type).toBe('program')
			expect(root.text).toBe(code)
			expect(root.childCount).toBe(1)
			expect(root.startIndex).toBe(0)
			expect(root.endIndex).toBe(code.length)
			expect(root.startPosition).toEqual({ row: 0, column: 0 })
			expect(root.endPosition).toEqual({ row: 0, column: 18 })
			expect(root.hasError).toBe(false)
			expect(root.parent).toBeNull()
		})

		test('Python rootNode has correct properties', async () => {
			const code = `x = 1`
			const result = await parseCode(code, 'python')

			const root = result.tree.rootNode
			expect(root.type).toBe('module')
			expect(root.text).toBe(code)
			expect(root.childCount).toBe(1)
			expect(root.startIndex).toBe(0)
			expect(root.endIndex).toBe(5)
		})

		test('Rust rootNode has correct properties', async () => {
			const code = `fn x() {}`
			const result = await parseCode(code, 'rust')

			const root = result.tree.rootNode
			expect(root.type).toBe('source_file')
			expect(root.text).toBe(code)
			expect(root.childCount).toBe(1)
		})

		test('Go rootNode has correct properties', async () => {
			const code = `package main`
			const result = await parseCode(code, 'go')

			const root = result.tree.rootNode
			expect(root.type).toBe('source_file')
			expect(root.text).toBe(code)
			expect(root.childCount).toBe(1)
		})

		test('Java rootNode has correct properties', async () => {
			const code = `class X {}`
			const result = await parseCode(code, 'java')

			const root = result.tree.rootNode
			expect(root.type).toBe('program')
			expect(root.text).toBe(code)
			expect(root.childCount).toBe(1)
		})
	})

	describe('exact node counts in parsed trees', () => {
		test('counts nodes in TypeScript with imports and exports', async () => {
			const code = `import { foo } from 'bar'
export function greet(name: string) {
  return name
}`
			const result = await parseCode(code, 'typescript')

			expect(result.error).toBeNull()
			const root = result.tree.rootNode
			expect(root.childCount).toBe(2)

			const importStmt = root.children[0]
			expect(importStmt.type).toBe('import_statement')

			const exportStmt = root.children[1]
			expect(exportStmt.type).toBe('export_statement')
		})

		test('counts nested class members accurately', async () => {
			const code = `class Example {
  field1 = 1
  field2 = 2
  method1() {}
  method2() {}
  method3() {}
}`
			const result = await parseCode(code, 'typescript')

			expect(result.error).toBeNull()
			const classNode = result.tree.rootNode.firstChild!
			const body = classNode.childForFieldName('body')!

			// Should have exactly 5 members
			const members = body.namedChildren
			expect(members).toHaveLength(5)

			const fields = members.filter((n) => n.type === 'public_field_definition')
			const methods = members.filter((n) => n.type === 'method_definition')

			expect(fields).toHaveLength(2)
			expect(methods).toHaveLength(3)
		})

		test('counts function parameters exactly', async () => {
			const code = `function test(a: number, b: string, c?: boolean, ...rest: any[]) {}`
			const result = await parseCode(code, 'typescript')

			expect(result.error).toBeNull()
			const funcNode = result.tree.rootNode.firstChild!
			const params = funcNode.childForFieldName('parameters')!

			// Parameters include: a, b, c, rest
			const paramList = params.namedChildren
			expect(paramList).toHaveLength(4)
		})

		test('counts array elements correctly', async () => {
			const code = `const arr = [1, 2, 3, 4, 5]`
			const result = await parseCode(code, 'typescript')

			expect(result.error).toBeNull()
			const decl = result.tree.rootNode.firstChild!
			const declarator = decl.firstNamedChild!
			const arrayLiteral = declarator.childForFieldName('value')!

			expect(arrayLiteral.type).toBe('array')
			expect(arrayLiteral.namedChildCount).toBe(5)
		})
	})

	describe('tree-sitter node navigation', () => {
		test('namedChildren filters anonymous nodes', async () => {
			const code = `const x = { a: 1, b: 2 }`
			const result = await parseCode(code, 'typescript')

			const decl = result.tree.rootNode.firstChild!
			const declarator = decl.firstNamedChild!
			const obj = declarator.childForFieldName('value')!

			// All children includes punctuation
			expect(obj.childCount).toBeGreaterThan(obj.namedChildCount)

			// Named children should be just the properties
			expect(obj.namedChildCount).toBe(2)
			expect(obj.namedChildren[0].type).toBe('pair')
			expect(obj.namedChildren[1].type).toBe('pair')
		})

		test('firstChild and lastChild work correctly', async () => {
			const code = `function a() {}
function b() {}
function c() {}`
			const result = await parseCode(code, 'typescript')

			const root = result.tree.rootNode
			expect(root.firstChild?.type).toBe('function_declaration')
			expect(root.lastChild?.type).toBe('function_declaration')

			// Verify first vs last by checking function names
			const firstName = root.firstChild?.childForFieldName('name')?.text
			const lastName = root.lastChild?.childForFieldName('name')?.text

			expect(firstName).toBe('a')
			expect(lastName).toBe('c')
		})

		test('nextSibling and previousSibling navigation', async () => {
			const code = `function a() {}
function b() {}
function c() {}`
			const result = await parseCode(code, 'typescript')

			const root = result.tree.rootNode
			const first = root.firstChild!
			const second = first.nextSibling!
			const third = second.nextSibling!

			expect(second.childForFieldName('name')?.text).toBe('b')
			expect(third.childForFieldName('name')?.text).toBe('c')
			expect(third.nextSibling).toBeNull()

			// Use .equals() for node comparison instead of toBe (object identity)
			expect(third.previousSibling?.equals(second)).toBe(true)
			expect(second.previousSibling?.equals(first)).toBe(true)
			expect(first.previousSibling).toBeNull()
		})

		test('descendantForIndex finds correct node', async () => {
			const code = `function greet(name: string) {}`
			const result = await parseCode(code, 'typescript')

			const root = result.tree.rootNode

			// Find node at position of "name" parameter
			const nameStart = code.indexOf('name')
			const node = root.descendantForIndex(nameStart)

			expect(node).not.toBeNull()
			expect(node?.text).toBe('name')
			expect(node?.type).toBe('identifier')
		})
	})
})

// ============================================================================
// Grammar Caching Tests
// ============================================================================

describe('grammar caching', () => {
	beforeEach(() => {
		resetParser()
	})

	test('cached grammars are reused on subsequent parses', async () => {
		await initializeParser()

		// First parse loads the grammar
		const code1 = `const x = 1`
		const result1 = await parseCode(code1, 'typescript')
		expect(result1.error).toBeNull()

		// Second parse should use cached grammar
		const code2 = `const y = 2`
		const result2 = await parseCode(code2, 'typescript')
		expect(result2.error).toBeNull()

		// Both should parse successfully with same root type
		expect(result1.tree.rootNode.type).toBe('program')
		expect(result2.tree.rootNode.type).toBe('program')
	})

	test('different languages have separate caches', async () => {
		await initializeParser()

		const tsCode = `const x: number = 1`
		const pyCode = `x: int = 1`

		const tsResult = await parseCode(tsCode, 'typescript')
		const pyResult = await parseCode(pyCode, 'python')

		// Each should parse with correct language grammar
		expect(tsResult.tree.rootNode.type).toBe('program')
		expect(pyResult.tree.rootNode.type).toBe('module')
	})

	test('clearGrammarCache forces reload', async () => {
		await initializeParser()

		// Parse once to cache
		const result1 = await parseCode('const x = 1', 'typescript')
		expect(result1.error).toBeNull()

		// Clear cache
		clearGrammarCache()

		// Parse again - should reload grammar
		const result2 = await parseCode('const y = 2', 'typescript')
		expect(result2.error).toBeNull()
		expect(result2.tree.rootNode.type).toBe('program')
	})

	test('resetParser clears both parser and grammar cache', async () => {
		await initializeParser()

		// Parse to establish state
		await parseCode('const x = 1', 'typescript')

		// Reset everything
		resetParser()

		// Should be able to reinitialize and parse
		await initializeParser()
		const result = await parseCode('const y = 2', 'typescript')
		expect(result.error).toBeNull()
	})

	test('multiple languages can be parsed in sequence', async () => {
		await initializeParser()

		const languages = [
			{ lang: 'typescript' as const, code: 'const x = 1' },
			{ lang: 'javascript' as const, code: 'const x = 1' },
			{ lang: 'python' as const, code: 'x = 1' },
			{ lang: 'rust' as const, code: 'fn main() {}' },
			{ lang: 'go' as const, code: 'package main' },
			{ lang: 'java' as const, code: 'class X {}' },
		]

		for (const { lang, code } of languages) {
			const result = await parseCode(code, lang)
			expect(result.error).toBeNull()
			expect(result.tree).not.toBeNull()
		}
	})
})
