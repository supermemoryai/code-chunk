/**
 * Shared prompt templates for retrieval-only agents
 */

/**
 * Base system prompt for retrieval-only evaluation
 * Instructs the agent to locate files without making changes
 */
const BASE_SYSTEM_PROMPT = `You are a skilled software engineer helping to locate the source files that need to be modified to address a bug or feature request.

## Your Task

Given a problem statement describing a bug or feature request, your goal is to identify the **most relevant source files** in the repository that would need to be modified to address the issue.

## Important Constraints

1. **DO NOT** propose any code changes, patches, or fixes
2. **DO NOT** write or edit any files  
3. **DO NOT** run any commands that modify the repository
4. **ONLY** read files and search the codebase to locate relevant files

## Working Directory

You are working in a repository checkout. All file paths should be relative to the repository root.
- Use patterns like \`src/**/*.py\` or \`**/rules/*.py\` for Glob
- Use paths like \`src/\` or \`.\` for Grep path parameter
- All file paths in your output should be relative (e.g., \`src/module/file.py\`)

## Available Tools

You have access to these read-only tools:
- **Read**: Read file contents
- **Grep**: Search for patterns in files
- **Glob**: Find files matching a pattern
- **LS**: List directory contents

**NOTE**: Bash, shell commands, and terminal access are NOT available.

## Approach

Understand the problem statement first - look for key terms, error messages, function names, or class names mentioned.

Use the tools to navigate and search the codebase:
- **Glob** is useful for finding files by name patterns
- **Grep** is useful for searching file contents by keyword
- **Read** lets you examine file contents in detail
- **LS** shows directory structure

Aim to identify 3-10 files that would need modification.

## Output Format

When you have identified the relevant files, output your final answer as a JSON object:

\`\`\`json
{
  "top_files": [
    "path/to/most/relevant/file.py",
    "path/to/second/relevant/file.py"
  ],
  "reason": "Brief explanation of why these files are relevant"
}
\`\`\`

List files in order of relevance (most relevant first). Aim for 3-10 files.`

/**
 * System prompt for Agent1 (ops-only)
 */
export const RETRIEVAL_ONLY_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT

/**
 * System prompt for Agent2 (ops + semantic search)
 * Includes information about the semantic search tool
 */
export const RETRIEVAL_WITH_SEARCH_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

## Semantic Code Search (Your Primary Tool)

You have **mcp__semantic_search__search** - use this to quickly find relevant code:

\`\`\`
mcp__semantic_search__search({"query": "description of what you're looking for", "top_k": 10})
\`\`\`

The codebase is pre-indexed. One semantic search call typically finds relevant files faster than multiple Glob/Grep calls.

**Important**: Semantic search returns absolute file paths that you can use directly with Read. After identifying candidate files, use Read with the exact paths from the results.`

/**
 * Create the user prompt with just the problem statement
 * @param problemStatement - The SWE-bench problem statement
 * @param repo - Optional repo name for context
 * @param hasSemanticSearch - Whether Agent2's semantic search is available
 */
export function createUserPrompt(
	problemStatement: string,
	repo?: string,
	hasSemanticSearch = false,
): string {
	const repoInfo = repo
		? `\n\nYou are working in the **${repo}** repository.\n`
		: ''

	const searchGuidance = hasSemanticSearch
		? `**Recommended approach**: Start with semantic search to quickly find relevant code areas. Then use Read to examine specific files.`
		: `Start by exploring the repository structure (use LS or Glob) to understand the codebase layout. Then search for relevant code using the available tools.`

	return `## Problem Statement

${problemStatement}
${repoInfo}
---

Please analyze the problem and identify the source files that would need to be modified to address this issue.

${searchGuidance}

Remember to output your final answer as JSON with "top_files" and "reason" fields. Use relative paths (e.g., \`src/module/file.py\`).`
}

/**
 * Parse the agent's final output to extract top_files
 * Handles various output formats the agent might use
 */
export function parseTopFiles(output: string): string[] {
	// Try to find JSON in the output
	const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/)
	if (jsonMatch?.[1]) {
		try {
			const parsed = JSON.parse(jsonMatch[1])
			if (Array.isArray(parsed.top_files)) {
				return parsed.top_files
			}
		} catch {
			// Continue to fallback
		}
	}

	// Try to parse raw JSON
	const rawJsonMatch = output.match(/\{[\s\S]*"top_files"[\s\S]*\}/)
	if (rawJsonMatch) {
		try {
			const parsed = JSON.parse(rawJsonMatch[0])
			if (Array.isArray(parsed.top_files)) {
				return parsed.top_files
			}
		} catch {
			// Continue to fallback
		}
	}

	// Fallback: extract file paths from the text
	// Match common file path patterns (e.g., path/to/file.py)
	const pathMatches = output.match(/[\w\-./]+\.[a-z]+/gi) || []
	const uniquePaths = [...new Set(pathMatches)].filter(
		(p) =>
			// Filter out common non-file patterns
			!p.startsWith('http') && !p.includes('...') && p.includes('/'),
	)

	return uniquePaths.slice(0, 10)
}
