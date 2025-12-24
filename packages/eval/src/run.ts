#!/usr/bin/env bun
/**
 * SWE-bench Lite Retrieval-Only Evaluation Harness
 *
 * CLI entrypoint for running retrieval-only evaluation comparing:
 * - Agent1 (ops-only): Read/Grep/Glob
 * - Agent2 (ops+search): Read/Grep/Glob + semantic search
 *
 * Usage:
 *   bun run src/run.ts [options]
 *
 * Options:
 *   --split <dev|test>       Dataset split (default: test)
 *   --max-instances <n>      Limit number of instances to process
 *   --max-turns <n>          Max agent turns per instance (default: 20)
 *   --max-tool-calls <n>     Max tool calls per agent (default: 50)
 *   --model <name>           Claude model to use (default: claude-sonnet-4-5)
 *   --skip-agent1            Skip Agent1 (ops-only)
 *   --skip-agent2            Skip Agent2 (ops+search)
 *   --instance <id>          Run specific instance(s), can be repeated
 *   --run-dir <path>         Output directory for runs (default: ./runs)
 *   --embedding-provider <gemini|openai>  Embedding provider (default: gemini)
 *   --embedding-dimensions <n>            Output dimensions for Gemini (768/1536/3072)
 *
 * Environment Variables:
 *   ANTHROPIC_API_KEY        Required for Claude API access
 *   GOOGLE_API_KEY           Required for Gemini embeddings (default provider)
 *   OPENAI_API_KEY           Required for OpenAI embeddings (if --embedding-provider openai)
 *
 * Examples:
 *   # Run full evaluation on test split
 *   bun run src/run.ts
 *
 *   # Run on dev split with max 10 instances
 *   bun run src/run.ts --split dev --max-instances 10
 *
 *   # Run only Agent1 for debugging
 *   bun run src/run.ts --skip-agent2 --max-instances 5
 *
 *   # Run specific instance
 *   bun run src/run.ts --instance django__django-12345
 */

import dotenv from 'dotenv'
import { type RunConfig, runEvaluation } from './swebench/run'

// Load environment variables
dotenv.config()

// Parse command line arguments
function parseArgs(): RunConfig {
	const args = process.argv.slice(2)
	const config: RunConfig = {}
	const instanceIds: string[] = []

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]
		const next = args[i + 1]

		switch (arg) {
			case '--split':
				if (next === 'dev' || next === 'test') {
					config.split = next
					i++
				}
				break
			case '--max-instances':
				if (next) config.maxInstances = parseInt(next, 10)
				i++
				break
			case '--max-turns':
				if (next) config.maxTurns = parseInt(next, 10)
				i++
				break
			case '--max-tool-calls':
				if (next) config.maxToolCalls = parseInt(next, 10)
				i++
				break
			case '--model':
				if (next) config.model = next
				i++
				break
			case '--skip-agent1':
				config.skipAgent1 = true
				break
			case '--skip-agent2':
				config.skipAgent2 = true
				break
			case '--instance':
				if (next) instanceIds.push(next)
				i++
				break
			case '--run-dir':
				if (next) config.runDir = next
				i++
				break
			case '--embedding-provider':
				if (next === 'gemini' || next === 'openai') {
					config.embeddingProvider = next
					i++
				}
				break
			case '--embedding-dimensions':
				config.embeddingDimensions = parseInt(next!, 10)
				i++
				break
			case '--help':
			case '-h':
				console.log(`
SWE-bench Lite Retrieval-Only Evaluation Harness

Usage:
  bun run src/run.ts [options]

Options:
  --split <dev|test>       Dataset split (default: test)
  --max-instances <n>      Limit number of instances to process
  --max-turns <n>          Max agent turns per instance (default: 20)
  --max-tool-calls <n>     Max tool calls per agent (default: 50)
  --model <name>           Claude model to use (default: claude-sonnet-4-5)
  --skip-agent1            Skip Agent1 (ops-only)
  --skip-agent2            Skip Agent2 (ops+search)
  --instance <id>          Run specific instance(s), can be repeated
  --run-dir <path>         Output directory for runs (default: ./runs)
  --embedding-provider <gemini|openai>  Embedding provider (default: gemini)
  --embedding-dimensions <n>            Output dimensions for Gemini (768/1536/3072)
  --help, -h               Show this help message

Environment Variables:
  ANTHROPIC_API_KEY        Required for Claude API access
  GOOGLE_API_KEY           Required for Gemini embeddings (default provider)
  OPENAI_API_KEY           Required for OpenAI embeddings (if --embedding-provider openai)
`)
				process.exit(0)
		}
	}

	if (instanceIds.length > 0) {
		config.instanceIds = instanceIds
	}

	return config
}

// Main
async function main() {
	// Parse args first (handles --help early exit)
	const config = parseArgs()

	// Check required env vars
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error('Error: ANTHROPIC_API_KEY environment variable is required')
		process.exit(1)
	}

	// Check embedding provider env var
	const provider = config.embeddingProvider || 'gemini'
	if (provider === 'gemini' && !process.env.GOOGLE_API_KEY) {
		console.warn(
			'Warning: GOOGLE_API_KEY not set. Agent2 (semantic search) will be skipped.',
		)
	} else if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
		console.warn(
			'Warning: OPENAI_API_KEY not set. Agent2 (semantic search) will be skipped.',
		)
	}
	console.log('Starting SWE-bench Lite retrieval-only evaluation...\n')

	try {
		await runEvaluation(config)
	} catch (err) {
		console.error('Evaluation failed:', err)
		process.exit(1)
	}
}

main()
