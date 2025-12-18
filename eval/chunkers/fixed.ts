/**
 * Fixed-size baseline chunker
 *
 * Chunks code by non-whitespace character count, splitting at line boundaries.
 * This is the baseline to compare against AST-aware chunking.
 */

export interface FixedChunk {
	text: string
	startLine: number
	endLine: number
	nwsCount: number
}

/**
 * Count non-whitespace characters in a string
 */
function countNws(text: string): number {
	let count = 0
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) > 32) {
			count++
		}
	}
	return count
}

/**
 * Chunk code using fixed-size windows based on NWS character count.
 * Splits at line boundaries to avoid breaking mid-line.
 *
 * @param code - Source code to chunk
 * @param maxNws - Maximum non-whitespace characters per chunk (default: 1500)
 * @returns Array of chunks
 */
export function chunkFixed(code: string, maxNws: number = 1500): FixedChunk[] {
	const lines = code.split('\n')
	const chunks: FixedChunk[] = []

	let currentLines: string[] = []
	let currentNws = 0
	let startLine = 0

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const lineNws = countNws(line)

		// If adding this line would exceed budget, finalize current chunk
		if (currentNws + lineNws > maxNws && currentLines.length > 0) {
			chunks.push({
				text: currentLines.join('\n'),
				startLine,
				endLine: i - 1,
				nwsCount: currentNws,
			})

			currentLines = []
			currentNws = 0
			startLine = i
		}

		currentLines.push(line)
		currentNws += lineNws
	}

	// Don't forget the last chunk
	if (currentLines.length > 0) {
		chunks.push({
			text: currentLines.join('\n'),
			startLine,
			endLine: lines.length - 1,
			nwsCount: currentNws,
		})
	}

	return chunks
}

/**
 * Chunk a file and return results in a format compatible with the evaluation
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
	const chunks = chunkFixed(code, maxNws)

	return chunks.map((chunk) => ({
		id: `${filepath}:${chunk.startLine}-${chunk.endLine}`,
		text: chunk.text,
		startLine: chunk.startLine,
		endLine: chunk.endLine,
	}))
}
