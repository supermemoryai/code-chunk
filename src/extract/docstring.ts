import { Effect } from 'effect'
import type { Language, SyntaxNode } from '../types'

/**
 * Comment node types by language
 */
export const COMMENT_NODE_TYPES: Record<Language, readonly string[]> = {
	typescript: ['comment', 'multiline_comment'],
	javascript: ['comment', 'multiline_comment'],
	python: ['comment', 'string'], // Python uses string literals as docstrings
	rust: ['line_comment', 'block_comment'],
	go: ['comment'],
	java: ['line_comment', 'block_comment'],
}

/**
 * Python docstring node types (triple-quoted strings)
 */
const PYTHON_STRING_TYPES: readonly string[] = ['string', 'string_content']

/**
 * Check if a comment is a documentation comment (JSDoc, docstring, etc.)
 *
 * @param commentText - The raw comment text
 * @param language - The programming language
 * @returns Whether the comment is a documentation comment
 */
export const isDocComment = (
	commentText: string,
	language: Language,
): boolean => {
	const trimmed = commentText.trim()

	switch (language) {
		case 'typescript':
		case 'javascript':
		case 'java':
			// JSDoc/Javadoc: starts with /** (but not /***+)
			return /^\/\*\*[^*]/.test(trimmed) || trimmed === '/**/'

		case 'python':
			// Python docstrings: triple quotes
			return (
				trimmed.startsWith('"""') ||
				trimmed.startsWith("'''") ||
				trimmed.startsWith('r"""') ||
				trimmed.startsWith("r'''")
			)

		case 'rust':
			// Rust doc comments: /// (outer) or //! (inner)
			return trimmed.startsWith('///') || trimmed.startsWith('//!')

		case 'go':
			// Go: any // comment immediately before a declaration is considered doc
			return trimmed.startsWith('//')

		default:
			return false
	}
}

/**
 * Parse and clean up a docstring, removing comment markers and normalizing whitespace
 *
 * @param text - The raw docstring text
 * @param language - The programming language
 * @returns The cleaned docstring text
 */
export const parseDocstring = (text: string, language: Language): string => {
	switch (language) {
		case 'typescript':
		case 'javascript':
		case 'java':
			return parseJSDocStyle(text)

		case 'python':
			return parsePythonDocstring(text)

		case 'rust':
			return parseRustDocComment(text)

		case 'go':
			return parseGoComment(text)

		default:
			return text.trim()
	}
}

/**
 * Parse JSDoc/Javadoc style comments
 * Handles: /** ... *\/
 */
function parseJSDocStyle(text: string): string {
	let content = text.trim()

	// Remove opening /** and closing */
	if (content.startsWith('/**')) {
		content = content.slice(3)
	}
	if (content.endsWith('*/')) {
		content = content.slice(0, -2)
	}

	// Split into lines and process each
	const lines = content.split('\n')
	const processedLines = lines.map((line) => {
		let processed = line.trim()
		// Remove leading * from each line (common JSDoc style)
		if (processed.startsWith('*')) {
			processed = processed.slice(1)
			// Remove one space after * if present
			if (processed.startsWith(' ')) {
				processed = processed.slice(1)
			}
		}
		return processed
	})

	// Remove empty lines at start and end
	while (processedLines.length > 0 && processedLines[0] === '') {
		processedLines.shift()
	}
	while (
		processedLines.length > 0 &&
		processedLines[processedLines.length - 1] === ''
	) {
		processedLines.pop()
	}

	return processedLines.join('\n')
}

/**
 * Parse Python docstrings (triple-quoted strings)
 * Handles: ''' ... ''' and """ ... """
 */
function parsePythonDocstring(text: string): string {
	let content = text.trim()

	// Handle raw strings
	if (content.startsWith('r"""') || content.startsWith("r'''")) {
		content = content.slice(1)
	}

	// Remove opening and closing quotes
	if (content.startsWith('"""')) {
		content = content.slice(3)
		if (content.endsWith('"""')) {
			content = content.slice(0, -3)
		}
	} else if (content.startsWith("'''")) {
		content = content.slice(3)
		if (content.endsWith("'''")) {
			content = content.slice(0, -3)
		}
	}

	// Split into lines
	const lines = content.split('\n')

	// Find minimum indentation (excluding empty lines)
	let minIndent = Number.POSITIVE_INFINITY
	for (const line of lines) {
		if (line.trim().length > 0) {
			const leadingSpaces = line.match(/^(\s*)/)?.[1]?.length ?? 0
			minIndent = Math.min(minIndent, leadingSpaces)
		}
	}

	if (minIndent === Number.POSITIVE_INFINITY) {
		minIndent = 0
	}

	// Remove common indentation
	const dedentedLines = lines.map((line) => {
		if (line.trim().length === 0) {
			return ''
		}
		return line.slice(minIndent)
	})

	// Remove empty lines at start and end
	while (dedentedLines.length > 0 && dedentedLines[0]?.trim() === '') {
		dedentedLines.shift()
	}
	while (
		dedentedLines.length > 0 &&
		dedentedLines[dedentedLines.length - 1]?.trim() === ''
	) {
		dedentedLines.pop()
	}

	return dedentedLines.join('\n')
}

/**
 * Parse Rust doc comments
 * Handles: /// and //!
 */
function parseRustDocComment(text: string): string {
	const lines = text.split('\n')
	const processedLines: string[] = []

	for (const line of lines) {
		const trimmed = line.trim()
		let content = trimmed

		// Remove /// or //! prefix
		if (trimmed.startsWith('///')) {
			content = trimmed.slice(3)
		} else if (trimmed.startsWith('//!')) {
			content = trimmed.slice(3)
		}

		// Remove one leading space if present
		if (content.startsWith(' ')) {
			content = content.slice(1)
		}

		processedLines.push(content)
	}

	// Remove empty lines at start and end
	while (processedLines.length > 0 && processedLines[0] === '') {
		processedLines.shift()
	}
	while (
		processedLines.length > 0 &&
		processedLines[processedLines.length - 1] === ''
	) {
		processedLines.pop()
	}

	return processedLines.join('\n')
}

/**
 * Parse Go comments
 * Handles: // style comments
 */
function parseGoComment(text: string): string {
	const lines = text.split('\n')
	const processedLines: string[] = []

	for (const line of lines) {
		const trimmed = line.trim()
		let content = trimmed

		// Remove // prefix
		if (trimmed.startsWith('//')) {
			content = trimmed.slice(2)
		}

		// Remove one leading space if present
		if (content.startsWith(' ')) {
			content = content.slice(1)
		}

		processedLines.push(content)
	}

	// Remove empty lines at start and end
	while (processedLines.length > 0 && processedLines[0] === '') {
		processedLines.shift()
	}
	while (
		processedLines.length > 0 &&
		processedLines[processedLines.length - 1] === ''
	) {
		processedLines.pop()
	}

	return processedLines.join('\n')
}

/**
 * Get the text content of a node
 */
function getNodeText(node: SyntaxNode, code: string): string {
	return code.slice(node.startIndex, node.endIndex)
}

/**
 * Find preceding comment nodes (handles consecutive comment lines)
 */
function findPrecedingComments(
	node: SyntaxNode,
	language: Language,
	code: string,
): string | null {
	const commentTypes = COMMENT_NODE_TYPES[language]
	const comments: string[] = []
	let current = node.previousNamedSibling

	// Walk backwards collecting consecutive comment nodes
	while (current) {
		const nodeType = current.type

		if (commentTypes.includes(nodeType)) {
			const text = getNodeText(current, code)

			// For Python, only consider string literals that are docstrings (but they come after, not before)
			// For Python comments that precede, they're not docstrings
			if (language === 'python' && PYTHON_STRING_TYPES.includes(nodeType)) {
				break
			}

			if (isDocComment(text, language)) {
				comments.unshift(text) // Add to front since we're going backwards
				current = current.previousNamedSibling
			} else {
				break
			}
		} else {
			// Check if there's a comment between the current named sibling and our node
			// by looking at the previous sibling (including non-named)
			break
		}
	}

	if (comments.length === 0) {
		return null
	}

	// Combine consecutive comments (for Rust /// style)
	const combinedText = comments.join('\n')
	return parseDocstring(combinedText, language)
}

/**
 * Find Python docstring (first string literal in function/class body)
 */
function findPythonDocstring(node: SyntaxNode, code: string): string | null {
	// Look for a block/body child
	const bodyNode =
		node.childForFieldName('body') ??
		node.namedChildren.find((c) => c.type === 'block')

	if (!bodyNode) {
		return null
	}

	// Get the first statement in the body
	const firstChild = bodyNode.namedChildren[0]

	if (!firstChild) {
		return null
	}

	// Check if it's an expression statement containing a string
	if (firstChild.type === 'expression_statement') {
		const stringNode = firstChild.namedChildren[0]
		if (stringNode && PYTHON_STRING_TYPES.includes(stringNode.type)) {
			const text = getNodeText(stringNode, code)
			if (isDocComment(text, 'python')) {
				return parseDocstring(text, 'python')
			}
		}
	}

	// Direct string literal (shouldn't happen in valid Python, but handle it)
	if (PYTHON_STRING_TYPES.includes(firstChild.type)) {
		const text = getNodeText(firstChild, code)
		if (isDocComment(text, 'python')) {
			return parseDocstring(text, 'python')
		}
	}

	return null
}

/**
 * Extract the docstring/documentation comment for an entity
 *
 * @param node - The AST node representing the entity
 * @param language - The programming language
 * @param code - The source code
 * @returns Effect yielding the docstring, or null if none found
 *
 * Handles:
 * - JSDoc (/** ... *\/) for TypeScript/JavaScript
 * - Python docstrings (triple-quoted string as first statement in body)
 * - Rust doc comments (/// and //!)
 * - Go comments (// before declaration)
 * - Java Javadoc (/** ... *\/)
 */
export const extractDocstring = (
	node: SyntaxNode,
	language: Language,
	code: string,
): Effect.Effect<string | null, never> => {
	return Effect.sync(() => {
		// For Python, first check for docstring inside the body
		if (language === 'python') {
			const docstring = findPythonDocstring(node, code)
			if (docstring) {
				return docstring
			}
		}

		// Look for preceding comments
		return findPrecedingComments(node, language, code)
	})
}
