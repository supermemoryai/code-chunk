/**
 * SWE-bench Lite retrieval-only evaluation runner
 * Main runner loop that orchestrates the evaluation
 */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
	createUserPrompt,
	parseTopFiles,
	RETRIEVAL_ONLY_SYSTEM_PROMPT,
	RETRIEVAL_WITH_SEARCH_SYSTEM_PROMPT,
} from './agent/prompts'
import {
	createSemanticSearchMetrics,
	createSemanticSearchServer,
	GeminiEmbeddingService,
	SemanticSearchIndex,
} from './agent/semantic_search_adapter'
import { getAgentConfig } from './agent/variants'
import { aggregateMetrics, printSummary, writeSummary } from './aggregate'
import { loadSWEbenchLite } from './dataset'
import { createWorktree, listFiles, removeWorktree } from './git'
import {
	createRunContext,
	EventWriter,
	onPostToolUse,
	onPreToolUse,
	processAssistantMessage,
} from './observe/instrumentation'
import { computeInstanceMetrics, extractOracle, writeMetrics } from './score'
import type { AgentVariant, InstanceMetrics, SWEbenchInstance } from './types'

/**
 * Configuration for the evaluation run
 */
export interface RunConfig {
	split?: 'dev' | 'test'
	maxInstances?: number
	maxTurns?: number
	maxToolCalls?: number
	model?: string
	runDir?: string
	skipAgent1?: boolean
	skipAgent2?: boolean
	instanceIds?: string[] // Run specific instances only
	indexExtensions?: string[] // File extensions to index for semantic search
	embeddingDimensions?: number // Output dimensions for Gemini (768/1536/3072)
	embeddingProvider?: 'gemini' | 'openai'
}

const DEFAULT_CONFIG: Required<
	Omit<RunConfig, 'instanceIds' | 'embeddingProvider'>
> = {
	split: 'test',
	maxInstances: undefined as unknown as number,
	maxTurns: 20,
	maxToolCalls: 50,
	model: 'claude-sonnet-4-5',
	// Put runs in project root (not src/) to avoid polluting agent's Grep searches
	runDir: join(
		dirname(dirname(decodeURIComponent(new URL(import.meta.url).pathname))),
		'runs',
	),
	skipAgent1: false,
	skipAgent2: false,
	indexExtensions: ['.py', '.js', '.ts', '.java', '.go', '.rs', '.rb', '.php'],
	embeddingDimensions: 1536, // Gemini embedding dimensions (768/1536/3072)
}

/**
 * Run evaluation for a single agent on a single instance
 */
async function runAgent(
	instance: SWEbenchInstance,
	variant: AgentVariant,
	worktreePath: string,
	runTimestamp: string,
	config: Required<Omit<RunConfig, 'instanceIds' | 'embeddingProvider'>> & {
		instanceIds?: string[]
		embeddingProvider?: 'gemini' | 'openai'
	},
	semanticIndex?: SemanticSearchIndex,
): Promise<InstanceMetrics> {
	const agentConfig = getAgentConfig(variant)
	const oracle = extractOracle(instance)

	// Setup output paths
	const eventsPath = join(
		config.runDir,
		runTimestamp,
		'events',
		`${instance.instance_id}_${variant}.jsonl`,
	)
	const eventWriter = new EventWriter(eventsPath)

	// Create run context
	const ctx = createRunContext(
		instance.instance_id,
		variant,
		worktreePath,
		oracle,
		eventWriter,
	)

	// Log session start
	eventWriter.writeSessionStart(
		instance.instance_id,
		variant,
		config.model,
		worktreePath,
		agentConfig.allowedTools,
	)

	// Setup semantic search for Agent2
	const semanticSearchMetrics = createSemanticSearchMetrics()
	const mcpServers: Record<string, unknown> = {}

	if (variant === 'ops-plus-search' && semanticIndex) {
		const semanticServer = createSemanticSearchServer(
			semanticIndex,
			semanticSearchMetrics,
		)
		mcpServers.semantic_search = semanticServer
	}

	// Create prompt with repo context
	// Pass hasSemanticSearch=true for Agent2 to encourage semantic search usage
	const hasSemanticSearch = variant === 'ops-plus-search' && !!semanticIndex
	const userPrompt = createUserPrompt(
		instance.problem_statement,
		instance.repo,
		hasSemanticSearch,
	)

	// Track tool call count for budget enforcement
	let toolCallCount = 0

	// Run the agent
	let finalOutput = ''
	let totalCostUsd = 0
	let totalDurationMs = 0

	try {
		// Build query options with explicit tool restriction
		// SDK docs: 'tools' array = ONLY these tools available (excludes MCP!)
		// SDK docs: 'allowedTools' = whitelist that includes MCP tools
		const allowedBuiltinTools = ['Read', 'Grep', 'Glob', 'LS']

		// Deny all tools that could modify or are not needed
		const denyTools = [
			'Write',
			'Edit',
			'Bash',
			'Task',
			'WebSearch',
			'WebFetch',
			'TodoRead',
			'TodoWrite',
			'NotebookRead',
			'NotebookEdit',
			'Agent',
			'MultiEdit',
		]

		// Select appropriate system prompt based on variant
		const systemPrompt =
			variant === 'ops-plus-search'
				? RETRIEVAL_WITH_SEARCH_SYSTEM_PROMPT
				: RETRIEVAL_ONLY_SYSTEM_PROMPT

		const queryOptions: Record<string, unknown> = {
			cwd: worktreePath, // SDK uses 'cwd' not 'workingDirectory' for tool path resolution
			model: config.model,
			systemPrompt,
			maxTurns: config.maxTurns,
			disallowedTools: denyTools,
			permissionMode: 'bypassPermissions', // Auto-allow for retrieval-only (no writes)
		}

		// Configure tools based on variant
		if (variant === 'ops-plus-search' && Object.keys(mcpServers).length > 0) {
			// For Agent2 with MCP: use allowedTools (whitelist) instead of tools (restriction)
			// This allows both built-in AND MCP tools
			queryOptions.mcpServers = mcpServers
			queryOptions.allowedTools = [
				...allowedBuiltinTools,
				'mcp__semantic_search__search',
			]
		} else {
			// For Agent1: use tools array to strictly limit to built-in tools only
			queryOptions.tools = allowedBuiltinTools
		}

		console.log(`[runner] CWD (worktree): ${worktreePath}`)
		if (queryOptions.tools) {
			console.log(
				`[runner] Tools (strict): [${(queryOptions.tools as string[]).join(', ')}]`,
			)
		}
		if (queryOptions.allowedTools) {
			console.log(
				`[runner] AllowedTools: [${(queryOptions.allowedTools as string[]).join(', ')}]`,
			)
		}
		console.log(`[runner] Denied: [${denyTools.slice(0, 5).join(', ')}...]`)
		if (queryOptions.mcpServers) {
			console.log(`[runner] MCP: semantic_search enabled`)
		}

		const response = query({
			prompt: userPrompt, // Use simple string prompt instead of generator
			options: queryOptions,
		})

		// Process streaming messages
		for await (const message of response) {
			// Cast message to any to handle SDK type inconsistencies with docs
			const msg = message as Record<string, unknown>

			switch (msg.type) {
				case 'assistant': {
					const msgContent = msg.message as { content?: unknown } | undefined
					// Extract text content for final output parsing
					if (typeof msgContent?.content === 'string') {
						finalOutput = msgContent.content
						// Log assistant thinking (truncate if long)
						const preview = msgContent.content.slice(0, 150)
						console.log(
							`  [${variant}] thinking: ${preview}${msgContent.content.length > 150 ? '...' : ''}`,
						)
					} else if (Array.isArray(msgContent?.content)) {
						for (const block of msgContent.content) {
							const b = block as {
								type?: string
								text?: string
								name?: string
								id?: string
								input?: unknown
							}
							if (b?.type === 'text' && b.text) {
								finalOutput = b.text
								const preview = b.text.slice(0, 150)
								console.log(
									`  [${variant}] thinking: ${preview}${b.text.length > 150 ? '...' : ''}`,
								)
							} else if (b?.type === 'tool_use') {
								toolCallCount++
								const inputStr = JSON.stringify(b.input || {}).slice(0, 100)
								console.log(
									`  [${variant}] Tool[${toolCallCount}]: ${b.name}(${inputStr}${inputStr.length >= 100 ? '...' : ''})`,
								)
								if (b.name && b.id) {
									onPreToolUse(ctx, b.name, b.id, b.input)
								}
							}
						}
					}
					// Process for usage and tool_use tracking
					if (msgContent) {
						processAssistantMessage(
							ctx,
							msgContent as {
								id?: string
								content?: unknown
								usage?: {
									input_tokens?: number
									output_tokens?: number
									cache_read_input_tokens?: number
									cache_creation_input_tokens?: number
								}
							},
						)
					}
					break
				}

				case 'tool_result': {
					// Track tool results - show brief result preview
					const resultVal = msg.result
					const resultStr =
						typeof resultVal === 'string'
							? resultVal
							: JSON.stringify(resultVal || '')
					const resultPreview = resultStr.slice(0, 80)
					console.log(
						`  [${variant}] result: ${msg.tool_name}: ${resultPreview}${resultStr.length > 80 ? '...' : ''}`,
					)
					if (msg.tool_name && msg.tool_use_id) {
						onPostToolUse(
							ctx,
							msg.tool_name as string,
							msg.tool_use_id as string,
							msg.input,
							msg.result,
						)
					}
					break
				}

				case 'user': {
					// Tool results come as "user" messages with tool_result content
					const userMsg = msg.message as { content?: unknown[] } | undefined
					if (Array.isArray(userMsg?.content)) {
						for (const block of userMsg.content) {
							const b = block as {
								type?: string
								tool_use_id?: string
								content?: unknown
							}
							if (b?.type === 'tool_result' && b.tool_use_id) {
								const resultContent =
									typeof b.content === 'string'
										? b.content
										: JSON.stringify(b.content || '')
								const preview = resultContent.slice(0, 80)

								// Look up the tool info from when the call was made
								const toolInfo = ctx.toolCallTimings.get(b.tool_use_id)
								const toolName = toolInfo?.toolName || 'unknown'
								const toolInput = toolInfo?.input || {}

								console.log(
									`  [${variant}] result: ${toolName}: ${preview}${resultContent.length > 80 ? '...' : ''}`,
								)
								onPostToolUse(
									ctx,
									toolName,
									b.tool_use_id,
									toolInput,
									b.content,
								)
							}
						}
					}
					break
				}

				case 'error':
					console.error(`  [${variant}] Agent error:`, msg.error)
					break

				case 'result': {
					totalCostUsd = (msg.total_cost_usd as number) || 0
					totalDurationMs = (msg.duration_ms as number) || 0
					// Extract token usage from result message if available
					if (msg.total_input_tokens || msg.total_output_tokens) {
						ctx.accumulatedUsage.input_tokens =
							(msg.total_input_tokens as number) || 0
						ctx.accumulatedUsage.output_tokens =
							(msg.total_output_tokens as number) || 0
					}
					// Also check for usage object
					const usage = msg.usage as
						| { input_tokens?: number; output_tokens?: number }
						| undefined
					if (usage) {
						ctx.accumulatedUsage.input_tokens =
							usage.input_tokens || ctx.accumulatedUsage.input_tokens
						ctx.accumulatedUsage.output_tokens =
							usage.output_tokens || ctx.accumulatedUsage.output_tokens
					}
					{
						const totalTokens =
							ctx.accumulatedUsage.input_tokens +
							ctx.accumulatedUsage.output_tokens
						console.log(
							`  [${variant}] Done in ${(totalDurationMs / 1000).toFixed(1)}s, cost: $${totalCostUsd.toFixed(4)}, tokens: ${totalTokens}`,
						)
					}
					break
				}

				case 'system': {
					if (msg.subtype === 'init') {
						console.log(`  [${variant}] Session: ${msg.session_id}`)
					}
					break
				}

				default:
					// Debug: log unknown message types
					console.log(
						`  [${variant}] [${msg.type}${msg.subtype ? `:${msg.subtype}` : ''}]`,
					)
			}
		}
	} catch (err) {
		console.error(
			`[runner] Error running ${variant} on ${instance.instance_id}:`,
			err,
		)
	}

	// Parse final output for declared top_files
	const topFilesFinal = parseTopFiles(finalOutput)

	// Log comparison: found vs expected
	const oracleFilesArr = Array.from(ctx.oracle.files)
	const foundFiles = ctx.rankedFilesFromTools.slice(0, 10)
	const intersection = foundFiles.filter((f) => ctx.oracle.files.has(f))

	console.log(
		`\n  +===================================================================+`,
	)
	console.log(
		`  | [${variant}] RESULTS                                            |`,
	)
	console.log(
		`  +===================================================================+`,
	)
	console.log(
		`  | GOLDEN PATCH files:                                              |`,
	)
	for (const f of oracleFilesArr) {
		console.log(`  |    - ${f.slice(0, 55).padEnd(55)} |`)
	}
	console.log(
		`  +===================================================================+`,
	)
	console.log(
		`  | AGENT found files (top ${foundFiles.length}):                                  |`,
	)
	if (foundFiles.length === 0) {
		console.log(
			`  |    (no files found)                                              |`,
		)
	}
	for (const f of foundFiles) {
		const match = ctx.oracle.files.has(f) ? '[x]' : '[ ]'
		console.log(`  |  ${match} ${f.slice(0, 55).padEnd(55)} |`)
	}
	console.log(
		`  +===================================================================+`,
	)
	console.log(
		`  | Hit: ${intersection.length}/${oracleFilesArr.length} | Tool calls: ${toolCallCount.toString().padEnd(3)} | Tokens: ${(ctx.accumulatedUsage.input_tokens + ctx.accumulatedUsage.output_tokens).toString().padEnd(8)} |`,
	)
	console.log(
		`  +===================================================================+\n`,
	)

	// Log session end
	eventWriter.writeSessionEnd(
		instance.instance_id,
		variant,
		totalDurationMs,
		totalCostUsd,
		{
			input_tokens: ctx.accumulatedUsage.input_tokens,
			output_tokens: ctx.accumulatedUsage.output_tokens,
			cache_read_input_tokens: ctx.accumulatedUsage.cache_read_input_tokens,
		},
		topFilesFinal,
		ctx.rankedFilesFromTools,
	)

	// Compute metrics
	const metrics = computeInstanceMetrics(
		ctx,
		topFilesFinal,
		totalDurationMs,
		totalCostUsd,
		variant === 'ops-plus-search' && semanticIndex
			? {
					callCount: semanticSearchMetrics.callCount,
					totalQueryEmbedTokens: semanticSearchMetrics.totalQueryEmbedTokens,
					totalQueryEmbedLatencyMs:
						semanticSearchMetrics.totalQueryEmbedLatencyMs,
					indexEmbedTokens: semanticIndex.totalEmbedTokens,
					indexLoadMs: semanticIndex.indexLoadMs,
				}
			: undefined,
	)

	return metrics
}

/**
 * Main evaluation runner
 */
export async function runEvaluation(
	config: Partial<RunConfig> = {},
): Promise<void> {
	const cfg: Required<Omit<RunConfig, 'instanceIds' | 'embeddingProvider'>> & {
		instanceIds?: string[]
		embeddingProvider?: 'gemini' | 'openai'
	} = {
		...DEFAULT_CONFIG,
		...config,
	}

	// Create run directory
	const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-')
	const runDir = join(cfg.runDir, runTimestamp)
	mkdirSync(runDir, { recursive: true })
	mkdirSync(join(runDir, 'events'), { recursive: true })

	console.log(`[runner] Starting evaluation run at ${runDir}`)
	console.log(`[runner] Config:`, cfg)

	// Load dataset
	let instances = await loadSWEbenchLite(cfg.split, cfg.maxInstances)

	// Filter to specific instances if provided
	if (cfg.instanceIds && cfg.instanceIds.length > 0) {
		const ids = new Set(cfg.instanceIds)
		instances = instances.filter((i) => ids.has(i.instance_id))
		console.log(`[runner] Filtered to ${instances.length} specific instances`)
	}

	console.log(`[runner] Loaded ${instances.length} instances`)

	// Metrics output path
	const metricsPath = join(runDir, 'metrics.jsonl')
	const allMetrics: InstanceMetrics[] = []

	// Process each instance
	for (let i = 0; i < instances.length; i++) {
		const instance = instances[i]!
		console.log(
			`\n[runner] Processing instance ${i + 1}/${instances.length}: ${instance.instance_id}`,
		)

		// Checkout repo at base_commit
		let worktree:
			| { path: string; commit: string; checkout_ms: number }
			| undefined
		try {
			worktree = await createWorktree(
				instance.repo,
				instance.base_commit,
				instance.instance_id,
			)
		} catch (err) {
			console.error(`[runner] Failed to checkout ${instance.instance_id}:`, err)
			continue
		}

		try {
			// Build semantic index for Agent2 (reused across both agents for fairness)
			let semanticIndex: SemanticSearchIndex | undefined
			if (!cfg.skipAgent2) {
				const geminiKey = process.env.GOOGLE_API_KEY
				if (!geminiKey) {
					console.warn(
						'[runner] GOOGLE_API_KEY not set, skipping semantic search indexing',
					)
				} else {
					const embedService = new GeminiEmbeddingService(
						geminiKey,
						'gemini-embedding-001',
						5,
						cfg.embeddingDimensions,
					)
					console.log(
						`[runner] Using Gemini embeddings (${cfg.embeddingDimensions} dimensions)`,
					)
					// Check for cached index
					const indexCacheDir = join(cfg.runDir, '.index_cache')
					const cacheExists = SemanticSearchIndex.cacheExists(
						indexCacheDir,
						instance.instance_id,
						'gemini',
						cfg.embeddingDimensions,
					)

					if (cacheExists) {
						console.log(`[runner] Loading semantic index from cache...`)
						const cached = await SemanticSearchIndex.loadFromCache(
							indexCacheDir,
							instance.instance_id,
							'gemini',
							cfg.embeddingDimensions,
							worktree.path,
							embedService,
						)
						if (cached) {
							semanticIndex = cached
						}
					}

					// Index if not loaded from cache
					if (!semanticIndex) {
						semanticIndex = new SemanticSearchIndex(worktree.path, embedService)

						// List files to index
						const files = listFiles(worktree.path, cfg.indexExtensions)
						console.log(
							`[runner] Indexing ${files.length} files for semantic search...`,
						)

						await semanticIndex.index(files)

						// Save to cache for future runs
						await semanticIndex.saveToCache(
							indexCacheDir,
							instance.instance_id,
							'gemini',
							cfg.embeddingDimensions,
						)
					}
				}
			}

			// Run Agent1 (ops-only)
			if (!cfg.skipAgent1) {
				console.log(
					`[runner] Running Agent1 (ops-only) on ${instance.instance_id}...`,
				)
				const metrics1 = await runAgent(
					instance,
					'ops-only',
					worktree.path,
					runTimestamp,
					cfg,
				)
				writeMetrics(metricsPath, metrics1)
				allMetrics.push(metrics1)
				console.log(
					`[runner] Agent1 done: Hit@5=${metrics1.hit_at_5_behavioral}, MRR=${metrics1.mrr_behavioral.toFixed(3)}`,
				)
			}

			// Run Agent2 (ops + semantic search)
			if (!cfg.skipAgent2) {
				if (!semanticIndex) {
					console.warn(
						`[runner] Skipping Agent2: semantic index not available (check API keys or indexing errors)`,
					)
				} else {
					console.log(
						`[runner] Running Agent2 (ops+search) on ${instance.instance_id}...`,
					)
					const metrics2 = await runAgent(
						instance,
						'ops-plus-search',
						worktree.path,
						runTimestamp,
						cfg,
						semanticIndex,
					)
					writeMetrics(metricsPath, metrics2)
					allMetrics.push(metrics2)
					console.log(
						`[runner] Agent2 done: Hit@5=${metrics2.hit_at_5_behavioral}, MRR=${metrics2.mrr_behavioral.toFixed(3)}`,
					)
				}
			}
		} finally {
			// Cleanup worktree
			try {
				await removeWorktree(instance.repo, instance.instance_id)
			} catch (err) {
				console.warn(`[runner] Failed to cleanup worktree:`, err)
			}
		}
	}

	// Aggregate and write summary
	console.log('\n[runner] Computing aggregate summary...')
	const summary = aggregateMetrics(allMetrics, cfg.split)
	const summaryPath = join(runDir, 'summary.json')
	writeSummary(summaryPath, summary)
	printSummary(summary)

	console.log(`[runner] Evaluation complete. Results at ${runDir}`)
}
