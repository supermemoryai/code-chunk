import type { ASTWindow, SyntaxNode } from '../types'
import { getNwsCountFromCumsum, type NwsCumsum } from './nws'

/**
 * Options for splitting oversized nodes
 */
export interface SplitOptions {
	/** Maximum size of a chunk in NWS characters */
	maxSize: number
	/** The precomputed NWS cumulative sum array */
	cumsum: NwsCumsum
	/** The source code */
	code: string
	/** Ancestor nodes for context */
	ancestors?: SyntaxNode[]
}

/**
 * Line boundary information within a node
 */
interface LineBoundary {
	/** Start byte offset of the line */
	start: number
	/** End byte offset of the line (exclusive) */
	end: number
	/** 0-indexed line number */
	lineNumber: number
}

/**
 * Get line boundaries within a node's byte range
 *
 * @param node - The AST node
 * @param code - The source code
 * @returns Array of line boundaries within the node
 */
export const getLineRangesInNode = (
	node: SyntaxNode,
	code: string,
): LineBoundary[] => {
	const lines: LineBoundary[] = []
	const nodeStart = node.startIndex
	const nodeEnd = node.endIndex
	const startLine = node.startPosition.row

	let lineStart = nodeStart
	let currentLine = startLine

	for (let i = nodeStart; i < nodeEnd; i++) {
		if (code[i] === '\n') {
			// End of current line (exclusive of newline)
			lines.push({
				start: lineStart,
				end: i + 1, // Include the newline character
				lineNumber: currentLine,
			})
			lineStart = i + 1
			currentLine++
		}
	}

	// Handle the last line (may not end with newline)
	if (lineStart < nodeEnd) {
		lines.push({
			start: lineStart,
			end: nodeEnd,
			lineNumber: currentLine,
		})
	}

	return lines
}

/**
 * Split an oversized leaf node into multiple windows at line boundaries
 *
 * Used when a node is too large to fit in a single window and cannot
 * be subdivided further (e.g., a very long string literal or comment).
 *
 * @param node - The oversized node
 * @param code - The source code
 * @param cumsum - The precomputed NWS cumulative sum array
 * @param maxSize - Maximum size in NWS characters
 * @param ancestors - Ancestor nodes for context
 * @returns Array of ASTWindow objects representing the split
 */
export const splitOversizedLeaf = (
	node: SyntaxNode,
	code: string,
	cumsum: NwsCumsum,
	maxSize: number,
	ancestors: SyntaxNode[] = [],
): ASTWindow[] => {
	const windows: ASTWindow[] = []
	const lineBoundaries = getLineRangesInNode(node, code)

	// If no lines or single line that still exceeds, return as single partial window
	if (lineBoundaries.length === 0) {
		return [
			{
				nodes: [node],
				ancestors,
				size: getNwsCountFromCumsum(cumsum, node.startIndex, node.endIndex),
				isPartialNode: true,
				lineRanges: [
					{
						start: node.startPosition.row,
						end: node.endPosition.row,
					},
				],
			},
		]
	}

	let currentChunkStart = 0 // Index into lineBoundaries
	let currentSize = 0

	for (let i = 0; i < lineBoundaries.length; i++) {
		const line = lineBoundaries[i]
		if (!line) continue

		const lineNws = getNwsCountFromCumsum(cumsum, line.start, line.end)

		// If single line exceeds maxSize, it becomes its own chunk
		if (lineNws > maxSize) {
			// Flush current accumulated lines first
			if (i > currentChunkStart) {
				const startLine = lineBoundaries[currentChunkStart]
				const endLine = lineBoundaries[i - 1]
				if (startLine && endLine) {
					windows.push({
						nodes: [node],
						ancestors,
						size: currentSize,
						isPartialNode: true,
						lineRanges: [
							{
								start: startLine.lineNumber,
								end: endLine.lineNumber,
							},
						],
					})
				}
			}

			// Add the oversized line as its own chunk
			windows.push({
				nodes: [node],
				ancestors,
				size: lineNws,
				isPartialNode: true,
				lineRanges: [
					{
						start: line.lineNumber,
						end: line.lineNumber,
					},
				],
			})

			currentChunkStart = i + 1
			currentSize = 0
			continue
		}

		// Check if adding this line would exceed maxSize
		if (currentSize + lineNws > maxSize && i > currentChunkStart) {
			// Flush current chunk
			const startLine = lineBoundaries[currentChunkStart]
			const endLine = lineBoundaries[i - 1]
			if (startLine && endLine) {
				windows.push({
					nodes: [node],
					ancestors,
					size: currentSize,
					isPartialNode: true,
					lineRanges: [
						{
							start: startLine.lineNumber,
							end: endLine.lineNumber,
						},
					],
				})
			}

			currentChunkStart = i
			currentSize = lineNws
		} else {
			currentSize += lineNws
		}
	}

	// Flush remaining lines
	if (currentChunkStart < lineBoundaries.length) {
		const startLine = lineBoundaries[currentChunkStart]
		const endLine = lineBoundaries[lineBoundaries.length - 1]
		if (startLine && endLine) {
			windows.push({
				nodes: [node],
				ancestors,
				size: currentSize,
				isPartialNode: true,
				lineRanges: [
					{
						start: startLine.lineNumber,
						end: endLine.lineNumber,
					},
				],
			})
		}
	}

	return windows
}

/**
 * Check if a node is oversized using cumulative sum
 *
 * @param node - The node to check
 * @param cumsum - Precomputed NWS cumulative sum array
 * @param maxSize - Maximum allowed size
 * @returns Whether the node exceeds maxSize
 */
export const isOversizedWithCumsum = (
	node: SyntaxNode,
	cumsum: NwsCumsum,
	maxSize: number,
): boolean => {
	const nodeSize = getNwsCountFromCumsum(cumsum, node.startIndex, node.endIndex)
	return nodeSize > maxSize
}

/**
 * Check if a node is a leaf (has no children)
 *
 * @param node - The node to check
 * @returns Whether the node is a leaf
 */
export const isLeafNode = (node: SyntaxNode): boolean => {
	return node.childCount === 0
}

/**
 * Recursively subdivide a node into windows that fit within maxSize
 *
 * Strategy:
 * - If node fits in maxSize, yield single window
 * - If node has children, recursively process children
 * - If leaf node is oversized, use splitOversizedLeaf
 *
 * @param node - The node to subdivide
 * @param code - The source code
 * @param cumsum - Precomputed NWS cumulative sum array
 * @param maxSize - Maximum size in NWS characters
 * @param ancestors - Ancestor nodes for context
 * @yields ASTWindow objects
 */
export function* subdivideNode(
	node: SyntaxNode,
	code: string,
	cumsum: NwsCumsum,
	maxSize: number,
	ancestors: SyntaxNode[] = [],
): Generator<ASTWindow> {
	const nodeSize = getNwsCountFromCumsum(cumsum, node.startIndex, node.endIndex)

	// If node fits within maxSize, yield single window
	if (nodeSize <= maxSize) {
		yield {
			nodes: [node],
			ancestors,
			size: nodeSize,
			isPartialNode: false,
		}
		return
	}

	// If node has children, recursively process them
	if (node.childCount > 0) {
		const newAncestors = [...ancestors, node]

		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i)
			if (child) {
				yield* subdivideNode(child, code, cumsum, maxSize, newAncestors)
			}
		}
		return
	}

	// Leaf node is oversized - split at line boundaries
	const windows = splitOversizedLeaf(node, code, cumsum, maxSize, ancestors)
	yield* windows
}
