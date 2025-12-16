import { Effect } from 'effect'
import { Language as TSLanguage } from 'web-tree-sitter'
import type { Language } from '../types'

/**
 * Error thrown when loading a language grammar fails
 */
export class GrammarLoadError extends Error {
	readonly _tag = 'GrammarLoadError'
	readonly language: Language
	override readonly cause?: unknown

	constructor(language: Language, cause?: unknown) {
		super(`Failed to load grammar for language: ${language}`)
		this.name = 'GrammarLoadError'
		this.language = language
		this.cause = cause
	}
}

/**
 * Mapping of file extensions to supported languages
 */
export const LANGUAGE_EXTENSIONS: Record<string, Language> = {
	'.ts': 'typescript',
	'.tsx': 'typescript',
	'.mts': 'typescript',
	'.cts': 'typescript',
	'.js': 'javascript',
	'.jsx': 'javascript',
	'.mjs': 'javascript',
	'.cjs': 'javascript',
	'.py': 'python',
	'.pyi': 'python',
	'.rs': 'rust',
	'.go': 'go',
	'.java': 'java',
}

/**
 * Detect the programming language from a file path based on its extension
 *
 * @param filepath - The path to the file
 * @returns The detected language or null if not supported
 */
export function detectLanguage(filepath: string): Language | null {
	const ext = filepath.slice(filepath.lastIndexOf('.'))
	return LANGUAGE_EXTENSIONS[ext] ?? null
}

/**
 * Get the WASM grammar path for a language
 * Uses the tree-sitter-* packages which include pre-compiled WASM files
 */
function getGrammarPath(language: Language): string {
	switch (language) {
		case 'typescript':
			// TypeScript requires the TSX grammar for full support
			return require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm')
		case 'javascript':
			return require.resolve(
				'tree-sitter-javascript/tree-sitter-javascript.wasm',
			)
		case 'python':
			return require.resolve('tree-sitter-python/tree-sitter-python.wasm')
		case 'rust':
			return require.resolve('tree-sitter-rust/tree-sitter-rust.wasm')
		case 'go':
			return require.resolve('tree-sitter-go/tree-sitter-go.wasm')
		case 'java':
			return require.resolve('tree-sitter-java/tree-sitter-java.wasm')
	}
}

/**
 * Cache for loaded language grammars to avoid reloading
 */
const grammarCache: Map<Language, TSLanguage> = new Map()

/**
 * Load a tree-sitter language grammar
 *
 * Uses Effect for error handling internally. The grammar is cached after first load.
 *
 * @param language - The language to load the grammar for
 * @returns Effect that resolves to the loaded Language grammar
 */
export function getLanguageGrammar(
	language: Language,
): Effect.Effect<TSLanguage, GrammarLoadError> {
	return Effect.gen(function* () {
		// Check cache first
		const cached = grammarCache.get(language)
		if (cached) {
			return cached
		}

		// Load the grammar from WASM
		const grammarPath = getGrammarPath(language)

		const loadedLanguage = yield* Effect.tryPromise({
			try: () => TSLanguage.load(grammarPath),
			catch: (error) => new GrammarLoadError(language, error),
		})

		// Cache for future use
		grammarCache.set(language, loadedLanguage)

		return loadedLanguage
	})
}

/**
 * Load a language grammar (public async API)
 *
 * @param language - The language to load
 * @returns Promise resolving to the Language grammar
 * @throws GrammarLoadError if loading fails
 */
export async function loadGrammar(language: Language): Promise<TSLanguage> {
	return Effect.runPromise(getLanguageGrammar(language))
}

/**
 * Clear the grammar cache (useful for testing)
 */
export function clearGrammarCache(): void {
	grammarCache.clear()
}
