import {
	getEntitiesInRange,
	getRelevantImports,
	getScopeForRange,
} from '../context'
import { formatChunkWithContext } from '../context/format'
import { getSiblings } from '../context/siblings'
import { parseCode } from '../parser'
import { buildScopeTreeFromEntities } from '../scope/tree'
import type {
	Chunk,
	ChunkContext,
	ChunkOptions,
	ExtractedEntity,
	ScopeTree,
} from '../types'
import { DEFAULT_CHUNK_OPTIONS } from './index'
import type { RebuiltText } from './rebuild'

function getFirstKeyFromJsonLine(line: string): string | null {
	try {
		const parsed = JSON.parse(line) as Record<string, unknown>
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			const firstKey = Object.keys(parsed)[0]
			return firstKey ?? null
		}
	} catch {
		// ignore
	}
	return null
}

/**
 * Build entities for JSONL: one section per line (when line parses as JSON object).
 * Uses parseCode(line, 'json') to get a node for each line.
 */
async function extractJsonlEntities(
	code: string,
	lines: string[],
	lineStarts: number[],
): Promise<ExtractedEntity[]> {
	const entities: ExtractedEntity[] = []
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line === undefined) continue
		const start = lineStarts[i] ?? 0
		const end = start + line.length
		let name: string
		let node: ExtractedEntity['node']
		try {
			const parseResult = await parseCode(line, 'json')
			node = parseResult.tree.rootNode
			const firstKey = getFirstKeyFromJsonLine(line)
			name = firstKey ?? `line ${i + 1}`
		} catch {
			// Skip entity for unparseable lines (chunk will still include the line text)
			continue
		}
		entities.push({
			type: 'section',
			name,
			signature: line.includes('\n') ? line.slice(0, line.indexOf('\n')) : line,
			docstring: null,
			byteRange: { start, end },
			lineRange: { start: i, end: i },
			parent: null,
			node,
		})
	}
	return entities
}

/**
 * Chunk JSONL by grouping consecutive lines until maxChunkSize.
 */
export async function chunkJsonl(
	code: string,
	options: ChunkOptions,
	filepath?: string,
): Promise<Chunk[]> {
	const opts: Required<Omit<ChunkOptions, 'language'>> & { language: 'jsonl' } = {
		...DEFAULT_CHUNK_OPTIONS,
		...options,
		language: 'jsonl',
	}
	const maxSize = opts.maxChunkSize
	const lines = code.split('\n')
	const lineStarts: number[] = []
	let offset = 0
	for (let i = 0; i < lines.length; i++) {
		lineStarts[i] = offset
		offset += (lines[i]?.length ?? 0) + (i < lines.length - 1 ? 1 : 0) // +1 for \n
	}

	const entities = await extractJsonlEntities(code, lines, lineStarts)
	const scopeTree: ScopeTree = buildScopeTreeSync(entities)

	// Group lines into chunks by size (NWS or bytes; use bytes for simplicity)
	const chunks: Chunk[] = []
	let chunkStartLine = 0
	let chunkSize = 0
	for (let i = 0; i <= lines.length; i++) {
		const line = lines[i]
		const lineLen = (line?.length ?? 0) + (i < lines.length - 1 ? 1 : 0)
		const wouldExceed = i < lines.length && chunkSize + lineLen > maxSize
		if (wouldExceed && chunkStartLine < i) {
			// Emit chunk [chunkStartLine, i)
			const chunkLines = lines.slice(chunkStartLine, i)
			const text = chunkLines.join('\n')
			const byteStart = lineStarts[chunkStartLine] ?? 0
			const byteRange = { start: byteStart, end: byteStart + text.length }
			const lineRange = { start: chunkStartLine, end: i - 1 }
			const context = buildContextForJsonl(
				{ text, byteRange, lineRange },
				scopeTree,
				opts,
				filepath,
			)
			const contextualizedText = formatChunkWithContext(text, context)
			chunks.push({
				text,
				contextualizedText,
				byteRange,
				lineRange,
				context,
				index: chunks.length,
				totalChunks: -1, // set below
			})
			chunkStartLine = i
			chunkSize = 0
		}
		if (i < lines.length) {
			chunkSize += lineLen
		}
	}
	if (chunkStartLine < lines.length) {
		const chunkLines = lines.slice(chunkStartLine)
		const text = chunkLines.join('\n')
		const byteStart = lineStarts[chunkStartLine] ?? 0
		const byteRange = { start: byteStart, end: byteStart + text.length }
		const lineRange = { start: chunkStartLine, end: lines.length - 1 }
		const context = buildContextForJsonl(
			{ text, byteRange, lineRange },
			scopeTree,
			opts,
			filepath,
		)
		const contextualizedText = formatChunkWithContext(text, context)
		chunks.push({
			text,
			contextualizedText,
			byteRange,
			lineRange,
			context,
			index: chunks.length,
			totalChunks: chunks.length,
		})
	}
	// Set totalChunks on all
	for (let j = 0; j < chunks.length; j++) {
		chunks[j] = { ...chunks[j], totalChunks: chunks.length }
	}
	return chunks
}

function buildScopeTreeSync(entities: ExtractedEntity[]): ScopeTree {
	return buildScopeTreeFromEntities(entities)
}

function buildContextForJsonl(
	text: RebuiltText,
	scopeTree: ScopeTree,
	options: Required<ChunkOptions>,
	filepath?: string,
): ChunkContext {
	const byteRange = text.byteRange
	return {
		filepath,
		language: 'jsonl',
		scope: getScopeForRange(byteRange, scopeTree),
		entities: getEntitiesInRange(byteRange, scopeTree),
		siblings: getSiblings(byteRange, scopeTree, {
			detail: options.siblingDetail,
			maxSiblings: 3,
		}),
		imports: getRelevantImports(
			getEntitiesInRange(byteRange, scopeTree),
			scopeTree,
			options.filterImports,
		),
	}
}
