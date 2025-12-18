/**
 * Download RepoEval benchmark data
 *
 * Downloads:
 * 1. Task datasets (queries, ground truth) from Microsoft CodeT repo
 * 2. Function-level Python repositories for chunking
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DATA_DIR = join(import.meta.dir, 'data', 'repoeval')
const DATASETS_DIR = join(DATA_DIR, 'datasets')
const REPOS_DIR = join(DATA_DIR, 'repositories', 'function_level')

// Function-level repositories from RepoEval
const REPOS_FUNCTION = [
	'amazon-science_patchcore-inspection',
	'deepmind_tracr',
	'facebookresearch_omnivore',
	'google_lightweight_mmm',
	'lucidrains_imagen-pytorch',
	'maxhumber_redframes',
]

async function downloadAndExtractZip(
	url: string,
	destDir: string,
): Promise<void> {
	console.log(`Downloading from ${url}...`)

	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(`Failed to download: ${response.statusText}`)
	}

	const arrayBuffer = await response.arrayBuffer()
	const tempZipPath = join(destDir, '_temp.zip')

	await mkdir(destDir, { recursive: true })
	await writeFile(tempZipPath, new Uint8Array(arrayBuffer))

	// Use unzip command
	const proc = Bun.spawn(['unzip', '-o', '-q', tempZipPath, '-d', destDir], {
		cwd: destDir,
	})
	await proc.exited

	// Clean up temp file
	await Bun.spawn(['rm', tempZipPath]).exited

	console.log(`Extracted to ${destDir}`)
}

async function downloadDatasets(): Promise<void> {
	if (existsSync(DATASETS_DIR)) {
		console.log('Datasets already downloaded, skipping...')
		return
	}

	const datasetsUrl =
		'https://github.com/microsoft/CodeT/raw/main/RepoCoder/datasets/datasets.zip'
	await downloadAndExtractZip(datasetsUrl, DATASETS_DIR)
}

async function downloadRepositories(): Promise<void> {
	if (existsSync(REPOS_DIR)) {
		console.log('Repositories already downloaded, skipping...')
		return
	}

	// Using the cleaned version from Veronicium's fork
	const reposUrl =
		'https://github.com/Veronicium/repoeval_debug/raw/main/function_level.zip'
	await downloadAndExtractZip(reposUrl, REPOS_DIR)
}

export interface RepoEvalTask {
	prompt: string
	metadata: {
		task_id: string
		ground_truth: string
		fpath_tuple: string[]
		line_no: number
		lineno: number
		context_start_lineno: number
	}
}

export async function loadTasks(
	contextLength: '1k' | '2k' | '4k' = '2k',
): Promise<RepoEvalTask[]> {
	const fileName = `function_level_completion_${contextLength}_context_codex.test.jsonl`
	const filePath = join(DATASETS_DIR, fileName)

	const content = await Bun.file(filePath).text()
	const lines = content.trim().split('\n')

	const tasks: RepoEvalTask[] = []
	const repo2idx: Record<string, number> = {}

	for (const line of lines) {
		const task = JSON.parse(line) as RepoEvalTask

		// Clean up task_id format
		const repo = task.metadata.task_id.replace('--', '_').split('/')[0]
		if (!REPOS_FUNCTION.includes(repo)) continue

		if (!(repo in repo2idx)) {
			repo2idx[repo] = 0
		}

		task.metadata.task_id = task.metadata.task_id
			.replace('--', '_')
			.replace('idx', String(repo2idx[repo]))
		task.metadata.line_no = task.metadata.lineno
		repo2idx[repo]++

		tasks.push(task)
	}

	return tasks
}

export function getReposDir(): string {
	return REPOS_DIR
}

export function getRepos(): string[] {
	return REPOS_FUNCTION
}

export async function download(): Promise<void> {
	console.log('Downloading RepoEval benchmark data...\n')

	await mkdir(DATA_DIR, { recursive: true })

	await downloadDatasets()
	await downloadRepositories()

	console.log('\nDownload complete!')
	console.log(`Data stored in: ${DATA_DIR}`)
}

// Run if executed directly
if (import.meta.main) {
	await download()
}
