import { Effect } from 'effect'
import {
	getEntitiesInRange,
	getRelevantImports,
	getScopeForRange,
} from '../context'
import { getSiblings } from '../context/siblings'
import type {
	ASTWindow,
	Chunk,
	ChunkContext,
	ChunkOptions,
	Language,
	ScopeTree,
	SyntaxNode,
} from '../types'
import { mergeAdjacentWindows } from './merge'
import { getNwsCountForNode, type NwsCumsum, preprocessNwsCumsum } from './nws'
import { isLeafNode } from './oversized'
import { type RebuiltText, rebuildText } from './rebuild'
import { getAncestors } from './windows'

/**
 * Error when chunking fails
 */
export class ChunkError extends Error {
	readonly _tag = 'ChunkError'
	override readonly cause?: unknown

	constructor(message: string, cause?: unknown) {
		super(message)
		this.name = 'ChunkError'
		this.cause = cause
	}
}

/**
 * Default chunk options
 */
export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
	maxChunkSize: 1500,
	contextMode: 'full',
	siblingDetail: 'signatures',
	filterImports: false,
	language: 'typescript',
}

/**
 * Greedy window assignment algorithm
 * Accumulates nodes until maxSize is reached, recursing into oversized nodes
 */
function* greedyAssignWindows(
	nodes: SyntaxNode[],
	code: string,
	cumsum: NwsCumsum,
	maxSize: number,
): Generator<ASTWindow> {
	let currentWindow: ASTWindow = {
		nodes: [],
		ancestors: [],
		size: 0,
		isPartialNode: false,
	}

	for (const node of nodes) {
		const nodeSize = getNwsCountForNode(node, cumsum)

		// Check if node fits in current window
		if (currentWindow.size + nodeSize <= maxSize) {
			currentWindow.nodes.push(node)
			currentWindow.size += nodeSize
		} else if (nodeSize > maxSize) {
			// Node is oversized - need to handle specially
			// First, yield current window if it has content
			if (currentWindow.nodes.length > 0) {
				currentWindow.ancestors = getAncestors(currentWindow.nodes)
				yield currentWindow
				currentWindow = {
					nodes: [],
					ancestors: [],
					size: 0,
					isPartialNode: false,
				}
			}

			// Try to subdivide the node if it has children
			if (!isLeafNode(node)) {
				// Recursively process children
				const children = []
				for (let i = 0; i < node.childCount; i++) {
					const child = node.child(i)
					if (child) {
						children.push(child)
					}
				}
				yield* greedyAssignWindows(children, code, cumsum, maxSize)
			} else {
				// Leaf node that's oversized - split at line boundaries
				const windows = splitOversizedLeafByLines(node, code, maxSize)
				yield* windows
			}
		} else {
			// Node doesn't fit but isn't oversized - start new window
			if (currentWindow.nodes.length > 0) {
				currentWindow.ancestors = getAncestors(currentWindow.nodes)
				yield currentWindow
			}
			currentWindow = {
				nodes: [node],
				ancestors: [],
				size: nodeSize,
				isPartialNode: false,
			}
		}
	}

	// Yield final window if it has content
	if (currentWindow.nodes.length > 0) {
		currentWindow.ancestors = getAncestors(currentWindow.nodes)
		yield currentWindow
	}
}

/**
 * Split an oversized leaf node at line boundaries
 */
function* splitOversizedLeafByLines(
	node: SyntaxNode,
	code: string,
	maxSize: number,
): Generator<ASTWindow> {
	const text = code.slice(node.startIndex, node.endIndex)
	const lines = text.split('\n')

	let currentChunk = ''
	let currentSize = 0
	const startByte = node.startIndex
	let chunkStartOffset = 0

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ''
		const lineNws = line.replace(/\s/g, '').length
		const lineWithNewline: string = i < lines.length - 1 ? `${line}\n` : line

		if (currentSize + lineNws <= maxSize) {
			currentChunk += lineWithNewline
			currentSize += lineNws
		} else {
			// Yield current chunk if it has content
			if (currentChunk.length > 0) {
				yield {
					nodes: [node],
					ancestors: getAncestors([node]),
					size: currentSize,
					isPartialNode: true,
					lineRanges: [
						{
							start:
								code.slice(0, startByte + chunkStartOffset).split('\n').length -
								1,
							end:
								code
									.slice(0, startByte + chunkStartOffset + currentChunk.length)
									.split('\n').length - 1,
						},
					],
				}
			}

			// Start new chunk
			chunkStartOffset += currentChunk.length
			currentChunk = lineWithNewline
			currentSize = lineNws
		}
	}

	// Yield final chunk
	if (currentChunk.length > 0) {
		yield {
			nodes: [node],
			ancestors: getAncestors([node]),
			size: currentSize,
			isPartialNode: true,
			lineRanges: [
				{
					start:
						code.slice(0, startByte + chunkStartOffset).split('\n').length - 1,
					end:
						code
							.slice(0, startByte + chunkStartOffset + currentChunk.length)
							.split('\n').length - 1,
				},
			],
		}
	}
}

/**
 * Build chunk context from scope tree
 *
 * @param text - The rebuilt text for the chunk
 * @param scopeTree - The scope tree
 * @param options - Chunking options
 * @param filepath - Optional file path of the source file
 * @param language - Optional programming language
 * @returns The chunk context including filepath and language if provided
 */
const buildContext = (
	text: RebuiltText,
	scopeTree: ScopeTree,
	options: Required<ChunkOptions>,
	filepath?: string,
	language?: Language,
): ChunkContext => {
	const byteRange = text.byteRange

	// Get entities within this chunk
	const entities = getEntitiesInRange(byteRange, scopeTree)

	// Get scope hierarchy
	const scope = getScopeForRange(byteRange, scopeTree)

	// Get siblings
	const siblings = getSiblings(byteRange, scopeTree, {
		detail: options.siblingDetail,
		maxSiblings: 3,
	})

	// Get relevant imports
	const imports = getRelevantImports(entities, scopeTree, options.filterImports)

	return {
		filepath,
		language,
		scope,
		entities,
		siblings,
		imports,
	}
}

/**
 * Chunk source code into pieces with context
 *
 * @param rootNode - The root AST node
 * @param code - The source code
 * @param scopeTree - The scope tree
 * @param language - The programming language
 * @param options - Chunking options
 * @param filepath - Optional file path of the source file
 * @returns Effect yielding chunks
 */
export const chunk = (
	rootNode: SyntaxNode,
	code: string,
	scopeTree: ScopeTree,
	language: Language,
	options: ChunkOptions = {},
	filepath?: string,
): Effect.Effect<Chunk[], ChunkError> => {
	return Effect.try({
		try: () => {
			// Merge options with defaults
			const opts: Required<ChunkOptions> = {
				...DEFAULT_CHUNK_OPTIONS,
				...options,
				language,
			}

			const maxSize = opts.maxChunkSize

			// Step 1: Preprocess NWS cumulative sum for O(1) range queries
			const cumsum = preprocessNwsCumsum(code)

			// Step 2: Get root's children for processing
			const children: SyntaxNode[] = []
			for (let i = 0; i < rootNode.childCount; i++) {
				const child = rootNode.child(i)
				if (child) {
					children.push(child)
				}
			}

			// Step 3: Assign nodes to windows using greedy algorithm
			const rawWindows = greedyAssignWindows(children, code, cumsum, maxSize)

			// Step 4: Merge adjacent windows
			const mergedWindows = mergeAdjacentWindows(rawWindows, { maxSize })

			// Step 5: Convert windows to chunks
			const windowArray = Array.from(mergedWindows)
			const totalChunks = windowArray.length

			const chunks: Chunk[] = windowArray.map((window, index) => {
				// Rebuild text from window
				const text = rebuildText(window, code)

				// Build context
				const context =
					opts.contextMode === 'none'
						? { scope: [], entities: [], siblings: [], imports: [] }
						: buildContext(text, scopeTree, opts, filepath, language)

				return {
					text: text.text,
					byteRange: text.byteRange,
					lineRange: text.lineRange,
					context,
					index,
					totalChunks,
				}
			})

			return chunks
		},
		catch: (error: unknown) => new ChunkError('Failed to chunk code', error),
	})
}

/**
 * Stream chunks as they are generated
 *
 * @param rootNode - The root AST node
 * @param code - The source code
 * @param scopeTree - The scope tree
 * @param language - The programming language
 * @param options - Chunking options
 * @param filepath - Optional file path of the source file
 * @returns Async generator of chunks
 */
export async function* streamChunks(
	rootNode: SyntaxNode,
	code: string,
	scopeTree: ScopeTree,
	language: Language,
	options: ChunkOptions = {},
	filepath?: string,
): AsyncGenerator<Chunk> {
	// Merge options with defaults
	const opts: Required<ChunkOptions> = {
		...DEFAULT_CHUNK_OPTIONS,
		...options,
		language,
	}

	const maxSize = opts.maxChunkSize

	// Preprocess NWS cumulative sum for O(1) range queries
	const cumsum = preprocessNwsCumsum(code)

	// Get root's children
	const children: SyntaxNode[] = []
	for (let i = 0; i < rootNode.childCount; i++) {
		const child = rootNode.child(i)
		if (child) {
			children.push(child)
		}
	}

	// Assign nodes to windows
	const rawWindows = greedyAssignWindows(children, code, cumsum, maxSize)

	// Merge adjacent windows
	const mergedWindows = mergeAdjacentWindows(rawWindows, { maxSize })

	// Stream chunks as they are generated
	// totalChunks is -1 since we don't know the total count while streaming
	let index = 0
	for (const window of mergedWindows) {
		// Rebuild text from window
		const text = rebuildText(window, code)

		// Build context
		const context =
			opts.contextMode === 'none'
				? { scope: [], entities: [], siblings: [], imports: [] }
				: buildContext(text, scopeTree, opts, filepath, language)

		yield {
			text: text.text,
			byteRange: text.byteRange,
			lineRange: text.lineRange,
			context,
			index,
			totalChunks: -1, // Unknown during streaming
		}
		index++
	}
}
