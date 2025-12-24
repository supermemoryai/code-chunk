/**
 * Scoring functions for retrieval quality metrics
 * Includes oracle extraction and path normalization (merged from oracle.ts)
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RunContext } from './observe/instrumentation'
import { getTotalToolOutputChars } from './observe/instrumentation'
import type { InstanceMetrics, OracleFiles, SWEbenchInstance } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Oracle extraction (merged from oracle.ts)
// ─────────────────────────────────────────────────────────────────────────────

const DIFF_HEADER_RE = /^diff --git a\/(.*?) b\/(.*)$/gm

/** Normalize a file path: strip leading ./ or /, collapse slashes */
export function normalizePath(path: string): string {
	let n = path.trim()
	while (n.startsWith('./')) n = n.slice(2)
	while (n.startsWith('/')) n = n.slice(1)
	n = n.replace(/\/+/g, '/')
	while (n.endsWith('/')) n = n.slice(0, -1)
	return n
}

/** Extract file paths from unified diff patch */
function extractFilesFromPatch(patch: string): Set<string> {
	const files = new Set<string>()
	let match = DIFF_HEADER_RE.exec(patch)
	while (match !== null) {
		const bPath = match[2]!
		if (bPath !== '/dev/null' && bPath !== 'dev/null') {
			const normalized = normalizePath(bPath)
			if (normalized) files.add(normalized)
		}
		match = DIFF_HEADER_RE.exec(patch)
	}
	DIFF_HEADER_RE.lastIndex = 0
	return files
}

/** Extract oracle files from a SWE-bench instance */
export function extractOracle(
	instance: SWEbenchInstance,
	includeTestPatch = false,
): OracleFiles {
	const files = extractFilesFromPatch(instance.patch)
	if (includeTestPatch && instance.test_patch) {
		for (const f of extractFilesFromPatch(instance.test_patch)) files.add(f)
	}
	return { instance_id: instance.instance_id, files }
}

/** Check if a candidate path matches any oracle file */
export function matchesOracle(
	candidatePath: string,
	oracle: OracleFiles,
): boolean {
	return oracle.files.has(normalizePath(candidatePath))
}

// ─────────────────────────────────────────────────────────────────────────────
// Ranking metrics
// ─────────────────────────────────────────────────────────────────────────────

function hitAtK(
	rankedFiles: string[],
	oracle: OracleFiles,
	k: number,
): boolean {
	return rankedFiles.slice(0, k).some((f) => matchesOracle(f, oracle))
}

function reciprocalRank(rankedFiles: string[], oracle: OracleFiles): number {
	for (let i = 0; i < rankedFiles.length; i++) {
		if (matchesOracle(rankedFiles[i]!, oracle)) return 1 / (i + 1)
	}
	return 0
}

function coverageAtK(
	rankedFiles: string[],
	oracle: OracleFiles,
	k: number,
): number {
	if (oracle.files.size === 0) return 1
	const topK = new Set(rankedFiles.slice(0, k).map(normalizePath))
	let hits = 0
	for (const f of oracle.files) if (topK.has(f)) hits++
	return hits / oracle.files.size
}

// ─────────────────────────────────────────────────────────────────────────────
// Instance metrics computation
// ─────────────────────────────────────────────────────────────────────────────

/** Compute all metrics for a single run */
export function computeInstanceMetrics(
	ctx: RunContext,
	topFilesFinal: string[],
	totalDurationMs: number,
	totalCostUsd: number,
	semanticSearchMetrics?: {
		callCount: number
		totalQueryEmbedTokens: number
		totalQueryEmbedLatencyMs: number
		indexEmbedTokens: number
		indexLoadMs: number
	},
): InstanceMetrics {
	const oracle = ctx.oracle
	const rankedBehavioral = ctx.rankedFilesFromTools
	const rankedDeclared = topFilesFinal

	return {
		instance_id: ctx.instanceId,
		agent_variant: ctx.agentVariant,
		oracle_files: Array.from(oracle.files),

		// Quality metrics (behavioral ranking)
		hit_at_1_behavioral: hitAtK(rankedBehavioral, oracle, 1),
		hit_at_3_behavioral: hitAtK(rankedBehavioral, oracle, 3),
		hit_at_5_behavioral: hitAtK(rankedBehavioral, oracle, 5),
		hit_at_10_behavioral: hitAtK(rankedBehavioral, oracle, 10),
		mrr_behavioral: reciprocalRank(rankedBehavioral, oracle),
		coverage_at_5_behavioral: coverageAtK(rankedBehavioral, oracle, 5),
		coverage_at_10_behavioral: coverageAtK(rankedBehavioral, oracle, 10),

		// Quality metrics (declared ranking)
		hit_at_1_declared: hitAtK(rankedDeclared, oracle, 1),
		hit_at_3_declared: hitAtK(rankedDeclared, oracle, 3),
		hit_at_5_declared: hitAtK(rankedDeclared, oracle, 5),
		hit_at_10_declared: hitAtK(rankedDeclared, oracle, 10),
		mrr_declared: reciprocalRank(rankedDeclared, oracle),
		coverage_at_5_declared: coverageAtK(rankedDeclared, oracle, 5),
		coverage_at_10_declared: coverageAtK(rankedDeclared, oracle, 10),

		// Time/tokens to first hit
		time_to_first_hit_ms: ctx.firstHitTime,
		tokens_to_first_hit: ctx.firstHitTokens,

		// Efficiency metrics
		total_duration_ms: totalDurationMs,
		total_cost_usd: totalCostUsd,
		total_input_tokens: ctx.accumulatedUsage.input_tokens,
		total_output_tokens: ctx.accumulatedUsage.output_tokens,
		tool_calls_count: ctx.toolCallCount,

		// Semantic search specific (Agent2 only)
		semantic_search_calls: semanticSearchMetrics?.callCount,
		embed_latency_ms: semanticSearchMetrics
			? semanticSearchMetrics.totalQueryEmbedLatencyMs +
				semanticSearchMetrics.indexLoadMs
			: undefined,
		embed_tokens: semanticSearchMetrics
			? semanticSearchMetrics.totalQueryEmbedTokens +
				semanticSearchMetrics.indexEmbedTokens
			: undefined,
		embed_cost_usd: semanticSearchMetrics
			? ((semanticSearchMetrics.totalQueryEmbedTokens +
					semanticSearchMetrics.indexEmbedTokens) /
					1000) *
				0.00002
			: undefined,

		// Tool output size accounting
		tool_output_chars_total: getTotalToolOutputChars(ctx),
		tool_output_chars_by_type: { ...ctx.toolOutputCharsByType },

		// Rankings
		top_files_final: topFilesFinal,
		ranked_files_from_tools: rankedBehavioral,
	}
}

/** Write metrics to JSONL file */
export function writeMetrics(filePath: string, metrics: InstanceMetrics): void {
	const dir = dirname(filePath)
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
	appendFileSync(filePath, `${JSON.stringify(metrics)}\n`)
}
