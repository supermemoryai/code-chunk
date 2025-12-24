/**
 * Core types for SWE-bench Lite retrieval-only evaluation
 */

/**
 * SWE-bench Lite instance (only fields needed for retrieval-only)
 */
export interface SWEbenchInstance {
	instance_id: string
	repo: string // e.g. "django/django"
	base_commit: string
	problem_statement: string
	patch: string // unified diff
	test_patch?: string // optional, for secondary reporting
}

/**
 * Parsed oracle: ground-truth file paths from the gold patch
 */
export interface OracleFiles {
	instance_id: string
	files: Set<string> // normalized repo-relative paths
}

/**
 * Worktree checkout result
 */
export interface WorktreeInfo {
	path: string
	commit: string
	checkout_ms: number
}

/**
 * Agent variant identifier
 */
export type AgentVariant = 'ops-only' | 'ops-plus-search'

/**
 * Semantic search result from the custom tool
 */
export interface SemanticSearchResult {
	filepath: string
	start_line?: number
	end_line?: number
	score: number
	snippet?: string
}

/**
 * Per-tool-call event (logged in events.jsonl)
 */
export interface ToolCallEvent {
	type: 'tool_call'
	timestamp: number
	tool_name: string
	tool_use_id: string
	input: unknown
	output?: unknown
	error?: string
	latency_ms?: number
	output_chars?: number
}

/**
 * LLM usage event (logged in events.jsonl)
 */
export interface UsageEvent {
	type: 'usage'
	timestamp: number
	message_id: string
	input_tokens: number
	output_tokens: number
	cache_read_input_tokens?: number
	cache_creation_input_tokens?: number
}

/**
 * Session start event
 */
export interface SessionStartEvent {
	type: 'session_start'
	timestamp: number
	instance_id: string
	agent_variant: AgentVariant
	model: string
	cwd: string
	allowed_tools: string[]
}

/**
 * Session end event
 */
export interface SessionEndEvent {
	type: 'session_end'
	timestamp: number
	instance_id: string
	agent_variant: AgentVariant
	duration_ms: number
	total_cost_usd: number
	usage: {
		input_tokens: number
		output_tokens: number
		cache_read_input_tokens?: number
	}
	top_files_final: string[] // declared from agent JSON output
	ranked_files_from_tools: string[] // behavioral from tool traces
}

/**
 * Union of all event types
 */
export type Event =
	| ToolCallEvent
	| UsageEvent
	| SessionStartEvent
	| SessionEndEvent

/**
 * Per-instance per-agent metrics (one row in metrics.jsonl)
 */
export interface InstanceMetrics {
	instance_id: string
	agent_variant: AgentVariant
	oracle_files: string[]

	// Quality metrics (behavioral ranking)
	hit_at_1_behavioral: boolean
	hit_at_3_behavioral: boolean
	hit_at_5_behavioral: boolean
	hit_at_10_behavioral: boolean
	mrr_behavioral: number
	coverage_at_5_behavioral: number
	coverage_at_10_behavioral: number

	// Quality metrics (declared ranking)
	hit_at_1_declared: boolean
	hit_at_3_declared: boolean
	hit_at_5_declared: boolean
	hit_at_10_declared: boolean
	mrr_declared: number
	coverage_at_5_declared: number
	coverage_at_10_declared: number

	// Time/tokens to first hit
	time_to_first_hit_ms: number | null
	tokens_to_first_hit: number | null

	// Efficiency metrics
	total_duration_ms: number
	total_cost_usd: number
	total_input_tokens: number
	total_output_tokens: number
	tool_calls_count: number
	semantic_search_calls?: number

	// Embedding metrics (Agent2 only)
	embed_latency_ms?: number
	embed_tokens?: number
	embed_cost_usd?: number

	// Tool output size accounting
	tool_output_chars_total: number
	tool_output_chars_by_type: Record<string, number>

	// Rankings
	top_files_final: string[]
	ranked_files_from_tools: string[]
}

/**
 * Aggregate summary across all instances
 */
export interface AggregateSummary {
	split: string
	total_instances: number
	agent_summaries: {
		agent_variant: AgentVariant
		// Quality rates
		hit_at_1_rate: number
		hit_at_3_rate: number
		hit_at_5_rate: number
		hit_at_10_rate: number
		mean_mrr: number
		mean_coverage_at_5: number
		mean_coverage_at_10: number
		// Totals (sum across all instances) - for cost tracking
		total_duration_ms: number
		total_tokens: number
		total_input_tokens: number
		total_output_tokens: number
		total_cost_usd: number
		total_tool_calls: number
		// Medians (for multi-instance benchmarks)
		median_duration_ms: number
		p90_duration_ms: number
		median_tokens: number
		p90_tokens: number
		median_time_to_first_hit_ms: number | null
		median_tokens_to_first_hit: number | null
	}[]
	delta: {
		hit_at_1_delta: number
		hit_at_3_delta: number
		hit_at_5_delta: number
		mrr_delta: number
		duration_ms_delta: number
		tokens_delta: number
		cost_usd_delta: number
	}
}
