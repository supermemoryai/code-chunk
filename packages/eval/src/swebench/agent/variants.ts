/**
 * Agent variant definitions for retrieval-only evaluation
 */

import type { AgentVariant } from '../types'

/**
 * Configuration for an agent variant
 */
export interface AgentConfig {
	variant: AgentVariant
	tools: string[]
	allowedTools: string[]
	maxTurns: number
	maxToolCalls: number
}

/**
 * Agent1: Ops-only (Read/Grep/Glob)
 */
export const AGENT1_CONFIG: AgentConfig = {
	variant: 'ops-only',
	tools: ['Read', 'Grep', 'Glob'],
	allowedTools: ['Read', 'Grep', 'Glob'],
	maxTurns: 20,
	maxToolCalls: 50,
}

/**
 * Agent2: Ops + Semantic Search
 * Includes the custom semantic search tool exposed as MCP tool
 */
export const AGENT2_CONFIG: AgentConfig = {
	variant: 'ops-plus-search',
	tools: ['Read', 'Grep', 'Glob'],
	allowedTools: [
		'Read',
		'Grep',
		'Glob',
		'mcp__semantic_search__search', // Custom MCP tool
	],
	maxTurns: 20,
	maxToolCalls: 50,
}

/**
 * Tools that are explicitly denied (for logging/enforcement)
 */
export const DENIED_TOOLS = [
	'Write',
	'Edit',
	'Bash',
	'WebFetch',
	'TodoRead',
	'TodoWrite',
	'NotebookRead',
	'NotebookEdit',
]

/**
 * Get agent config by variant
 */
export function getAgentConfig(variant: AgentVariant): AgentConfig {
	return variant === 'ops-only' ? AGENT1_CONFIG : AGENT2_CONFIG
}

/**
 * Check if a tool is allowed for a variant
 */
export function isToolAllowed(
	toolName: string,
	config: AgentConfig,
	toolCallCount: number,
): { allowed: boolean; reason?: string } {
	// Check tool budget
	if (toolCallCount >= config.maxToolCalls) {
		return { allowed: false, reason: 'Tool budget exceeded' }
	}

	// Check if tool is explicitly allowed
	if (config.allowedTools.includes(toolName)) {
		return { allowed: true }
	}

	// Check if tool is explicitly denied
	if (DENIED_TOOLS.includes(toolName)) {
		return { allowed: false, reason: 'Tool is denied for retrieval-only mode' }
	}

	// Default: deny unknown tools
	return { allowed: false, reason: 'Tool not in allowlist' }
}
