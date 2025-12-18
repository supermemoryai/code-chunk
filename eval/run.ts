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
import {
	download,
	getRepos,
	getReposDir,
	loadTasks,
	type RepoEvalTask,
} from './download'
import { chunkFile as chunkWithAST } from './chunkers/ast'
import { chunkFile as chunkWithFixed } from './chunkers/fixed'
import { embedTexts, topK } from './embeddings'
import { aggregateMetrics, computeMetrics } from './metrics'

const RESULTS_DIR = join(import.meta.dir, 'results')
const K = 5 // Top-k for retrieval
const MAX_CHUNK_SIZE = 1800 // NWS characters per chunk

interface ChunkInfo {
	id: string
	text: string
	startLine: number
	endLine: number
	filepath: string
}

interface QueryResult {
	taskId: string
	prompt: string
	groundTruthLines: { start: number; end: number }
	groundTruthFile: string
	retrievedChunks: Array<{ id: string; score: number; rank: number }>
	relevantChunkIds: string[]
	metrics: { precision: number; recall: number; ndcg: number }
}

interface EvalResult {
	chunker: 'ast' | 'fixed'
	repo: string
	summary: { precision: number; recall: number; ndcg: number }
	queryResults: QueryResult[]
	config: { k: number; maxChunkSize: number }
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

/**
 * Run evaluation for a single repository
 */
async function evaluateRepo(
	repo: string,
	tasks: RepoEvalTask[],
	chunkerType: 'ast' | 'fixed',
): Promise<EvalResult> {
	console.log(`\n  Evaluating ${repo} with ${chunkerType} chunker...`)

	const repoDir = join(getReposDir(), repo)
	const pyFiles = findPythonFiles(repoDir)
	console.log(`    Found ${pyFiles.length} Python files`)

	// Step 1: Chunk all files
	console.log('    Chunking files...')
	const allChunks: ChunkInfo[] = []

	for (const filepath of pyFiles) {
		const code = await readFile(filepath, 'utf-8')
		const relPath = filepath.replace(repoDir + '/', '')

		try {
			const chunks =
				chunkerType === 'ast'
					? await chunkWithAST(filepath, code, MAX_CHUNK_SIZE)
					: await chunkWithFixed(filepath, code, MAX_CHUNK_SIZE)

			for (const chunk of chunks) {
				allChunks.push({
					...chunk,
					filepath: relPath,
				})
			}
		} catch (err) {
			// Skip files that can't be parsed
			console.log(`      Warning: Failed to chunk ${relPath}: ${err}`)
		}
	}

	console.log(`    Created ${allChunks.length} chunks`)

	// Step 2: Embed all chunks
	console.log('    Embedding chunks...')
	const chunkTexts = allChunks.map((c) => c.text)
	const chunkEmbeddings = await embedTexts(chunkTexts, (done, total) => {
		process.stdout.write(`\r    Embedding chunks: ${done}/${total}`)
	})
	console.log('')

	// Step 3: Embed queries and retrieve
	console.log('    Embedding queries and retrieving...')
	const queryTexts = tasks.map((t) => t.prompt)
	const queryEmbeddings = await embedTexts(queryTexts)

	// Step 4: For each query, retrieve top-k and compute metrics
	const queryResults: QueryResult[] = []

	// Debug: show sample filepaths from chunks
	const sampleFilepaths = [...new Set(allChunks.map((c) => c.filepath))].slice(
		0,
		5,
	)
	if (tasks.length > 0) {
		console.log(
			`    Debug: Sample chunk filepaths: ${sampleFilepaths.join(', ')}`,
		)
		console.log(
			`    Debug: Sample task fpath_tuple: ${tasks[0].metadata.fpath_tuple.join('/')}`,
		)
		console.log(
			`    Debug: Target file (after slice): ${tasks[0].metadata.fpath_tuple.slice(1).join('/')}`,
		)
	}

	for (let i = 0; i < tasks.length; i++) {
		const task = tasks[i]
		const queryEmb = queryEmbeddings[i]

		// Get top-k chunks
		const topKResults = topK(queryEmb, chunkEmbeddings, K)

		// Determine ground truth: chunks that overlap with target location
		// fpath_tuple is ["repo_name", "path", "to", "file.py"], skip first element
		const targetFile = task.metadata.fpath_tuple.slice(1).join('/')
		const targetLines = {
			start: task.metadata.context_start_lineno,
			end: task.metadata.line_no,
		}

		// Find all chunks that are relevant (overlap with ground truth)
		const relevantChunkIds = allChunks
			.filter((c) => c.filepath === targetFile && chunksOverlap(c, targetLines))
			.map((c) => c.id)

		// Debug first query
		if (i === 0) {
			console.log(`    Debug first query:`)
			console.log(`      Target file: "${targetFile}"`)
			console.log(`      Target lines: ${targetLines.start}-${targetLines.end}`)
			console.log(`      Relevant chunks found: ${relevantChunkIds.length}`)
			console.log(
				`      Top retrieved chunk: ${allChunks[topKResults[0]?.index]?.filepath}`,
			)
		}

		const relevantSet = new Set(relevantChunkIds)

		// Get retrieved chunk IDs
		const retrievedIds = topKResults.map((r) => allChunks[r.index].id)

		// Compute metrics
		const metrics = computeMetrics(retrievedIds, relevantSet, K)

		queryResults.push({
			taskId: task.metadata.task_id,
			prompt: task.prompt.slice(0, 200) + '...', // Truncate for readability
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

	// Aggregate metrics
	const summary = aggregateMetrics(queryResults.map((q) => q.metrics))

	return {
		chunker: chunkerType,
		repo,
		summary,
		queryResults,
		config: { k: K, maxChunkSize: MAX_CHUNK_SIZE },
		timestamp: new Date().toISOString(),
	}
}

/**
 * Format metrics as a table row
 */
function formatMetrics(
	label: string,
	metrics: { precision: number; recall: number; ndcg: number },
): string {
	return `${label.padEnd(20)} | ${(metrics.ndcg * 100).toFixed(1).padStart(6)} | ${(metrics.precision * 100).toFixed(1).padStart(6)} | ${(metrics.recall * 100).toFixed(1).padStart(6)}`
}

async function main() {
	console.log('RepoEval Retrieval Evaluation')
	console.log('=============================\n')

	// Step 1: Download data if needed
	await download()

	// Step 2: Load tasks
	console.log('\nLoading tasks...')
	const allTasks = await loadTasks('2k')
	console.log(`Loaded ${allTasks.length} tasks`)

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

	for (const repo of repos) {
		const tasks = tasksByRepo.get(repo)
		if (!tasks || tasks.length === 0) {
			console.log(`\nSkipping ${repo}: no tasks found`)
			continue
		}

		console.log(`\n${'='.repeat(60)}`)
		console.log(`Repository: ${repo} (${tasks.length} tasks)`)
		console.log('='.repeat(60))

		// Evaluate with AST chunker
		const astResult = await evaluateRepo(repo, tasks, 'ast')
		allResults.push(astResult)

		// Evaluate with fixed chunker
		const fixedResult = await evaluateRepo(repo, tasks, 'fixed')
		allResults.push(fixedResult)

		// Print comparison
		console.log(`\n  Results for ${repo}:`)
		console.log('  ' + '-'.repeat(50))
		console.log(
			`  ${'Chunker'.padEnd(20)} | ${'nDCG@5'.padStart(6)} | ${'P@5'.padStart(6)} | ${'R@5'.padStart(6)}`,
		)
		console.log('  ' + '-'.repeat(50))
		console.log('  ' + formatMetrics('AST', astResult.summary))
		console.log('  ' + formatMetrics('Fixed', fixedResult.summary))
		console.log('  ' + '-'.repeat(50))
	}

	// Step 4: Compute overall summary
	console.log('\n' + '='.repeat(60))
	console.log('OVERALL SUMMARY')
	console.log('='.repeat(60))

	const astResults = allResults.filter((r) => r.chunker === 'ast')
	const fixedResults = allResults.filter((r) => r.chunker === 'fixed')

	const astOverall = aggregateMetrics(astResults.map((r) => r.summary))
	const fixedOverall = aggregateMetrics(fixedResults.map((r) => r.summary))

	console.log(
		`\n${'Chunker'.padEnd(20)} | ${'nDCG@5'.padStart(6)} | ${'P@5'.padStart(6)} | ${'R@5'.padStart(6)}`,
	)
	console.log('-'.repeat(50))
	console.log(formatMetrics('AST', astOverall))
	console.log(formatMetrics('Fixed', fixedOverall))
	console.log('-'.repeat(50))

	// Compute improvements
	const ndcgImprovement =
		((astOverall.ndcg - fixedOverall.ndcg) / fixedOverall.ndcg) * 100
	const precImprovement =
		((astOverall.precision - fixedOverall.precision) / fixedOverall.precision) *
		100
	const recallImprovement =
		((astOverall.recall - fixedOverall.recall) / fixedOverall.recall) * 100

	console.log(`\nImprovement (AST vs Fixed):`)
	console.log(
		`  nDCG@5:     ${ndcgImprovement >= 0 ? '+' : ''}${ndcgImprovement.toFixed(1)}%`,
	)
	console.log(
		`  Precision@5: ${precImprovement >= 0 ? '+' : ''}${precImprovement.toFixed(1)}%`,
	)
	console.log(
		`  Recall@5:    ${recallImprovement >= 0 ? '+' : ''}${recallImprovement.toFixed(1)}%`,
	)

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
					fixed: fixedOverall,
					improvement: {
						ndcg: ndcgImprovement,
						precision: precImprovement,
						recall: recallImprovement,
					},
				},
				perRepo: Object.fromEntries(
					repos.map((repo) => [
						repo,
						{
							ast: astResults.find((r) => r.repo === repo)?.summary,
							fixed: fixedResults.find((r) => r.repo === repo)?.summary,
						},
					]),
				),
				config: { k: K, maxChunkSize: MAX_CHUNK_SIZE },
				timestamp: new Date().toISOString(),
			},
			null,
			2,
		),
	)
	console.log(`\nSaved summary to: ${summaryPath}`)

	// Save detailed results
	const detailedPath = join(RESULTS_DIR, `detailed_${timestamp}.json`)
	await writeFile(detailedPath, JSON.stringify(allResults, null, 2))
	console.log(`Saved detailed results to: ${detailedPath}`)
}

// Run if executed directly
if (import.meta.main) {
	main().catch(console.error)
}
