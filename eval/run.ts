/**
 * RepoEval Retrieval Evaluation Runner
 *
 * Compares AST-aware chunking vs fixed-size chunking on code retrieval.
 *
 * Usage:
 *   bun eval/run.ts
 */

import { readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chunkFile as chunkWithAST } from './chunkers/ast'
import { chunkFile as chunkWithChonkie } from './chunkers/chonkie'
import { chunkFile as chunkWithFixed } from './chunkers/fixed'
import {
	download,
	getRepos,
	getReposDir,
	loadTasks,
	type RepoEvalTask,
} from './download'
import { embedTexts, topK } from './embeddings'
import { aggregateMetrics, computeMetrics } from './metrics'

const RESULTS_DIR = join(import.meta.dir, 'results')
const K_VALUES = [5, 10] // Top-k values for retrieval
const MAX_CHUNK_SIZE = 1500 // NWS characters per chunk

// Colors for terminal output
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

// Status line helper - overwrites current line
function status(msg: string) {
	process.stdout.write(`\r\x1b[K${dim(msg)}`)
}

function clearStatus() {
	process.stdout.write('\r\x1b[K')
}

interface ChunkInfo {
	id: string
	text: string
	startLine: number
	endLine: number
	filepath: string
}

interface MetricsAtK {
	precision: number
	recall: number
	ndcg: number
}

interface QueryResult {
	taskId: string
	prompt: string
	groundTruthLines: { start: number; end: number }
	groundTruthFile: string
	retrievedChunks: Array<{ id: string; score: number; rank: number }>
	relevantChunkIds: string[]
	metrics: Record<number, MetricsAtK> // metrics per k value
}

type ChunkerType = 'ast' | 'fixed' | 'chonkie'

interface EvalResult {
	chunker: ChunkerType
	repo: string
	summary: Record<number, MetricsAtK> // summary per k value
	queryResults: QueryResult[]
	config: { kValues: number[]; maxChunkSize: number }
	timestamp: string
}

/**
 * Recursively find all Python files in a directory
 */
function findPythonFiles(dir: string): string[] {
	const files: string[] = []

	function walk(currentDir: string) {
		const entries = readdirSync(currentDir)
		for (const entry of entries) {
			const fullPath = join(currentDir, entry)
			const stat = statSync(fullPath)
			if (stat.isDirectory()) {
				walk(fullPath)
			} else if (entry.endsWith('.py')) {
				files.push(fullPath)
			}
		}
	}

	walk(dir)
	return files
}

/**
 * Check if a chunk overlaps with a line range
 */
function chunksOverlap(
	chunk: { startLine: number; endLine: number },
	target: { start: number; end: number },
): boolean {
	return !(chunk.endLine < target.start || chunk.startLine > target.end)
}

interface EmbedStats {
	cached: number
	total: number
}

/**
 * Run evaluation for a single repository and chunker
 */
async function evaluateRepo(
	repo: string,
	tasks: RepoEvalTask[],
	chunkerType: ChunkerType,
): Promise<{ result: EvalResult; chunkCount: number; embedStats: EmbedStats }> {
	const repoDir = join(getReposDir(), repo)
	const pyFiles = findPythonFiles(repoDir)

	// Step 1: Chunk all files
	status(`[${chunkerType}] chunking ${pyFiles.length} files...`)
	const allChunks: ChunkInfo[] = []

	for (const filepath of pyFiles) {
		const code = await readFile(filepath, 'utf-8')
		const relPath = filepath.replace(`${repoDir}/`, '')

		try {
			let chunks: Awaited<ReturnType<typeof chunkWithAST>>
			switch (chunkerType) {
				case 'ast':
					chunks = await chunkWithAST(filepath, code, MAX_CHUNK_SIZE)
					break
				case 'chonkie':
					chunks = await chunkWithChonkie(filepath, code, MAX_CHUNK_SIZE)
					break
				case 'fixed':
					chunks = await chunkWithFixed(filepath, code, MAX_CHUNK_SIZE)
					break
			}

			for (const chunk of chunks) {
				allChunks.push({
					...chunk,
					filepath: relPath,
				})
			}
		} catch {
			// Skip files that fail to parse
		}
	}

	// Step 2: Embed all chunks
	status(`[${chunkerType}] embedding ${allChunks.length} chunks...`)
	const chunkTexts = allChunks.map((c) => c.text)
	let embedStats: EmbedStats = { cached: 0, total: chunkTexts.length }
	const chunkEmbeddings = await embedTexts(
		chunkTexts,
		(done, total, cached) => {
			embedStats = { cached, total }
			status(
				`[${chunkerType}] embedding chunks ${done}/${total} (${cached} cached)`,
			)
		},
	)

	// Step 3: Embed queries
	status(`[${chunkerType}] embedding ${tasks.length} queries...`)
	const queryTexts = tasks.map((t) => t.prompt)
	const queryEmbeddings = await embedTexts(queryTexts)

	// Step 4: For each query, retrieve top-k and compute metrics
	status(`[${chunkerType}] computing metrics...`)
	const queryResults: QueryResult[] = []
	const maxK = Math.max(...K_VALUES)

	for (let i = 0; i < tasks.length; i++) {
		const task = tasks[i]
		const queryEmb = queryEmbeddings[i]

		const topKResults = topK(queryEmb, chunkEmbeddings, maxK)

		const targetFile = task.metadata.fpath_tuple.slice(1).join('/')
		const targetLines = {
			start: task.metadata.context_start_lineno,
			end: task.metadata.line_no,
		}

		const relevantChunkIds = allChunks
			.filter((c) => c.filepath === targetFile && chunksOverlap(c, targetLines))
			.map((c) => c.id)

		const relevantSet = new Set(relevantChunkIds)
		const retrievedIds = topKResults.map((r) => allChunks[r.index].id)

		const metrics: Record<number, MetricsAtK> = {}
		for (const k of K_VALUES) {
			metrics[k] = computeMetrics(retrievedIds, relevantSet, k)
		}

		queryResults.push({
			taskId: task.metadata.task_id,
			prompt: `${task.prompt.slice(0, 200)}...`,
			groundTruthLines: targetLines,
			groundTruthFile: targetFile,
			retrievedChunks: topKResults.map((r, rank) => ({
				id: allChunks[r.index].id,
				score: r.score,
				rank: rank + 1,
			})),
			relevantChunkIds,
			metrics,
		})
	}

	const summary: Record<number, MetricsAtK> = {}
	for (const k of K_VALUES) {
		summary[k] = aggregateMetrics(queryResults.map((q) => q.metrics[k]))
	}

	clearStatus()

	return {
		result: {
			chunker: chunkerType,
			repo,
			summary,
			queryResults,
			config: { kValues: K_VALUES, maxChunkSize: MAX_CHUNK_SIZE },
			timestamp: new Date().toISOString(),
		},
		chunkCount: allChunks.length,
		embedStats,
	}
}

/**
 * Print metrics table for all k values
 */
function printMetricsTable(
	summaries: Record<string, Record<number, MetricsAtK>>,
): void {
	const chunkerNames = Object.keys(summaries)

	for (const k of K_VALUES) {
		console.log(dim(`@${k}`))
		console.log(
			`${dim('Chunker'.padEnd(12))} ${dim('nDCG'.padStart(8))}  ${dim('Prec'.padStart(8))}  ${dim('Recall'.padStart(8))}`,
		)

		for (const name of chunkerNames) {
			const m = summaries[name][k]
			const ndcg = yellow(`${(m.ndcg * 100).toFixed(1)}%`.padStart(8))
			const prec = `${(m.precision * 100).toFixed(1)}%`.padStart(8)
			const recall = `${(m.recall * 100).toFixed(1)}%`.padStart(8)
			console.log(`${cyan(name.padEnd(12))} ${ndcg}  ${prec}  ${recall}`)
		}
		console.log('')
	}
}

async function main() {
	console.log(bold('\nRepoEval Retrieval Evaluation\n'))

	// Step 1: Download data if needed
	await download()

	// Step 2: Load tasks
	status('loading tasks...')
	const allTasks = await loadTasks('2k')
	clearStatus()

	// Group tasks by repo
	const tasksByRepo = new Map<string, RepoEvalTask[]>()
	for (const task of allTasks) {
		const repo = task.metadata.task_id.split('/')[0]
		if (!tasksByRepo.has(repo)) {
			tasksByRepo.set(repo, [])
		}
		const repoTasks = tasksByRepo.get(repo)
		if (repoTasks) {
			repoTasks.push(task)
		}
	}

	// Step 3: Run evaluation for each repo and chunker
	await mkdir(RESULTS_DIR, { recursive: true })

	const allResults: EvalResult[] = []
	const repos = getRepos()
	const chunkerTypes: ChunkerType[] = ['ast', 'chonkie', 'fixed']

	for (let repoIdx = 0; repoIdx < repos.length; repoIdx++) {
		const repo = repos[repoIdx]
		const tasks = tasksByRepo.get(repo)
		if (!tasks || tasks.length === 0) {
			continue
		}

		console.log(
			`${dim(`[${repoIdx + 1}/${repos.length}]`)} ${bold(repo)} ${dim(`(${tasks.length} tasks)`)}`,
		)

		const repoResults: Record<
			string,
			{ result: EvalResult; chunkCount: number; embedStats: EmbedStats }
		> = {}

		for (const chunkerType of chunkerTypes) {
			const evalResult = await evaluateRepo(repo, tasks, chunkerType)
			repoResults[chunkerType] = evalResult
			allResults.push(evalResult.result)
		}

		// Print summary line for this repo
		const summaryParts = chunkerTypes.map((ct) => {
			const { chunkCount, embedStats } = repoResults[ct]
			const cachedPct = Math.round((embedStats.cached / embedStats.total) * 100)
			return `${cyan(ct)}: ${chunkCount} chunks ${dim(`(${cachedPct}% cached)`)}`
		})
		console.log(`  ${summaryParts.join('  ')}`)

		// Print quick metrics comparison
		const k = K_VALUES[0]
		const metricsLine = chunkerTypes.map((ct) => {
			const ndcg = (repoResults[ct].result.summary[k].ndcg * 100).toFixed(1)
			return `${ct}: ${yellow(ndcg)}%`
		})
		console.log(`  ${dim(`nDCG@${k}:`)} ${metricsLine.join('  ')}\n`)
	}

	// Step 4: Compute overall summary
	console.log(bold('Results'))
	console.log(dim('─'.repeat(60)))

	const astResults = allResults.filter((r) => r.chunker === 'ast')
	const chonkieResults = allResults.filter((r) => r.chunker === 'chonkie')
	const fixedResults = allResults.filter((r) => r.chunker === 'fixed')

	// Aggregate metrics for each k value
	const astOverall: Record<number, MetricsAtK> = {}
	const chonkieOverall: Record<number, MetricsAtK> = {}
	const fixedOverall: Record<number, MetricsAtK> = {}
	for (const k of K_VALUES) {
		astOverall[k] = aggregateMetrics(astResults.map((r) => r.summary[k]))
		chonkieOverall[k] = aggregateMetrics(
			chonkieResults.map((r) => r.summary[k]),
		)
		fixedOverall[k] = aggregateMetrics(fixedResults.map((r) => r.summary[k]))
	}

	printMetricsTable({
		AST: astOverall,
		Chonkie: chonkieOverall,
		Fixed: fixedOverall,
	})

	// Compute improvements for each k (comparing AST and Chonkie against Fixed baseline)
	const computeImprovement = (a: number, b: number): string => {
		const improvement = ((a - b) / b) * 100
		const sign = improvement >= 0 ? '+' : ''
		return improvement >= 0
			? green(`${sign}${improvement.toFixed(1)}%`)
			: `${sign}${improvement.toFixed(1)}%`
	}

	console.log(dim('vs Fixed baseline:'))
	for (const k of K_VALUES) {
		console.log(
			`  k=${k}: ${cyan('AST')} ${computeImprovement(astOverall[k].ndcg, fixedOverall[k].ndcg)} nDCG  ${cyan('Chonkie')} ${computeImprovement(chonkieOverall[k].ndcg, fixedOverall[k].ndcg)} nDCG`,
		)
	}

	// Step 5: Save results
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

	// Save summary
	const summaryPath = join(RESULTS_DIR, `summary_${timestamp}.json`)
	await writeFile(
		summaryPath,
		JSON.stringify(
			{
				overall: {
					ast: astOverall,
					chonkie: chonkieOverall,
					fixed: fixedOverall,
				},
				perRepo: Object.fromEntries(
					repos.map((repo) => [
						repo,
						{
							ast: astResults.find((r) => r.repo === repo)?.summary,
							chonkie: chonkieResults.find((r) => r.repo === repo)?.summary,
							fixed: fixedResults.find((r) => r.repo === repo)?.summary,
						},
					]),
				),
				config: { kValues: K_VALUES, maxChunkSize: MAX_CHUNK_SIZE },
				timestamp: new Date().toISOString(),
			},
			null,
			2,
		),
	)
	// Save detailed results
	const detailedPath = join(RESULTS_DIR, `detailed_${timestamp}.json`)
	await writeFile(detailedPath, JSON.stringify(allResults, null, 2))

	console.log(`\n${dim(`Saved to ${summaryPath}`)}`)
}

// Run if executed directly
if (import.meta.main) {
	main().catch(console.error)
}
