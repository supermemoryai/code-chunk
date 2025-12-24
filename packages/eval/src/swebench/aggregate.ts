/**
 * Aggregate metrics across all instances for summary reporting
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AgentVariant, AggregateSummary, InstanceMetrics } from './types'

/**
 * Load metrics from JSONL file
 */
export function loadMetrics(filePath: string): InstanceMetrics[] {
	const content = readFileSync(filePath, 'utf-8')
	return content
		.trim()
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as InstanceMetrics)
}

/**
 * Compute percentile
 */
function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const idx = Math.ceil((p / 100) * sorted.length) - 1
	return sorted[Math.max(0, idx)]!
}

/**
 * Compute mean
 */
function mean(values: number[]): number {
	if (values.length === 0) return 0
	return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Compute median
 */
function median(values: number[]): number {
	return percentile(values, 50)
}

/**
 * Filter values, removing nulls
 */
function filterNulls(values: (number | null)[]): number[] {
	return values.filter((v): v is number => v !== null)
}

/**
 * Sum helper
 */
function sum(values: number[]): number {
	return values.reduce((a, b) => a + b, 0)
}

/**
 * Aggregate metrics for a single agent variant
 */
function aggregateForVariant(
	metrics: InstanceMetrics[],
	variant: AgentVariant,
): AggregateSummary['agent_summaries'][0] {
	const variantMetrics = metrics.filter((m) => m.agent_variant === variant)
	const n = variantMetrics.length

	if (n === 0) {
		return {
			agent_variant: variant,
			hit_at_1_rate: 0,
			hit_at_3_rate: 0,
			hit_at_5_rate: 0,
			hit_at_10_rate: 0,
			mean_mrr: 0,
			mean_coverage_at_5: 0,
			mean_coverage_at_10: 0,
			total_duration_ms: 0,
			total_tokens: 0,
			total_input_tokens: 0,
			total_output_tokens: 0,
			total_cost_usd: 0,
			total_tool_calls: 0,
			median_duration_ms: 0,
			p90_duration_ms: 0,
			median_tokens: 0,
			p90_tokens: 0,
			median_time_to_first_hit_ms: null,
			median_tokens_to_first_hit: null,
		}
	}

	// Hit rates (using behavioral ranking)
	const hit1 = variantMetrics.filter((m) => m.hit_at_1_behavioral).length / n
	const hit3 = variantMetrics.filter((m) => m.hit_at_3_behavioral).length / n
	const hit5 = variantMetrics.filter((m) => m.hit_at_5_behavioral).length / n
	const hit10 = variantMetrics.filter((m) => m.hit_at_10_behavioral).length / n

	// MRR and coverage
	const mrrValues = variantMetrics.map((m) => m.mrr_behavioral)
	const cov5Values = variantMetrics.map((m) => m.coverage_at_5_behavioral)
	const cov10Values = variantMetrics.map((m) => m.coverage_at_10_behavioral)

	// Duration and tokens
	const durations = variantMetrics.map((m) => m.total_duration_ms)
	const inputTokens = variantMetrics.map((m) => m.total_input_tokens)
	const outputTokens = variantMetrics.map((m) => m.total_output_tokens)
	const tokens = variantMetrics.map(
		(m) => m.total_input_tokens + m.total_output_tokens,
	)
	const costs = variantMetrics.map((m) => m.total_cost_usd)
	const toolCalls = variantMetrics.map((m) => m.tool_calls_count)

	// Time/tokens to first hit
	const timesToHit = filterNulls(
		variantMetrics.map((m) => m.time_to_first_hit_ms),
	)
	const tokensToHit = filterNulls(
		variantMetrics.map((m) => m.tokens_to_first_hit),
	)

	return {
		agent_variant: variant,
		hit_at_1_rate: hit1,
		hit_at_3_rate: hit3,
		hit_at_5_rate: hit5,
		hit_at_10_rate: hit10,
		mean_mrr: mean(mrrValues),
		mean_coverage_at_5: mean(cov5Values),
		mean_coverage_at_10: mean(cov10Values),
		// Totals
		total_duration_ms: sum(durations),
		total_tokens: sum(tokens),
		total_input_tokens: sum(inputTokens),
		total_output_tokens: sum(outputTokens),
		total_cost_usd: sum(costs),
		total_tool_calls: sum(toolCalls),
		// Medians
		median_duration_ms: median(durations),
		p90_duration_ms: percentile(durations, 90),
		median_tokens: median(tokens),
		p90_tokens: percentile(tokens, 90),
		median_time_to_first_hit_ms:
			timesToHit.length > 0 ? median(timesToHit) : null,
		median_tokens_to_first_hit:
			tokensToHit.length > 0 ? median(tokensToHit) : null,
	}
}

/**
 * Aggregate all metrics into a summary
 */
export function aggregateMetrics(
	metrics: InstanceMetrics[],
	split: string,
): AggregateSummary {
	const opsOnly = aggregateForVariant(metrics, 'ops-only')
	const opsPlusSearch = aggregateForVariant(metrics, 'ops-plus-search')

	// Compute deltas (Agent2 - Agent1) - use totals for cost comparison
	const delta = {
		hit_at_1_delta: opsPlusSearch.hit_at_1_rate - opsOnly.hit_at_1_rate,
		hit_at_3_delta: opsPlusSearch.hit_at_3_rate - opsOnly.hit_at_3_rate,
		hit_at_5_delta: opsPlusSearch.hit_at_5_rate - opsOnly.hit_at_5_rate,
		mrr_delta: opsPlusSearch.mean_mrr - opsOnly.mean_mrr,
		duration_ms_delta:
			opsPlusSearch.total_duration_ms - opsOnly.total_duration_ms,
		tokens_delta: opsPlusSearch.total_tokens - opsOnly.total_tokens,
		cost_usd_delta: opsPlusSearch.total_cost_usd - opsOnly.total_cost_usd,
	}

	return {
		split,
		total_instances: new Set(metrics.map((m) => m.instance_id)).size,
		agent_summaries: [opsOnly, opsPlusSearch],
		delta,
	}
}

/**
 * Write summary to JSON file
 */
export function writeSummary(
	filePath: string,
	summary: AggregateSummary,
): void {
	const dir = dirname(filePath)
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true })
	}

	writeFileSync(filePath, JSON.stringify(summary, null, 2))
}

/**
 * Format duration nicely
 */
function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)}ms`
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
	return `${(ms / 60000).toFixed(1)}m`
}

/**
 * Format token count nicely
 */
function formatTokens(tokens: number): string {
	if (tokens < 1000) return `${tokens}`
	if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`
	return `${(tokens / 1000000).toFixed(2)}M`
}

/**
 * Print summary to console
 */
export function printSummary(summary: AggregateSummary): void {
	const W = 70 // Total box width
	const line = '='.repeat(W - 2)

	console.log(`\n+${line}+`)
	console.log(
		'|' +
			`  SWE-bench Lite Retrieval Evaluation Summary (${summary.split})`.padEnd(
				W - 2,
			) +
			'|',
	)
	console.log(`+${line}+`)
	console.log(
		`|${`  Total instances: ${summary.total_instances}`.padEnd(W - 2)}|`,
	)
	console.log(`+${line}+\n`)

	for (const agent of summary.agent_summaries) {
		const title = ` ${agent.agent_variant.toUpperCase()} `
		const titlePad = Math.floor((W - 2 - title.length) / 2)
		const header =
			'='.repeat(titlePad) + title + '='.repeat(W - 2 - titlePad - title.length)

		console.log(`+${header}+`)

		// Quality metrics
		console.log(`${'| QUALITY'.padEnd(W - 1)}|`)
		const h1 = `${(agent.hit_at_1_rate * 100).toFixed(1)}%`.padStart(6)
		const h3 = `${(agent.hit_at_3_rate * 100).toFixed(1)}%`.padStart(6)
		const h5 = `${(agent.hit_at_5_rate * 100).toFixed(1)}%`.padStart(6)
		const h10 = `${(agent.hit_at_10_rate * 100).toFixed(1)}%`.padStart(6)
		console.log(
			`|   Hit@1:${h1}  Hit@3:${h3}  Hit@5:${h5}  Hit@10:${h10}`.padEnd(W - 1) +
				'|',
		)
		console.log(
			`${`|   MRR: ${agent.mean_mrr.toFixed(3)}   Coverage@5: ${(agent.mean_coverage_at_5 * 100).toFixed(1)}%   Coverage@10: ${(agent.mean_coverage_at_10 * 100).toFixed(1)}%`.padEnd(
				W - 1,
			)}|`,
		)

		// Totals
		console.log(`${'| TOTALS'.padEnd(W - 1)}|`)
		const dur = formatDuration(agent.total_duration_ms).padStart(8)
		const tok = formatTokens(agent.total_tokens).padStart(7)
		const tokIn = formatTokens(agent.total_input_tokens)
		const tokOut = formatTokens(agent.total_output_tokens)
		console.log(
			`${`|   Duration:${dur}   Tokens:${tok} (in: ${tokIn}, out: ${tokOut})`.padEnd(
				W - 1,
			)}|`,
		)
		const cost = agent.total_cost_usd.toFixed(4).padStart(8)
		console.log(
			`${`|   Cost: $${cost}   Tool calls: ${agent.total_tool_calls}`.padEnd(
				W - 1,
			)}|`,
		)

		// First hit metrics
		if (agent.median_time_to_first_hit_ms !== null) {
			console.log(`${'| FIRST HIT'.padEnd(W - 1)}|`)
			console.log(
				`${`|   Time: ${formatDuration(agent.median_time_to_first_hit_ms)}   Tokens: ${agent.median_tokens_to_first_hit ?? 'N/A'}`.padEnd(
					W - 1,
				)}|`,
			)
		}

		console.log(`+${line}+\n`)
	}

	// Delta comparison
	console.log(`+${'-'.repeat(W - 2)}+`)
	console.log(`|${' DELTA (ops-plus-search minus ops-only)'.padEnd(W - 2)}|`)
	console.log(`+${'-'.repeat(W - 2)}+`)
	const d1 = `${(summary.delta.hit_at_1_delta * 100) >= 0 ? '+' : ''}${(summary.delta.hit_at_1_delta * 100).toFixed(1)}%`
	const dMrr = `${summary.delta.mrr_delta >= 0 ? '+' : ''}${summary.delta.mrr_delta.toFixed(3)}`
	console.log(
		`${`|   Quality:  Hit@1 ${d1.padStart(7)}   MRR ${dMrr.padStart(7)}`.padEnd(
			W - 1,
		)}|`,
	)
	const dTok = `${summary.delta.tokens_delta >= 0 ? '+' : ''}${formatTokens(summary.delta.tokens_delta)}`
	const dCost = `${summary.delta.cost_usd_delta >= 0 ? '+' : ''}$${summary.delta.cost_usd_delta.toFixed(4)}`
	console.log(
		`${`|   Cost:     ${dTok.padStart(8)} tokens   ${dCost.padStart(10)}`.padEnd(
			W - 1,
		)}|`,
	)
	const dDur = `${summary.delta.duration_ms_delta >= 0 ? '+' : ''}${formatDuration(summary.delta.duration_ms_delta)}`
	console.log(`${`|   Duration: ${dDur.padStart(8)}`.padEnd(W - 1)}|`)
	console.log(`+${'-'.repeat(W - 2)}+\n`)
}
