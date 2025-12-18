/**
 * Fixed-size chunker for evaluation baseline
 *
 * Simple line-based chunker that splits code into fixed-size chunks
 * based on non-whitespace character count. Used as a baseline comparison
 * for the AST-aware chunker.
 */

/**
 * Count non-whitespace characters in a string
 */
function countNws(text: string): number {
	let count = 0
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) > 32) count++
	}
	return count
}

/**
 * Chunk a file using fixed-size chunking based on NWS character count
 *
 * @param filepath - Path to the file (used for chunk IDs)
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
	const lines = code.split('\n')
	const chunks: Array<{
		id: string
		text: string
		startLine: number
		endLine: number
	}> = []

	let currentLines: string[] = []
	let currentNws = 0
	let startLine = 0

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ''
		const lineNws = countNws(line)

		if (currentNws + lineNws > maxNws && currentLines.length > 0) {
			// Flush current chunk
			const text = currentLines.join('\n')
			const endLine = startLine + currentLines.length - 1
			chunks.push({
				id: `${filepath}:${startLine}-${endLine}`,
				text,
				startLine,
				endLine,
			})

			// Start new chunk
			currentLines = [line]
			currentNws = lineNws
			startLine = i
		} else {
			currentLines.push(line)
			currentNws += lineNws
		}
	}

	// Flush remaining lines
	if (currentLines.length > 0) {
		const text = currentLines.join('\n')
		const endLine = startLine + currentLines.length - 1
		chunks.push({
			id: `${filepath}:${startLine}-${endLine}`,
			text,
			startLine,
			endLine,
		})
	}

	return chunks
}
