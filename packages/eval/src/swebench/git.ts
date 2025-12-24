/**
 * Git repository manager: bare clones + worktrees for reproducible checkout
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { WorktreeInfo } from './types'

// Cache directory for bare clones (relative to package root)
const REPOS_CACHE_DIR = join(
	dirname(dirname(decodeURIComponent(new URL(import.meta.url).pathname))),
	'data',
	'repos',
)

// Worktrees directory
const WORKTREES_DIR = join(
	dirname(dirname(decodeURIComponent(new URL(import.meta.url).pathname))),
	'data',
	'worktrees',
)

/**
 * Ensure directory exists
 */
function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}
}

/**
 * Run a git command and return stdout
 */
function git(args: string[], cwd?: string): string {
	const result = spawnSync('git', args, {
		cwd,
		encoding: 'utf-8',
		maxBuffer: 50 * 1024 * 1024, // 50MB
	})

	if (result.status !== 0) {
		throw new Error(
			`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`,
		)
	}

	return result.stdout.trim()
}

/**
 * Get the bare clone path for a repo
 * e.g. "django/django" -> "/path/to/repos/django__django.git"
 */
function getBareClonePath(repo: string): string {
	const safeName = `${repo.replace(/\//g, '__')}.git`
	return join(REPOS_CACHE_DIR, safeName)
}

/**
 * Get the worktree path for an instance
 */
function getWorktreePath(instanceId: string): string {
	const safeName = instanceId.replace(/[^a-zA-Z0-9_-]/g, '_')
	return join(WORKTREES_DIR, safeName)
}

/**
 * Ensure a bare clone exists for a repo, or create/update it
 */
async function ensureBareClone(repo: string): Promise<string> {
	ensureDir(REPOS_CACHE_DIR)
	const barePath = getBareClonePath(repo)

	if (existsSync(barePath)) {
		// Fetch latest
		console.log(`[git] Fetching updates for ${repo}...`)
		try {
			git(['fetch', '--all', '--prune'], barePath)
		} catch (err) {
			console.warn(`[git] Fetch failed, will continue with existing: ${err}`)
		}
	} else {
		// Clone bare
		const url = `https://github.com/${repo}.git`
		console.log(`[git] Cloning bare ${repo} from ${url}...`)
		git(['clone', '--bare', url, barePath])
	}

	return barePath
}

/**
 * Create a worktree at a specific commit
 */
export async function createWorktree(
	repo: string,
	commit: string,
	instanceId: string,
): Promise<WorktreeInfo> {
	const startTime = Date.now()

	// Ensure bare clone exists
	const barePath = await ensureBareClone(repo)

	// Get worktree path
	ensureDir(WORKTREES_DIR)
	const worktreePath = getWorktreePath(instanceId)

	// Remove existing worktree if it exists
	if (existsSync(worktreePath)) {
		console.log(`[git] Removing existing worktree at ${worktreePath}...`)
		try {
			git(['worktree', 'remove', '--force', worktreePath], barePath)
		} catch {
			// Force remove directory if git worktree remove fails
			rmSync(worktreePath, { recursive: true, force: true })
		}
	}

	// Create worktree
	console.log(
		`[git] Creating worktree for ${instanceId} at commit ${commit}...`,
	)
	git(['worktree', 'add', '--detach', worktreePath, commit], barePath)

	// Verify the commit
	const resolvedCommit = git(['rev-parse', 'HEAD'], worktreePath)

	const checkoutMs = Date.now() - startTime
	console.log(
		`[git] Worktree created at ${worktreePath} (commit: ${resolvedCommit}, took ${checkoutMs}ms)`,
	)

	return {
		path: worktreePath,
		commit: resolvedCommit,
		checkout_ms: checkoutMs,
	}
}

/**
 * Remove a worktree
 */
export async function removeWorktree(
	repo: string,
	instanceId: string,
): Promise<void> {
	const barePath = getBareClonePath(repo)
	const worktreePath = getWorktreePath(instanceId)

	if (!existsSync(worktreePath)) {
		return
	}

	console.log(`[git] Removing worktree at ${worktreePath}...`)
	try {
		git(['worktree', 'remove', '--force', worktreePath], barePath)
	} catch {
		// Force remove directory if git worktree remove fails
		rmSync(worktreePath, { recursive: true, force: true })
	}
}

/**
 * List all files in a worktree (for indexing)
 */
export function listFiles(
	worktreePath: string,
	extensions?: string[],
): string[] {
	let files: string[]

	try {
		// Use git ls-files for tracked files
		const output = git(['ls-files'], worktreePath)
		files = output.split('\n').filter(Boolean)
	} catch {
		// Fallback: use find
		const result = spawnSync('find', ['.', '-type', 'f', '-name', '*.*'], {
			cwd: worktreePath,
			encoding: 'utf-8',
			maxBuffer: 50 * 1024 * 1024,
		})
		files = result.stdout
			.split('\n')
			.filter(Boolean)
			.map((f) => f.replace(/^\.\//, ''))
	}

	// Filter by extensions if provided
	if (extensions && extensions.length > 0) {
		const extSet = new Set(
			extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)),
		)
		files = files.filter((f) => {
			const ext = f.slice(f.lastIndexOf('.'))
			return extSet.has(ext)
		})
	}

	return files
}
