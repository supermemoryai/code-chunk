/**
 * OpenAI embeddings wrapper with disk caching
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import OpenAI from 'openai'

const CACHE_DIR = join(import.meta.dir, 'cache', 'embeddings')
const MODEL = 'text-embedding-3-small'
const BATCH_SIZE = 100

let client: OpenAI | null = null

function getClient(): OpenAI {
	if (!client) {
		client = new OpenAI()
	}
	return client
}

/**
 * Create a cache key from text content
 */
function cacheKey(text: string): string {
	return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/**
 * Get cache file path for a text
 */
function cachePath(text: string): string {
	const key = cacheKey(text)
	// Use first 2 chars as subdirectory to avoid too many files in one dir
	return join(CACHE_DIR, key.slice(0, 2), `${key}.json`)
}

/**
 * Try to load embedding from cache
 */
async function loadFromCache(text: string): Promise<number[] | null> {
	const path = cachePath(text)
	if (!existsSync(path)) {
		return null
	}
	try {
		const data = await readFile(path, 'utf-8')
		return JSON.parse(data) as number[]
	} catch {
		return null
	}
}

/**
 * Save embedding to cache
 */
async function saveToCache(text: string, embedding: number[]): Promise<void> {
	const path = cachePath(text)
	const dir = join(path, '..')
	await mkdir(dir, { recursive: true })
	await writeFile(path, JSON.stringify(embedding))
}

/**
 * Embed a batch of texts using OpenAI API
 */
async function embedBatch(texts: string[]): Promise<number[][]> {
	const openai = getClient()

	// Filter out empty texts and track their indices
	const nonEmptyTexts: string[] = []
	const indexMap: number[] = []

	for (let i = 0; i < texts.length; i++) {
		const text = texts[i].trim()
		if (text.length > 0) {
			nonEmptyTexts.push(text)
			indexMap.push(i)
		}
	}

	if (nonEmptyTexts.length === 0) {
		// Return zero vectors for all empty inputs
		return texts.map(() => new Array(1536).fill(0))
	}

	const response = await openai.embeddings.create({
		model: MODEL,
		input: nonEmptyTexts,
	})

	// Sort by index to maintain order
	const sorted = response.data.sort(
		(a: { index: number }, b: { index: number }) => a.index - b.index,
	)
	const embeddings = sorted.map((d: { embedding: number[] }) => d.embedding)

	// Map back to original indices, filling zeros for empty texts
	const result: number[][] = texts.map(() => new Array(1536).fill(0))
	for (let i = 0; i < indexMap.length; i++) {
		result[indexMap[i]] = embeddings[i]
	}

	return result
}

/**
 * Embed texts with caching
 *
 * @param texts - Array of texts to embed
 * @param onProgress - Optional callback for progress updates
 * @returns Array of embeddings (same order as input texts)
 */
export async function embedTexts(
	texts: string[],
	onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
	await mkdir(CACHE_DIR, { recursive: true })

	const results: (number[] | null)[] = new Array(texts.length).fill(null)
	const uncachedIndices: number[] = []
	const uncachedTexts: string[] = []

	// Check cache for each text
	for (let i = 0; i < texts.length; i++) {
		const cached = await loadFromCache(texts[i])
		if (cached) {
			results[i] = cached
		} else {
			uncachedIndices.push(i)
			uncachedTexts.push(texts[i])
		}
	}

	const cachedCount = texts.length - uncachedTexts.length
	if (cachedCount > 0) {
		console.log(`  Found ${cachedCount}/${texts.length} embeddings in cache`)
	}

	// Embed uncached texts in batches
	for (let i = 0; i < uncachedTexts.length; i += BATCH_SIZE) {
		const batch = uncachedTexts.slice(i, i + BATCH_SIZE)
		const batchIndices = uncachedIndices.slice(i, i + BATCH_SIZE)

		const embeddings = await embedBatch(batch)

		// Save to cache and store results
		for (let j = 0; j < embeddings.length; j++) {
			const originalIdx = batchIndices[j]
			results[originalIdx] = embeddings[j]
			await saveToCache(batch[j], embeddings[j])
		}

		if (onProgress) {
			onProgress(
				Math.min(i + BATCH_SIZE, uncachedTexts.length),
				uncachedTexts.length,
			)
		}
	}

	return results as number[][]
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	let dotProduct = 0
	let normA = 0
	let normB = 0

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}

	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Find top-k most similar items
 *
 * @param queryEmbedding - The query embedding
 * @param corpusEmbeddings - Array of corpus embeddings
 * @param k - Number of top results to return
 * @returns Array of { index, score } sorted by score descending
 */
export function topK(
	queryEmbedding: number[],
	corpusEmbeddings: number[][],
	k: number,
): Array<{ index: number; score: number }> {
	const scores = corpusEmbeddings.map((emb, idx) => ({
		index: idx,
		score: cosineSimilarity(queryEmbedding, emb),
	}))

	scores.sort((a, b) => b.score - a.score)

	return scores.slice(0, k)
}
