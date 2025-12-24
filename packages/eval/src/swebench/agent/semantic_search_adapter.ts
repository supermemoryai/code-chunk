/**
 * Semantic Search Adapter: Interface for the underlying index implementation
 * This provides a pluggable boundary to integrate with code-chunk or other indexers
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { chunk as codeChunk } from 'code-chunk'
import { z } from 'zod'
import type { SemanticSearchResult } from '../types'

/**
 * Task type for embedding generation (provider-specific optimization)
 * - RETRIEVAL_DOCUMENT: For indexing documents/code chunks
 * - CODE_RETRIEVAL_QUERY: For search queries optimized for code retrieval
 * - RETRIEVAL_QUERY: For general search queries
 */
export type EmbeddingTaskType =
	| 'RETRIEVAL_DOCUMENT'
	| 'CODE_RETRIEVAL_QUERY'
	| 'RETRIEVAL_QUERY'

/**
 * Embedding service interface
 */
export interface EmbeddingService {
	embed(
		texts: string[],
		taskType?: EmbeddingTaskType,
	): Promise<{ embeddings: number[][]; tokens: number }>
}

/** Sleep helper for retry backoff */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Check if error is retryable (network issues) */
function isRetryableError(err: unknown): boolean {
	const code = (err as { code?: string })?.code
	const msg = err instanceof Error ? err.message : ''
	return (
		[
			'ECONNRESET',
			'ETIMEDOUT',
			'ECONNREFUSED',
			'ENOTFOUND',
			'EAI_AGAIN',
		].includes(code ?? '') ||
		/socket|network|connection/i.test(msg) ||
		err instanceof TypeError
	)
}

/** Normalize vector to unit length */
function normalizeVector(vector: number[]): number[] {
	const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
	return norm === 0 ? vector : vector.map((v) => v / norm)
}

/**
 * Gemini embedding service with retry logic
 */
export class GeminiEmbeddingService implements EmbeddingService {
	private apiKey: string
	private model: string
	private maxRetries: number
	private dims: number
	private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models'

	constructor(
		apiKey: string,
		model = 'gemini-embedding-001',
		maxRetries = 5,
		dims = 768,
	) {
		this.apiKey = apiKey
		this.model = model
		this.maxRetries = maxRetries
		this.dims = dims
	}

	async embed(
		texts: string[],
		taskType: EmbeddingTaskType = 'RETRIEVAL_DOCUMENT',
	): Promise<{ embeddings: number[][]; tokens: number }> {
		const isSingle = texts.length === 1
		const endpoint = isSingle ? 'embedContent' : 'batchEmbedContents'
		const url = `${this.baseUrl}/${this.model}:${endpoint}?key=${this.apiKey}`

		const body = isSingle
			? {
					model: `models/${this.model}`,
					content: { parts: [{ text: texts[0] }] },
					taskType,
					outputDimensionality: this.dims,
				}
			: {
					requests: texts.map((text) => ({
						model: `models/${this.model}`,
						content: { parts: [{ text }] },
						taskType,
						outputDimensionality: this.dims,
					})),
				}

		let lastError: Error | null = null

		for (let attempt = 0; attempt < this.maxRetries; attempt++) {
			try {
				const response = await fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				})

				if (!response.ok) {
					const { status, statusText } = response
					const respBody = await response.text()

					if (status === 429 || status >= 500) {
						const waitMs = 2 ** attempt * 1000 + Math.random() * 1000
						console.warn(
							`[embedding] Gemini ${status} ${statusText}, retry in ${Math.round(waitMs)}ms (${attempt + 1}/${this.maxRetries})...`,
						)
						await sleep(waitMs)
						lastError = new Error(`Gemini ${status} ${statusText}: ${respBody}`)
						continue
					}
					throw new Error(`Gemini ${status} ${statusText}: ${respBody}`)
				}

				const data = await response.json()
				let embeddings: number[][] = isSingle
					? [data.embedding?.values || []]
					: data.embeddings?.map((e: { values: number[] }) => e.values) || []

				// Normalize if not using native 3072 dimensions
				if (this.dims !== 3072) {
					embeddings = embeddings.map(normalizeVector)
				}

				const tokens = texts.reduce(
					(sum, t) => sum + Math.ceil(t.length / 4),
					0,
				)
				return { embeddings, tokens }
			} catch (err) {
				if (isRetryableError(err) && attempt < this.maxRetries - 1) {
					const waitMs = 2 ** attempt * 1000 + Math.random() * 1000
					console.warn(
						`[embedding] Network error, retry in ${Math.round(waitMs)}ms (${attempt + 1}/${this.maxRetries})...`,
					)
					await sleep(waitMs)
					lastError = err instanceof Error ? err : new Error(String(err))
					continue
				}
				throw err
			}
		}

		throw lastError || new Error('Gemini embedding failed after retries')
	}
}

/**
 * Indexed chunk with embedding
 */
interface IndexedChunk {
	filepath: string
	startLine: number
	endLine: number
	text: string
	contextualizedText: string
	embedding: number[]
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
	let dotProduct = 0
	let normA = 0
	let normB = 0

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i]! * b[i]!
		normA += a[i]! * a[i]!
		normB += b[i]! * b[i]!
	}

	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Cache metadata for serialized index
 */
interface IndexCacheMetadata {
	version: number
	embeddingProvider: string
	embeddingDimensions: number
	chunkSettings: {
		maxChunkSize: number
		overlapLines: number
	}
	createdAt: string
	chunkCount: number
	totalEmbedTokens: number
	totalEmbedLatencyMs: number
}

/**
 * Semantic Search Index: indexes a repository and supports similarity search
 * Supports caching to avoid re-embedding the same repo
 */
export class SemanticSearchIndex {
	private chunks: IndexedChunk[] = []
	private embedService: EmbeddingService
	private worktreePath: string

	// Metrics for fairness accounting
	public indexLoadMs = 0
	public totalEmbedTokens = 0
	public totalEmbedLatencyMs = 0
	public lastQueryEmbedTokens = 0
	public lastQueryEmbedLatencyMs = 0

	// Cache versioning (increment when chunk/embed format changes)
	private static CACHE_VERSION = 1

	constructor(worktreePath: string, embedService: EmbeddingService) {
		this.worktreePath = worktreePath
		this.embedService = embedService
	}

	/**
	 * Generate cache key for an index
	 */
	static getCacheKey(
		instanceId: string,
		embeddingProvider: string,
		embeddingDimensions: number,
	): string {
		return `${instanceId}_${embeddingProvider}_${embeddingDimensions}`
	}

	/**
	 * Get cache file path
	 */
	static getCachePath(cacheDir: string, cacheKey: string): string {
		return join(cacheDir, `${cacheKey}.json`)
	}

	/**
	 * Check if a valid cache exists
	 */
	static cacheExists(
		cacheDir: string,
		instanceId: string,
		embeddingProvider: string,
		embeddingDimensions: number,
	): boolean {
		const cacheKey = SemanticSearchIndex.getCacheKey(
			instanceId,
			embeddingProvider,
			embeddingDimensions,
		)
		const cachePath = SemanticSearchIndex.getCachePath(cacheDir, cacheKey)
		return existsSync(cachePath)
	}

	/**
	 * Load index from cache
	 */
	static async loadFromCache(
		cacheDir: string,
		instanceId: string,
		embeddingProvider: string,
		embeddingDimensions: number,
		worktreePath: string,
		embedService: EmbeddingService,
	): Promise<SemanticSearchIndex | null> {
		const cacheKey = SemanticSearchIndex.getCacheKey(
			instanceId,
			embeddingProvider,
			embeddingDimensions,
		)
		const cachePath = SemanticSearchIndex.getCachePath(cacheDir, cacheKey)

		if (!existsSync(cachePath)) {
			return null
		}

		try {
			const startTime = Date.now()
			const data = JSON.parse(readFileSync(cachePath, 'utf-8'))

			// Validate cache version
			if (data.metadata?.version !== SemanticSearchIndex.CACHE_VERSION) {
				console.log(`[semantic-search] Cache version mismatch, will re-index`)
				return null
			}

			const index = new SemanticSearchIndex(worktreePath, embedService)
			index.chunks = data.chunks
			index.totalEmbedTokens = data.metadata.totalEmbedTokens || 0
			index.totalEmbedLatencyMs = data.metadata.totalEmbedLatencyMs || 0
			index.indexLoadMs = Date.now() - startTime

			console.log(
				`[semantic-search] Loaded ${index.chunks.length} chunks from cache in ${index.indexLoadMs}ms`,
			)

			return index
		} catch (err) {
			console.warn(`[semantic-search] Failed to load cache: ${err}`)
			return null
		}
	}

	/**
	 * Save index to cache
	 */
	async saveToCache(
		cacheDir: string,
		instanceId: string,
		embeddingProvider: string,
		embeddingDimensions: number,
	): Promise<void> {
		try {
			// Ensure cache directory exists
			if (!existsSync(cacheDir)) {
				mkdirSync(cacheDir, { recursive: true })
			}

			const cacheKey = SemanticSearchIndex.getCacheKey(
				instanceId,
				embeddingProvider,
				embeddingDimensions,
			)
			const cachePath = SemanticSearchIndex.getCachePath(cacheDir, cacheKey)

			const metadata: IndexCacheMetadata = {
				version: SemanticSearchIndex.CACHE_VERSION,
				embeddingProvider,
				embeddingDimensions,
				chunkSettings: {
					maxChunkSize: 1500,
					overlapLines: 5,
				},
				createdAt: new Date().toISOString(),
				chunkCount: this.chunks.length,
				totalEmbedTokens: this.totalEmbedTokens,
				totalEmbedLatencyMs: this.totalEmbedLatencyMs,
			}

			const data = {
				metadata,
				chunks: this.chunks,
			}

			writeFileSync(cachePath, JSON.stringify(data))
			console.log(`[semantic-search] Saved index to cache: ${cachePath}`)
		} catch (err) {
			console.warn(`[semantic-search] Failed to save cache: ${err}`)
		}
	}

	/**
	 * Index files in the repository
	 */
	async index(filePaths: string[]): Promise<void> {
		const startTime = Date.now()
		console.log(`[semantic-search] Indexing ${filePaths.length} files...`)

		// Chunk all files
		const allChunks: {
			filepath: string
			text: string
			contextualizedText: string
			startLine: number
			endLine: number
		}[] = []

		for (const filepath of filePaths) {
			try {
				const fullPath = join(this.worktreePath, filepath)
				const content = readFileSync(fullPath, 'utf-8')

				const chunks = await codeChunk(filepath, content, {
					maxChunkSize: 1500,
					overlapLines: 5,
				})

				for (const c of chunks) {
					allChunks.push({
						filepath,
						text: c.text,
						contextualizedText: c.contextualizedText,
						startLine: c.lineRange.start,
						endLine: c.lineRange.end,
					})
				}
			} catch (err) {
				// Skip files that can't be chunked (binary, too large, etc.)
				console.warn(`[semantic-search] Failed to chunk ${filepath}: ${err}`)
			}
		}

		console.log(`[semantic-search] Created ${allChunks.length} chunks`)

		// Batch embed chunks (using contextualizedText for better semantic matching)
		const batchSize = 100
		for (let i = 0; i < allChunks.length; i += batchSize) {
			const batch = allChunks.slice(i, i + batchSize)
			const texts = batch.map((c) => c.contextualizedText)

			const embedStart = Date.now()
			const { embeddings, tokens } = await this.embedService.embed(
				texts,
				'RETRIEVAL_DOCUMENT', // Task type for indexing documents/code chunks
			)
			const embedLatency = Date.now() - embedStart

			this.totalEmbedTokens += tokens
			this.totalEmbedLatencyMs += embedLatency

			for (let j = 0; j < batch.length; j++) {
				this.chunks.push({
					...batch[j]!,
					embedding: embeddings[j]!,
				})
			}

			console.log(
				`[semantic-search] Embedded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allChunks.length / batchSize)} (${tokens} tokens, ${embedLatency}ms)`,
			)
		}

		this.indexLoadMs = Date.now() - startTime
		console.log(
			`[semantic-search] Indexing complete: ${this.chunks.length} chunks, ${this.totalEmbedTokens} tokens, ${this.indexLoadMs}ms`,
		)
	}

	/**
	 * Search for relevant chunks given a query
	 */
	async search(
		query: string,
		topK = 10,
		filters?: { filepathPattern?: string },
	): Promise<SemanticSearchResult[]> {
		if (this.chunks.length === 0) {
			return []
		}

		// Embed the query with CODE_RETRIEVAL_QUERY for optimal code search
		const embedStart = Date.now()
		const { embeddings, tokens } = await this.embedService.embed(
			[query],
			'CODE_RETRIEVAL_QUERY', // Task type optimized for code retrieval queries
		)
		const queryEmbedding = embeddings[0]!
		this.lastQueryEmbedLatencyMs = Date.now() - embedStart
		this.lastQueryEmbedTokens = tokens
		this.totalEmbedTokens += tokens
		this.totalEmbedLatencyMs += this.lastQueryEmbedLatencyMs

		// Filter chunks if needed
		let candidates = this.chunks
		if (filters?.filepathPattern) {
			const pattern = new RegExp(filters.filepathPattern)
			candidates = candidates.filter((c) => pattern.test(c.filepath))
		}

		// Compute similarities
		const scored = candidates.map((c) => ({
			chunk: c,
			score: cosineSimilarity(queryEmbedding, c.embedding!),
		}))

		// Sort by score descending
		scored.sort((a, b) => b.score - a.score)

		// Return top-k results with absolute paths (SDK Read tool requires absolute paths)
		const results = scored.slice(0, topK).map((s) => ({
			filepath: join(this.worktreePath, s.chunk.filepath),
			start_line: s.chunk.startLine,
			end_line: s.chunk.endLine,
			score: s.score,
			snippet: s.chunk.text.slice(0, 200), // Truncate for compactness
		}))

		return results
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server for semantic search tool
// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticSearchMetrics {
	callCount: number
	totalLatencyMs: number
	totalQueryEmbedTokens: number
	totalQueryEmbedLatencyMs: number
}

export function createSemanticSearchMetrics(): SemanticSearchMetrics {
	return {
		callCount: 0,
		totalLatencyMs: 0,
		totalQueryEmbedTokens: 0,
		totalQueryEmbedLatencyMs: 0,
	}
}

export function createSemanticSearchServer(
	index: SemanticSearchIndex,
	metrics: SemanticSearchMetrics,
) {
	return createSdkMcpServer({
		name: 'semantic_search',
		version: '1.0.0',
		tools: [
			tool(
				'search',
				'Search the codebase for code semantically similar to the query. Returns ranked file locations with snippets.',
				{
					query: z
						.string()
						.describe(
							"Natural language description of what code you're looking for",
						),
					top_k: z
						.number()
						.min(1)
						.max(50)
						.default(10)
						.describe('Number of results to return'),
					filepath_pattern: z
						.string()
						.optional()
						.describe('Optional regex pattern to filter file paths'),
				},
				async (args) => {
					const startTime = Date.now()
					try {
						const results = await index.search(args.query, args.top_k, {
							filepathPattern: args.filepath_pattern,
						})
						metrics.callCount++
						metrics.totalLatencyMs += Date.now() - startTime
						metrics.totalQueryEmbedTokens += index.lastQueryEmbedTokens
						metrics.totalQueryEmbedLatencyMs += index.lastQueryEmbedLatencyMs

						if (results.length === 0) {
							return {
								content: [
									{
										type: 'text' as const,
										text: 'No matching code found for the query.',
									},
								],
							}
						}

						const formatted = results.map((r, i) => {
							const lines =
								r.start_line && r.end_line
									? `L${r.start_line}-${r.end_line}`
									: ''
							return `${i + 1}. ${r.filepath}${lines ? `:${lines}` : ''} (score: ${r.score.toFixed(3)})\n   ${r.snippet?.replace(/\n/g, '\n   ')}`
						})
						const fileList = results.map((r) => r.filepath).join('\n')

						return {
							content: [
								{
									type: 'text' as const,
									text: `Found ${results.length} relevant code locations:\n\n${formatted.join('\n\n')}\n\n__FILES__\n${fileList}\n__END_FILES__`,
								},
							],
						}
					} catch (error) {
						return {
							content: [
								{
									type: 'text' as const,
									text: `Error during semantic search: ${error instanceof Error ? error.message : String(error)}`,
								},
							],
							isError: true,
						}
					}
				},
			),
		],
	})
}
