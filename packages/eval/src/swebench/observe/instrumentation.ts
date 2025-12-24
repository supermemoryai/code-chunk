/**
 * Instrumentation layer: hooks + message parsing + ranking + usage dedupe
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { matchesOracle, normalizePath } from '../score'
import type { AgentVariant, Event, OracleFiles } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Event Writer (merged from events.ts)
// ─────────────────────────────────────────────────────────────────────────────

export class EventWriter {
	private filePath: string

	constructor(filePath: string) {
		this.filePath = filePath
		const dir = dirname(filePath)
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
	}

	private write(event: Event): void {
		appendFileSync(this.filePath, `${JSON.stringify(event)}\n`)
	}

	writeSessionStart(
		instanceId: string,
		agentVariant: AgentVariant,
		model: string,
		cwd: string,
		allowedTools: string[],
	): void {
		this.write({
			type: 'session_start',
			timestamp: Date.now(),
			instance_id: instanceId,
			agent_variant: agentVariant,
			model,
			cwd,
			allowed_tools: allowedTools,
		})
	}

	writeSessionEnd(
		instanceId: string,
		agentVariant: AgentVariant,
		durationMs: number,
		totalCostUsd: number,
		usage: {
			input_tokens: number
			output_tokens: number
			cache_read_input_tokens?: number
		},
		topFilesFinal: string[],
		rankedFilesFromTools: string[],
	): void {
		this.write({
			type: 'session_end',
			timestamp: Date.now(),
			instance_id: instanceId,
			agent_variant: agentVariant,
			duration_ms: durationMs,
			total_cost_usd: totalCostUsd,
			usage,
			top_files_final: topFilesFinal,
			ranked_files_from_tools: rankedFilesFromTools,
		})
	}

	writeToolCallStart(
		toolName: string,
		toolUseId: string,
		input: unknown,
	): void {
		this.write({
			type: 'tool_call',
			timestamp: Date.now(),
			tool_name: toolName,
			tool_use_id: toolUseId,
			input,
		})
	}

	writeToolCallEnd(
		toolName: string,
		toolUseId: string,
		input: unknown,
		output: unknown,
		latencyMs: number,
		outputChars: number,
	): void {
		this.write({
			type: 'tool_call',
			timestamp: Date.now(),
			tool_name: toolName,
			tool_use_id: toolUseId,
			input,
			output,
			latency_ms: latencyMs,
			output_chars: outputChars,
		})
	}

	writeToolCallError(
		toolName: string,
		toolUseId: string,
		input: unknown,
		error: string,
		latencyMs: number,
	): void {
		this.write({
			type: 'tool_call',
			timestamp: Date.now(),
			tool_name: toolName,
			tool_use_id: toolUseId,
			input,
			error,
			latency_ms: latencyMs,
		})
	}

	writeUsage(
		messageId: string,
		inputTokens: number,
		outputTokens: number,
		cacheReadInputTokens?: number,
		cacheCreationInputTokens?: number,
	): void {
		this.write({
			type: 'usage',
			timestamp: Date.now(),
			message_id: messageId,
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			cache_read_input_tokens: cacheReadInputTokens,
			cache_creation_input_tokens: cacheCreationInputTokens,
		})
	}
}

/**
 * Accumulated usage (deduplicated by message ID)
 */
interface AccumulatedUsage {
	input_tokens: number
	output_tokens: number
	cache_read_input_tokens: number
	cache_creation_input_tokens: number
}

/**
 * Tool call timing for latency tracking
 */
interface ToolCallTiming {
	startTime: number
	toolName: string
	input: unknown
}

/**
 * Run context for a single agent run
 */
export interface RunContext {
	instanceId: string
	agentVariant: AgentVariant
	worktreePath: string
	oracle: OracleFiles
	eventWriter: EventWriter

	// State
	startTime: number
	toolCallCount: number
	toolCallTimings: Map<string, ToolCallTiming> // toolUseId -> timing
	seenMessageIds: Set<string>
	accumulatedUsage: AccumulatedUsage

	// Ranked file extraction
	rankedFilesFromTools: string[] // Behavioral: first-seen order from tools
	seenFilePaths: Set<string>

	// Tool output size accounting
	toolOutputCharsByType: Record<string, number>

	// First hit tracking
	firstHitTime: number | null
	firstHitTokens: number | null
	toolUseIdToMessageId: Map<string, string> // For attribution
}

/**
 * Create a new run context
 */
export function createRunContext(
	instanceId: string,
	agentVariant: AgentVariant,
	worktreePath: string,
	oracle: OracleFiles,
	eventWriter: EventWriter,
): RunContext {
	return {
		instanceId,
		agentVariant,
		worktreePath,
		oracle,
		eventWriter,
		startTime: Date.now(),
		toolCallCount: 0,
		toolCallTimings: new Map(),
		seenMessageIds: new Set(),
		accumulatedUsage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
		},
		rankedFilesFromTools: [],
		seenFilePaths: new Set(),
		toolOutputCharsByType: {},
		firstHitTime: null,
		firstHitTokens: null,
		toolUseIdToMessageId: new Map(),
	}
}

/**
 * Extract file paths from tool output
 */
function extractFilePathsFromToolOutput(
	toolName: string,
	input: unknown,
	output: unknown,
): string[] {
	const paths: string[] = []

	// Read tool: file_path in input
	if (toolName === 'Read' && typeof input === 'object' && input !== null) {
		const readInput = input as { file_path?: string }
		if (readInput.file_path) {
			paths.push(readInput.file_path)
		}
	}

	// Grep tool: parse output for file paths
	if (toolName === 'Grep' && typeof output === 'string') {
		// Grep output format: "filepath:line:content" or just filepaths
		const lines = output.split('\n')
		for (const line of lines) {
			const match = line.match(/^([^:]+):/)
			if (match?.[1]) {
				const candidate = match[1].trim()
				// Skip if it's just a number (line number) or doesn't look like a path
				if (/^\d+$/.test(candidate)) continue
				// Must contain a path separator or file extension
				if (candidate.includes('/') || candidate.includes('.')) {
					paths.push(candidate)
				}
			}
		}
	}

	// Glob tool: output is typically a list of paths
	if (toolName === 'Glob') {
		if (typeof output === 'string') {
			const lines = output.split('\n').filter(Boolean)
			paths.push(...lines)
		} else if (Array.isArray(output)) {
			paths.push(...output.filter((p) => typeof p === 'string'))
		}
	}

	// Semantic search: results contain filepath
	// Output can be a string, or MCP format: [{type:"text", text:"..."}]
	if (toolName === 'mcp__semantic_search__search') {
		let textContent = ''

		if (typeof output === 'string') {
			textContent = output
		} else if (Array.isArray(output)) {
			// MCP response format: [{type: "text", text: "..."}]
			for (const item of output) {
				if (item && typeof item === 'object' && 'text' in item) {
					textContent += `${(item as { text: string }).text}\n`
				}
			}
		} else if (output && typeof output === 'object' && 'text' in output) {
			textContent = (output as { text: string }).text
		}

		if (textContent) {
			// Extract file paths from structured __FILES__ block (added by semantic_search_tool.ts)
			const filesMatch = textContent.match(
				/__FILES__\n([\s\S]*?)\n__END_FILES__/,
			)
			if (filesMatch?.[1]) {
				const files = filesMatch[1].split('\n').filter(Boolean)
				paths.push(...files)
			}
		}
	}

	return paths
}

/**
 * Strip the worktree prefix from an absolute path to get repo-relative path
 */
function stripWorktreePrefix(path: string, worktreePath: string): string {
	// Normalize both paths for comparison
	const normalizedWorktree = `${worktreePath.replace(/\/+$/, '')}/`

	if (path.startsWith(normalizedWorktree)) {
		return path.slice(normalizedWorktree.length)
	}

	// Also handle URL-decoded paths (spaces vs %20)
	const decodedPath = decodeURIComponent(path)
	if (decodedPath.startsWith(normalizedWorktree)) {
		return decodedPath.slice(normalizedWorktree.length)
	}

	return path
}

/**
 * Record file paths from tool output and check for oracle hits
 */
export function recordFilePathsFromTool(
	ctx: RunContext,
	toolName: string,
	_toolUseId: string,
	input: unknown,
	output: unknown,
): void {
	const paths = extractFilePathsFromToolOutput(toolName, input, output)

	for (const rawPath of paths) {
		// First strip the worktree prefix to get repo-relative path
		const relativePath = stripWorktreePrefix(rawPath, ctx.worktreePath)
		const normalized = normalizePath(relativePath)
		if (!ctx.seenFilePaths.has(normalized)) {
			ctx.seenFilePaths.add(normalized)
			ctx.rankedFilesFromTools.push(normalized)

			// Check for first hit
			if (ctx.firstHitTime === null && matchesOracle(normalized, ctx.oracle)) {
				ctx.firstHitTime = Date.now() - ctx.startTime
				// Tokens to first hit: sum usage up to the message that spawned this tool
				// We can't perfectly compute this without tracking per-message, so we use accumulated
				ctx.firstHitTokens =
					ctx.accumulatedUsage.input_tokens + ctx.accumulatedUsage.output_tokens
			}
		}
	}
}

/**
 * Pre-tool-use hook handler
 */
export function onPreToolUse(
	ctx: RunContext,
	toolName: string,
	toolUseId: string,
	input: unknown,
): void {
	ctx.toolCallCount++
	ctx.toolCallTimings.set(toolUseId, {
		startTime: Date.now(),
		toolName,
		input,
	})

	ctx.eventWriter.writeToolCallStart(toolName, toolUseId, input)
}

/**
 * Post-tool-use hook handler
 */
export function onPostToolUse(
	ctx: RunContext,
	toolName: string,
	toolUseId: string,
	input: unknown,
	output: unknown,
): void {
	const timing = ctx.toolCallTimings.get(toolUseId)
	const latencyMs = timing ? Date.now() - timing.startTime : 0

	// Serialize output for size accounting
	const outputStr = typeof output === 'string' ? output : JSON.stringify(output)
	const outputChars = outputStr.length

	// Accumulate tool output chars by type
	ctx.toolOutputCharsByType[toolName] =
		(ctx.toolOutputCharsByType[toolName] || 0) + outputChars

	ctx.eventWriter.writeToolCallEnd(
		toolName,
		toolUseId,
		input,
		output,
		latencyMs,
		outputChars,
	)

	// Extract and record file paths
	recordFilePathsFromTool(ctx, toolName, toolUseId, input, output)

	ctx.toolCallTimings.delete(toolUseId)
}

/**
 * Post-tool-use-failure hook handler
 */
export function onPostToolUseFailure(
	ctx: RunContext,
	toolName: string,
	toolUseId: string,
	input: unknown,
	error: string,
): void {
	const timing = ctx.toolCallTimings.get(toolUseId)
	const latencyMs = timing ? Date.now() - timing.startTime : 0

	ctx.eventWriter.writeToolCallError(
		toolName,
		toolUseId,
		input,
		error,
		latencyMs,
	)
	ctx.toolCallTimings.delete(toolUseId)
}

/**
 * Process an assistant message to extract tool_use blocks and usage
 */
export function processAssistantMessage(
	ctx: RunContext,
	message: {
		id?: string
		content?: unknown
		usage?: {
			input_tokens?: number
			output_tokens?: number
			cache_read_input_tokens?: number
			cache_creation_input_tokens?: number
		}
	},
): void {
	const messageId = message.id
	if (!messageId) return

	// Dedupe usage by message ID
	if (!ctx.seenMessageIds.has(messageId)) {
		ctx.seenMessageIds.add(messageId)

		if (message.usage) {
			const usage = message.usage
			ctx.accumulatedUsage.input_tokens += usage.input_tokens || 0
			ctx.accumulatedUsage.output_tokens += usage.output_tokens || 0
			ctx.accumulatedUsage.cache_read_input_tokens +=
				usage.cache_read_input_tokens || 0
			ctx.accumulatedUsage.cache_creation_input_tokens +=
				usage.cache_creation_input_tokens || 0

			ctx.eventWriter.writeUsage(
				messageId,
				usage.input_tokens || 0,
				usage.output_tokens || 0,
				usage.cache_read_input_tokens,
				usage.cache_creation_input_tokens,
			)
		}
	}

	// Build toolUseId -> messageId mapping from content blocks
	if (Array.isArray(message.content)) {
		for (const block of message.content) {
			if (block && typeof block === 'object' && 'type' in block) {
				if (block.type === 'tool_use' && 'id' in block) {
					ctx.toolUseIdToMessageId.set(block.id as string, messageId)
				}
			}
		}
	}
}

/**
 * Get total tool output chars
 */
export function getTotalToolOutputChars(ctx: RunContext): number {
	return Object.values(ctx.toolOutputCharsByType).reduce((a, b) => a + b, 0)
}
