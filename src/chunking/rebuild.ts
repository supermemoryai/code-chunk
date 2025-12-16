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
 * Rebuild source text from an AST window
 *
 * @param window - The AST window
 * @param code - The original source code
 * @returns The rebuilt text with range information
 *
 * TODO: Implement text rebuilding
 */
export const rebuildText = (window: ASTWindow, code: string): RebuiltText => {
	// TODO: Implement text rebuilding
	// 1. Get byte range from window nodes
	// 2. Extract text from code
	// 3. Compute line range

	// For now, compute range from nodes
	if (window.nodes.length === 0) {
		return {
			text: '',
			byteRange: { start: 0, end: 0 },
			lineRange: { start: 0, end: 0 },
		}
	}

	const startByte = Math.min(...window.nodes.map((n) => n.startIndex))
	const endByte = Math.max(...window.nodes.map((n) => n.endIndex))
	const text = code.slice(startByte, endByte)

	// Compute line range
	const startLine = code.slice(0, startByte).split('\n').length - 1
	const endLine = startLine + text.split('\n').length - 1

	return {
		text,
		byteRange: { start: startByte, end: endByte },
		lineRange: { start: startLine, end: endLine },
	}
}

/**
 * Rebuild text for a partial node (oversized that was split)
 *
 * @param window - The AST window with partial node
 * @param code - The original source code
 * @param startOffset - The start offset within the node
 * @param endOffset - The end offset within the node
 * @returns The rebuilt text with range information
 *
 * TODO: Implement partial text rebuilding
 */
export const rebuildPartialText = (
	window: ASTWindow,
	code: string,
	startOffset: number,
	endOffset: number,
): RebuiltText => {
	// TODO: Implement partial text rebuilding
	void window
	const text = code.slice(startOffset, endOffset)

	// Compute line range
	const startLine = code.slice(0, startOffset).split('\n').length - 1
	const endLine = startLine + text.split('\n').length - 1

	return {
		text,
		byteRange: { start: startOffset, end: endOffset },
		lineRange: { start: startLine, end: endLine },
	}
}
