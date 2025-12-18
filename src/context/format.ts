/**
 * Format chunks with semantic context for embedding
 *
 * Prepends scope chain, entity signatures, and import context
 * to improve embedding similarity for semantic search.
 */

import type { ChunkContext } from '../types'

/**
 * Format chunk text with semantic context prepended
 *
 * Creates a contextualized version of the chunk text that includes:
 * - File path (last 3 segments)
 * - Scope chain (e.g., "MyClass > process")
 * - Entity signatures defined in this chunk
 * - Import dependencies
 * - Sibling context for continuity
 *
 * This format is optimized for embedding models to capture
 * semantic relationships between code chunks.
 *
 * @param text - The raw chunk text
 * @param context - The chunk's semantic context
 * @returns Formatted text with context prepended
 */
export function formatChunkWithContext(
	text: string,
	context: ChunkContext,
): string {
	const parts: string[] = []

	// Add file path for context (last 3 segments)
	if (context.filepath) {
		const relPath = context.filepath.split('/').slice(-3).join('/')
		parts.push(`# ${relPath}`)
	}

	// Add scope chain (e.g., "Scope: MyClass > process")
	if (context.scope.length > 0) {
		const scopePath = context.scope
			.map((s) => s.name)
			.reverse()
			.join(' > ')
		parts.push(`# Scope: ${scopePath}`)
	}

	// Add entity signatures in this chunk
	const signatures = context.entities
		.filter((e) => e.signature && e.type !== 'import')
		.map((e) => e.signature)
	if (signatures.length > 0) {
		parts.push(`# Defines: ${signatures.join(', ')}`)
	}

	// Add imports context (what this code depends on)
	if (context.imports.length > 0) {
		const importNames = context.imports
			.slice(0, 10) // Limit to avoid noise
			.map((i) => i.name)
			.join(', ')
		parts.push(`# Uses: ${importNames}`)
	}

	// Add sibling context for continuity
	const beforeSiblings = context.siblings
		.filter((s) => s.position === 'before')
		.map((s) => s.name)
	const afterSiblings = context.siblings
		.filter((s) => s.position === 'after')
		.map((s) => s.name)

	if (beforeSiblings.length > 0) {
		parts.push(`# After: ${beforeSiblings.join(', ')}`)
	}
	if (afterSiblings.length > 0) {
		parts.push(`# Before: ${afterSiblings.join(', ')}`)
	}

	// Add separator and actual code
	if (parts.length > 0) {
		parts.push('')
	}
	parts.push(text)

	return parts.join('\n')
}
