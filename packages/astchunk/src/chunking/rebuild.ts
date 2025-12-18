import type { ASTWindow, ByteRange, LineRange } from '../types'

/**
 * Result of rebuilding text from an AST window
 */
export interface RebuiltText {
	/** The rebuilt text content */
	text: string
	/** Byte range in the original source */
	byteRange: ByteRange
	/** Line range in the original source */
	lineRange: LineRange
}

/**
 * Build a lookup table for line start offsets
 * This allows O(1) line number lookups from byte offsets
 *
 * @param code - The source code
 * @returns Array where lineStarts[i] is the byte offset of line i
 */
const buildLineStartsTable = (code: string): number[] => {
	const lineStarts: number[] = [0] // Line 0 starts at byte 0
	for (let i = 0; i < code.length; i++) {
		if (code[i] === '\n') {
			lineStarts.push(i + 1)
		}
	}
	return lineStarts
}

/**
 * Rebuild source text from an AST window
 *
 * Handles both normal windows (slice from first node start to last node end)
 * and partial node windows (rebuild from line ranges).
 *
 * @param window - The AST window
 * @param code - The original source code
 * @returns The rebuilt text with range information
 */
export const rebuildText = (window: ASTWindow, code: string): RebuiltText => {
	// Handle empty windows
	if (window.nodes.length === 0) {
		return {
			text: '',
			byteRange: { start: 0, end: 0 },
			lineRange: { start: 0, end: 0 },
		}
	}

	// Handle partial node windows with line ranges
	if (
		window.isPartialNode &&
		window.lineRanges &&
		window.lineRanges.length > 0
	) {
		return rebuildFromLineRanges(window, code)
	}

	// Normal case: slice from first node start to last node end
	// Use startPosition/endPosition from nodes for optimized line calculation
	const firstNode = window.nodes[0]
	const lastNode = window.nodes[window.nodes.length - 1]
	if (!firstNode || !lastNode) {
		return {
			text: '',
			byteRange: { start: 0, end: 0 },
			lineRange: { start: 0, end: 0 },
		}
	}

	const startByte = firstNode.startIndex
	const endByte = lastNode.endIndex
	const text = code.slice(startByte, endByte)

	// Use node positions directly for line numbers (0-indexed)
	const startLine = firstNode.startPosition.row
	const endLine = lastNode.endPosition.row

	return {
		text,
		byteRange: { start: startByte, end: endByte },
		lineRange: { start: startLine, end: endLine },
	}
}

/**
 * Rebuild text from line ranges for partial nodes
 *
 * @param window - The AST window with partial node
 * @param code - The original source code
 * @returns The rebuilt text with range information
 */
const rebuildFromLineRanges = (
	window: ASTWindow,
	code: string,
): RebuiltText => {
	const lineRanges = window.lineRanges
	if (!lineRanges || lineRanges.length === 0) {
		return {
			text: '',
			byteRange: { start: 0, end: 0 },
			lineRange: { start: 0, end: 0 },
		}
	}
	const lineStarts = buildLineStartsTable(code)

	// Get the overall line range
	const firstRange = lineRanges[0]
	const lastRange = lineRanges[lineRanges.length - 1]
	if (!firstRange || !lastRange) {
		return {
			text: '',
			byteRange: { start: 0, end: 0 },
			lineRange: { start: 0, end: 0 },
		}
	}
	const startLine = firstRange.start
	const endLine = lastRange.end

	// Calculate byte offsets from line numbers
	const startByte = lineStarts[startLine] ?? 0
	// End byte is start of line after endLine, or end of file
	const endByte =
		endLine + 1 < lineStarts.length
			? (lineStarts[endLine + 1] ?? code.length)
			: code.length

	const text = code.slice(startByte, endByte)

	return {
		text,
		byteRange: { start: startByte, end: endByte },
		lineRange: { start: startLine, end: endLine },
	}
}
