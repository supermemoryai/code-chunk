import { Effect } from 'effect'
import type { EntityType, Language, SyntaxNode } from '../types'

/**
 * Body delimiters by language - the character that marks the start of the body
 */
export const BODY_DELIMITERS: Record<Language, string> = {
	typescript: '{',
	javascript: '{',
	python: ':',
	rust: '{',
	go: '{',
	java: '{',
}

/**
 * Node types that represent identifiers/names by language
 * Order matters - first match wins
 */
const NAME_NODE_TYPES: readonly string[] = [
	'name',
	'identifier',
	'type_identifier',
	'property_identifier',
]

/**
 * Extract the name of an entity from its AST node
 *
 * @param node - The AST node representing the entity
 * @param _language - The programming language (unused but kept for consistency)
 * @returns The entity name, or null if not found
 */
export const extractName = (
	node: SyntaxNode,
	_language: Language,
): string | null => {
	// Try to find a named child that is an identifier
	for (const nameType of NAME_NODE_TYPES) {
		const nameNode = node.childForFieldName(nameType)
		if (nameNode) {
			return nameNode.text
		}
	}

	// Try to find any child with a name-like type
	for (const child of node.children) {
		if (NAME_NODE_TYPES.includes(child.type)) {
			return child.text
		}
	}

	// For some languages, try the first identifier child
	for (const child of node.children) {
		if (child.type === 'identifier' || child.type === 'type_identifier') {
			return child.text
		}
	}

	return null
}

/**
 * Find the position of the body delimiter in a signature
 *
 * This handles nested brackets/parens/generics to avoid matching
 * delimiters inside parameter lists or type annotations.
 */
const findBodyDelimiterPos = (text: string, delimiter: string): number => {
	// Handle nested brackets/parens before the body delimiter
	let parenDepth = 0
	let bracketDepth = 0
	let angleDepth = 0
	let inString = false
	let stringChar = ''

	for (let i = 0; i < text.length; i++) {
		const char = text[i]
		const prevChar = i > 0 ? text[i - 1] : ''

		// Track string literals to avoid matching inside them
		if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
			if (!inString) {
				inString = true
				stringChar = char
			} else if (char === stringChar) {
				inString = false
				stringChar = ''
			}
			continue
		}

		if (inString) continue

		// Track nested structures
		if (char === '(') {
			parenDepth++
		} else if (char === ')') {
			parenDepth--
		} else if (char === '[') {
			bracketDepth++
		} else if (char === ']') {
			bracketDepth--
		} else if (char === '<') {
			// Only count as generic bracket if followed by identifier or another <
			// This helps avoid matching comparison operators like <, <=, <<
			const nextChar = text[i + 1] ?? ''
			if (/[A-Za-z_<]/.test(nextChar) || nextChar === '>' || nextChar === ' ') {
				angleDepth++
			}
		} else if (char === '>' && angleDepth > 0) {
			// Only decrement if we're tracking angle brackets
			angleDepth--
		}

		// Only match delimiter at depth 0
		if (
			char === delimiter &&
			parenDepth === 0 &&
			bracketDepth === 0 &&
			angleDepth === 0
		) {
			return i
		}
	}

	return -1
}

/**
 * Node types that represent body/block structures
 */
const BODY_NODE_TYPES: readonly string[] = [
	'block',
	'statement_block',
	'class_body',
	'interface_body',
	'enum_body',
]

/**
 * Try to extract signature using AST body field
 * Look for 'body' or block-like child and extract everything before it
 * Returns null if body node not found
 */
const tryExtractSignatureFromBody = (
	node: SyntaxNode,
	code: string,
	language: Language,
): string | null => {
	// Find the body/block child node
	const bodyNode =
		node.childForFieldName('body') ||
		node.children.find((c) => BODY_NODE_TYPES.includes(c.type))

	if (!bodyNode) {
		return null
	}

	// Extract from node start to body start
	let signature = code.slice(node.startIndex, bodyNode.startIndex).trim()

	// For Python, remove trailing colon
	if (language === 'python' && signature.endsWith(':')) {
		signature = signature.slice(0, -1)
	}

	// For arrow functions, remove trailing =>
	if (signature.endsWith('=>')) {
		signature = signature.slice(0, -2).trim()
	}

	return cleanSignature(signature)
}

/**
 * Extract signature for function/method entities
 * Extract from start to opening brace '{' (or ':' for Python)
 */
const extractFunctionSignature = (
	node: SyntaxNode,
	language: Language,
	code: string,
): string => {
	// Try AST-based extraction first (more reliable for languages with complex type syntax)
	const astSignature = tryExtractSignatureFromBody(node, code, language)
	if (astSignature) {
		return astSignature
	}

	// Fallback to text-based extraction
	const nodeText = code.slice(node.startIndex, node.endIndex)
	const delimiter = BODY_DELIMITERS[language]
	const delimPos = findBodyDelimiterPos(nodeText, delimiter)

	if (delimPos === -1) {
		// No body delimiter found - might be a declaration without body
		// Return the full node text cleaned up
		return cleanSignature(nodeText)
	}

	// Extract up to (but not including) the body delimiter
	const signature = nodeText.slice(0, delimPos).trim()
	return cleanSignature(signature)
}

/**
 * Extract signature for class/interface entities
 * Extract the declaration line (up to opening brace or first line)
 */
const extractClassSignature = (
	node: SyntaxNode,
	language: Language,
	code: string,
): string => {
	// Try AST-based extraction first
	const astSignature = tryExtractSignatureFromBody(node, code, language)
	if (astSignature) {
		return astSignature
	}

	// Fallback to text-based extraction
	const nodeText = code.slice(node.startIndex, node.endIndex)
	const delimiter = BODY_DELIMITERS[language]
	const delimPos = findBodyDelimiterPos(nodeText, delimiter)

	if (delimPos === -1) {
		// No body - return first line or full text
		const firstNewline = nodeText.indexOf('\n')
		if (firstNewline !== -1) {
			return cleanSignature(nodeText.slice(0, firstNewline))
		}
		return cleanSignature(nodeText)
	}

	// Extract up to (but not including) the opening brace
	const signature = nodeText.slice(0, delimPos).trim()
	return cleanSignature(signature)
}

/**
 * Extract signature for type/enum entities
 * Extract until '=' or '{'
 */
const extractTypeSignature = (
	node: SyntaxNode,
	language: Language,
	code: string,
): string => {
	const nodeText = code.slice(node.startIndex, node.endIndex)

	// For type aliases, look for '=' first
	const equalsPos = nodeText.indexOf('=')
	const bracePos = findBodyDelimiterPos(nodeText, '{')
	const colonPos =
		language === 'python' ? findBodyDelimiterPos(nodeText, ':') : -1

	// Find the earliest delimiter
	let delimPos = -1
	if (equalsPos !== -1) delimPos = equalsPos
	if (bracePos !== -1 && (delimPos === -1 || bracePos < delimPos))
		delimPos = bracePos
	if (colonPos !== -1 && (delimPos === -1 || colonPos < delimPos))
		delimPos = colonPos

	if (delimPos === -1) {
		// No delimiter found - return first line or full text
		const firstNewline = nodeText.indexOf('\n')
		if (firstNewline !== -1) {
			return cleanSignature(nodeText.slice(0, firstNewline))
		}
		return cleanSignature(nodeText)
	}

	const signature = nodeText.slice(0, delimPos).trim()
	return cleanSignature(signature)
}

/**
 * Extract signature for import/export entities
 * Extract the full statement
 */
const extractImportExportSignature = (
	node: SyntaxNode,
	code: string,
): string => {
	const nodeText = code.slice(node.startIndex, node.endIndex)
	return cleanSignature(nodeText)
}

/**
 * Clean up a signature string:
 * - Collapse multiple whitespace to single space
 * - Normalize multi-line to single line
 * - Trim leading/trailing whitespace
 */
const cleanSignature = (signature: string): string => {
	return signature
		.replace(/[\r\n]+/g, ' ') // Replace newlines with space
		.replace(/\s+/g, ' ') // Collapse multiple whitespace
		.trim()
}

/**
 * Extract the signature of an entity from its AST node
 *
 * @param node - The AST node representing the entity
 * @param entityType - The type of entity
 * @param language - The programming language
 * @param code - The source code
 * @returns Effect yielding the signature string
 */
export const extractSignature = (
	node: SyntaxNode,
	entityType: EntityType,
	language: Language,
	code: string,
): Effect.Effect<string, never> => {
	return Effect.sync(() => {
		switch (entityType) {
			case 'function':
			case 'method':
				return extractFunctionSignature(node, language, code)

			case 'class':
			case 'interface':
				return extractClassSignature(node, language, code)

			case 'type':
			case 'enum':
				return extractTypeSignature(node, language, code)

			case 'import':
			case 'export':
				return extractImportExportSignature(node, code)

			default: {
				// Fallback: extract first line
				const nodeText = code.slice(node.startIndex, node.endIndex)
				const firstNewline = nodeText.indexOf('\n')
				if (firstNewline !== -1) {
					return cleanSignature(nodeText.slice(0, firstNewline))
				}
				return cleanSignature(nodeText)
			}
		}
	})
}

/**
 * Get the body delimiter for a language
 *
 * @param language - The programming language
 * @returns The character that marks the start of a body block
 */
export const getBodyDelimiter = (language: Language): string => {
	return BODY_DELIMITERS[language]
}

/**
 * Node types that represent import source/path by language
 */
const IMPORT_SOURCE_NODE_TYPES: readonly string[] = [
	'string',
	'string_literal',
	'interpreted_string_literal', // Go
	'source', // Some grammars use this field name
]

/**
 * Extract the import source path from an import AST node
 *
 * Works for all supported languages by looking at the AST structure:
 * - JS/TS: import { foo } from 'source' -> string child
 * - Python: from source import foo -> 'module_name' field or dotted_name
 * - Rust: use crate::module::item -> scoped_identifier or path
 * - Go: import "source" -> interpreted_string_literal
 * - Java: import package.Class -> scoped_identifier
 *
 * @param node - The import AST node
 * @param language - The programming language
 * @returns The import source path, or null if not found
 */
export const extractImportSource = (
	node: SyntaxNode,
	language: Language,
): string | null => {
	// Try the 'source' field first (common in many grammars)
	const sourceField = node.childForFieldName('source')
	if (sourceField) {
		return stripQuotes(sourceField.text)
	}

	// Language-specific extraction
	switch (language) {
		case 'typescript':
		case 'javascript': {
			// Look for string literal child (the 'from "..."' part)
			for (const child of node.children) {
				if (child.type === 'string') {
					return stripQuotes(child.text)
				}
			}
			break
		}

		case 'python': {
			// For 'from X import Y', look for module_name field or dotted_name
			const moduleNameField = node.childForFieldName('module_name')
			if (moduleNameField) {
				return moduleNameField.text
			}
			// For 'import X' style
			const nameField = node.childForFieldName('name')
			if (nameField) {
				return nameField.text
			}
			// Fallback: look for dotted_name
			for (const child of node.children) {
				if (child.type === 'dotted_name') {
					return child.text
				}
			}
			break
		}

		case 'rust': {
			// For 'use path::to::item', extract the path
			// Look for scoped_identifier, use_wildcard, use_list, or identifier
			const argumentField = node.childForFieldName('argument')
			if (argumentField) {
				// Get the path part (everything except the last segment if it's a use_list)
				return extractRustUsePath(argumentField)
			}
			// Fallback: look for children that could be paths
			for (const child of node.children) {
				if (
					child.type === 'scoped_identifier' ||
					child.type === 'identifier' ||
					child.type === 'use_wildcard'
				) {
					return extractRustUsePath(child)
				}
			}
			break
		}

		case 'go': {
			// For 'import "path"', look for import_spec or interpreted_string_literal
			for (const child of node.children) {
				// Single import: import "fmt" -> has import_spec child
				if (child.type === 'import_spec') {
					const pathNode = child.childForFieldName('path')
					if (pathNode) {
						return stripQuotes(pathNode.text)
					}
					// Fallback: look for string literal in import_spec
					for (const specChild of child.children) {
						if (specChild.type === 'interpreted_string_literal') {
							return stripQuotes(specChild.text)
						}
					}
				}
				// Direct string literal (some Go grammars)
				if (child.type === 'interpreted_string_literal') {
					return stripQuotes(child.text)
				}
				// For import blocks: import ( "fmt" "os" )
				if (child.type === 'import_spec_list') {
					for (const spec of child.children) {
						if (spec.type === 'import_spec') {
							const pathNode = spec.childForFieldName('path')
							if (pathNode) {
								return stripQuotes(pathNode.text)
							}
						}
					}
				}
			}
			break
		}

		case 'java': {
			// For 'import package.Class', look for scoped_identifier
			for (const child of node.children) {
				if (child.type === 'scoped_identifier') {
					return child.text
				}
			}
			break
		}
	}

	// Fallback: look for any string-like child
	for (const child of node.children) {
		if (IMPORT_SOURCE_NODE_TYPES.includes(child.type)) {
			return stripQuotes(child.text)
		}
	}

	return null
}

/**
 * Extract the path from a Rust use declaration
 * For 'std::collections::HashMap', returns 'std::collections::HashMap'
 * For 'std::collections::{HashMap, HashSet}', returns 'std::collections'
 */
const extractRustUsePath = (node: SyntaxNode): string => {
	// If it's a use_list (e.g., {HashMap, HashSet}), get the parent path
	if (node.type === 'use_list') {
		return ''
	}

	// For scoped_identifier, check if the last part is a use_list
	if (node.type === 'scoped_identifier') {
		const lastChild = node.children[node.children.length - 1]
		if (lastChild?.type === 'use_list') {
			// Return everything except the use_list
			const pathChild = node.childForFieldName('path')
			if (pathChild) {
				return pathChild.text
			}
		}
	}

	return node.text
}

/**
 * Strip surrounding quotes from a string
 */
const stripQuotes = (str: string): string => {
	if (
		(str.startsWith('"') && str.endsWith('"')) ||
		(str.startsWith("'") && str.endsWith("'")) ||
		(str.startsWith('`') && str.endsWith('`'))
	) {
		return str.slice(1, -1)
	}
	return str
}
