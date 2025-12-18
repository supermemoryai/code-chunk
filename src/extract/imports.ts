import type { ExtractedEntity, Language, SyntaxNode } from '../types'
import { extractImportSource } from './signature'

/**
 * Extract individual import symbols from an import statement
 * Returns an array of import entities, one per imported symbol
 *
 * @param importNode - The import statement AST node
 * @param language - The programming language
 * @param code - The source code
 * @returns Array of ExtractedEntity objects for each imported symbol
 */
export function extractImportSymbols(
	importNode: SyntaxNode,
	language: Language,
	code: string,
): ExtractedEntity[] {
	const source = extractImportSource(importNode, language) ?? ''
	const signature = code.slice(importNode.startIndex, importNode.endIndex)
	const entities: ExtractedEntity[] = []

	// Helper to create an import entity with common fields
	const makeImportEntity = (name: string): ExtractedEntity => ({
		type: 'import',
		name,
		signature,
		docstring: null,
		byteRange: {
			start: importNode.startIndex,
			end: importNode.endIndex,
		},
		lineRange: {
			start: importNode.startPosition.row,
			end: importNode.endPosition.row,
		},
		parent: null,
		node: importNode,
		source,
	})

	switch (language) {
		case 'typescript':
		case 'javascript': {
			// Handle: import { A, B } from '...', import Foo from '...', import * as Foo from '...'
			const importClause = importNode.namedChildren.find(
				(c) => c.type === 'import_clause',
			)
			if (importClause) {
				for (const child of importClause.namedChildren) {
					if (child.type === 'named_imports') {
						// Named imports: { A, B, C }
						for (const specifier of child.namedChildren) {
							if (specifier.type === 'import_specifier') {
								const nameNode =
									specifier.childForFieldName('alias') ??
									specifier.childForFieldName('name') ??
									specifier.namedChildren.find((c) => c.type === 'identifier')
								if (nameNode) {
									entities.push(makeImportEntity(nameNode.text))
								}
							}
						}
					} else if (child.type === 'identifier') {
						// Default import: import Foo from '...'
						entities.push(makeImportEntity(child.text))
					} else if (child.type === 'namespace_import') {
						// Namespace import: import * as Foo from '...'
						const aliasNode = child.namedChildren.find(
							(c) => c.type === 'identifier',
						)
						if (aliasNode) {
							entities.push(makeImportEntity(aliasNode.text))
						}
					}
				}
			}
			break
		}

		case 'python': {
			// Handle: from X import A, B or import X
			const names = importNode.namedChildren.filter(
				(c) =>
					c.type === 'dotted_name' ||
					c.type === 'aliased_import' ||
					c.type === 'identifier',
			)
			for (const nameNode of names) {
				const name =
					nameNode.type === 'aliased_import'
						? (nameNode.childForFieldName('alias')?.text ??
							nameNode.childForFieldName('name')?.text ??
							nameNode.text)
						: nameNode.text
				if (name) {
					entities.push(makeImportEntity(name))
				}
			}
			break
		}

		case 'rust': {
			// Handle: use crate::foo::{Bar, Baz} or use crate::foo::Bar
			const extractRustUseNames = (node: SyntaxNode): string[] => {
				const names: string[] = []
				if (node.type === 'identifier' || node.type === 'type_identifier') {
					names.push(node.text)
				} else if (node.type === 'use_list') {
					for (const child of node.namedChildren) {
						names.push(...extractRustUseNames(child))
					}
				} else if (
					node.type === 'scoped_identifier' ||
					node.type === 'scoped_use_list'
				) {
					// Get the last part (the actual imported name)
					const lastChild = node.namedChildren[node.namedChildren.length - 1]
					if (lastChild) {
						names.push(...extractRustUseNames(lastChild))
					}
				} else if (node.type === 'use_as_clause') {
					const alias = node.childForFieldName('alias')
					if (alias) {
						names.push(alias.text)
					}
				} else if (node.type === 'use_wildcard') {
					names.push('*')
				}
				return names
			}

			const argument = importNode.childForFieldName('argument')
			if (argument) {
				for (const name of extractRustUseNames(argument)) {
					entities.push(makeImportEntity(name))
				}
			}
			break
		}

		case 'go': {
			// Handle: import "fmt" or import ( "fmt" "os" )
			const extractGoImportNames = (node: SyntaxNode): string[] => {
				const names: string[] = []
				if (node.type === 'import_spec') {
					// Get alias if present, otherwise derive from path
					const alias = node.childForFieldName('name')
					const pathNode = node.childForFieldName('path')
					if (alias) {
						names.push(alias.text)
					} else if (pathNode) {
						// Use last path segment as name
						const pathText = pathNode.text.replace(/['"]/g, '')
						const segments = pathText.split('/')
						names.push(segments[segments.length - 1] ?? pathText)
					}
				} else if (node.type === 'import_spec_list') {
					for (const child of node.namedChildren) {
						names.push(...extractGoImportNames(child))
					}
				}
				return names
			}

			for (const child of importNode.namedChildren) {
				for (const name of extractGoImportNames(child)) {
					entities.push(makeImportEntity(name))
				}
			}
			break
		}

		case 'java': {
			// Handle: import package.Class or import package.*
			const scopedId = importNode.namedChildren.find(
				(c) => c.type === 'scoped_identifier',
			)
			if (scopedId) {
				// Get the last identifier (the class name)
				const parts = scopedId.text.split('.')
				const name = parts[parts.length - 1] ?? scopedId.text
				entities.push(makeImportEntity(name))
			}
			break
		}
	}

	// If no symbols were extracted, fall back to using source as name
	if (entities.length === 0) {
		entities.push(makeImportEntity(source || '<anonymous>'))
	}

	return entities
}
