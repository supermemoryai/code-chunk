/**
 * SWE-bench Lite dataset loader with caching and retry logic
 * Fetches from Hugging Face Dataset Viewer /rows endpoint
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SWEbenchInstance } from './types'

const HF_DATASET = 'princeton-nlp/SWE-bench_Lite'
const HF_API_BASE = 'https://datasets-server.huggingface.co'
const PAGE_SIZE = 100

// Cache directory (relative to package root)
const CACHE_DIR = join(
	dirname(dirname(decodeURIComponent(new URL(import.meta.url).pathname))),
	'data',
	'swebench_lite',
)

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
	if (!existsSync(CACHE_DIR)) {
		mkdirSync(CACHE_DIR, { recursive: true })
	}
}

/**
 * Get cache file path for a page
 */
function getCachePath(split: string, offset: number): string {
	return join(CACHE_DIR, `${split}_offset${offset}_limit${PAGE_SIZE}.json`)
}

/**
 * Sleep helper for retry backoff
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetch a page from HF Dataset Viewer with retry + exponential backoff
 */
async function fetchPage(
	split: string,
	offset: number,
	maxRetries = 3,
): Promise<{ rows: SWEbenchInstance[]; total: number }> {
	const url = new URL(`${HF_API_BASE}/rows`)
	url.searchParams.set('dataset', HF_DATASET)
	url.searchParams.set('config', 'default')
	url.searchParams.set('split', split)
	url.searchParams.set('offset', String(offset))
	url.searchParams.set('length', String(PAGE_SIZE))

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			const response = await fetch(url.toString())
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}
			const data = await response.json()

			// HF returns { features, rows: [{row_idx, row: {...}}], num_rows_total }
			const rows: SWEbenchInstance[] = data.rows.map((r: any) => ({
				instance_id: r.row.instance_id,
				repo: r.row.repo,
				base_commit: r.row.base_commit,
				problem_statement: r.row.problem_statement,
				patch: r.row.patch,
				test_patch: r.row.test_patch,
			}))

			return { rows, total: data.num_rows_total }
		} catch (err) {
			const waitMs = 2 ** attempt * 1000
			console.warn(
				`[dataset] Fetch failed (attempt ${attempt + 1}/${maxRetries}): ${err}. Retrying in ${waitMs}ms...`,
			)
			await sleep(waitMs)
		}
	}

	throw new Error(
		`[dataset] Failed to fetch page after ${maxRetries} attempts: split=${split}, offset=${offset}`,
	)
}

/**
 * Load a page from cache or fetch from HF
 */
async function loadPage(
	split: string,
	offset: number,
): Promise<{ rows: SWEbenchInstance[]; total: number }> {
	ensureCacheDir()
	const cachePath = getCachePath(split, offset)

	// Check cache first
	if (existsSync(cachePath)) {
		try {
			const cached = JSON.parse(readFileSync(cachePath, 'utf-8'))
			return cached
		} catch {
			// Cache corrupted, refetch
		}
	}

	// Fetch from HF
	const result = await fetchPage(split, offset)

	// Write to cache
	writeFileSync(cachePath, JSON.stringify(result, null, 2))

	return result
}

/**
 * Load all instances from a split
 */
export async function loadSWEbenchLite(
	split: 'dev' | 'test' = 'test',
	maxInstances?: number,
): Promise<SWEbenchInstance[]> {
	const instances: SWEbenchInstance[] = []
	let offset = 0
	let total = Infinity

	console.log(`[dataset] Loading SWE-bench Lite split="${split}"...`)

	while (offset < total) {
		const page = await loadPage(split, offset)
		total = page.total
		instances.push(...page.rows)
		console.log(
			`[dataset] Loaded ${instances.length}/${total} instances (offset=${offset})`,
		)

		if (maxInstances && instances.length >= maxInstances) {
			break
		}

		offset += PAGE_SIZE
	}

	const result = maxInstances ? instances.slice(0, maxInstances) : instances
	console.log(
		`[dataset] Loaded ${result.length} instances from split="${split}"`,
	)
	return result
}
