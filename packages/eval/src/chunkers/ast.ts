/**
 * AST-aware chunker wrapper for evaluation
 *
 * Wraps the astchunk library for use in the evaluation harness.
 * Uses the built-in contextualizedText for better embedding quality.
 */

import { chunk } from '@supermemory/astchunk'

/**
 * Chunk a file using AST-aware chunking and return results
 * in a format compatible with the evaluation
 *
 * @param filepath - Path to the file
 * @param code - Source code content
 * @param maxNws - Maximum NWS characters per chunk (default: 1500)
 */
export async function chunkFile(
	filepath: string,
	code: string,
	maxNws: number = 1500,
): Promise<
	Array<{
		id: string
		text: string
		startLine: number
		endLine: number
	}>
> {
	const chunks = await chunk(filepath, code, {
		maxChunkSize: maxNws,
	})

	return chunks.map((c) => ({
		id: `${filepath}:${c.lineRange.start}-${c.lineRange.end}`,
		text: c.contextualizedText,
		startLine: c.lineRange.start,
		endLine: c.lineRange.end,
	}))
}
