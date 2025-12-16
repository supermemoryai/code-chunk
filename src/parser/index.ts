import { Context, Effect, Layer } from 'effect'
import {
	Parser,
	type Node as TSNode,
	type Tree as TSTree,
} from 'web-tree-sitter'
import type { Language, ParseError, ParseResult } from '../types'
import { type GrammarLoadError, getLanguageGrammar } from './languages'

// Re-export language utilities
export {
	clearGrammarCache,
	detectLanguage,
	GrammarLoadError,
	LANGUAGE_EXTENSIONS,
	loadGrammar,
} from './languages'

/**
 * Error thrown when parser initialization fails
 */
export class ParserInitError extends Error {
	readonly _tag = 'ParserInitError'
	override readonly cause?: unknown

	constructor(message: string, cause?: unknown) {
		super(message)
		this.name = 'ParserInitError'
		this.cause = cause
	}
}

/**
 * Parser service interface for dependency injection
 */
export interface ParserService {
	readonly _tag: 'ParserService'

	/**
	 * Parse source code with a specific language
	 */
	parse(
		code: string,
		language: Language,
	): Effect.Effect<ParseResult, ParseError | GrammarLoadError>

	/**
	 * Get the underlying tree-sitter parser instance
	 */
	getParser(): Parser
}

/**
 * ParserService tag for Effect Context
 */
export const ParserService: Context.Tag<ParserService, ParserService> =
	Context.GenericTag<ParserService>('ParserService')

/**
 * Flag to track if tree-sitter has been initialized
 */
let initialized: boolean = false

/**
 * Initialize the tree-sitter WASM module
 *
 * @returns Effect that initializes tree-sitter
 */
export function initParser(): Effect.Effect<void, ParserInitError> {
	return Effect.gen(function* () {
		if (initialized) {
			return
		}

		yield* Effect.tryPromise({
			try: () => Parser.init(),
			catch: (error) =>
				new ParserInitError('Failed to initialize tree-sitter', error),
		})

		initialized = true
	})
}

/**
 * Check if a parse tree has errors
 */
function hasParseErrors(tree: TSTree): boolean {
	return tree.rootNode.hasError
}

/**
 * Get error message from a tree with errors
 */
function getParseErrorMessage(tree: TSTree): string {
	const errorNodes: string[] = []

	function findErrors(node: TSNode) {
		if (node.isError || node.isMissing) {
			const pos = node.startPosition
			errorNodes.push(
				`${node.isError ? 'ERROR' : 'MISSING'} at line ${pos.row + 1}, column ${pos.column + 1}`,
			)
		}
		for (const child of node.children) {
			findErrors(child)
		}
	}

	findErrors(tree.rootNode)
	return errorNodes.length > 0
		? errorNodes.slice(0, 3).join('; ') +
				(errorNodes.length > 3 ? `; ... and ${errorNodes.length - 3} more` : '')
		: 'Unknown parse error'
}

/**
 * Parse source code into an AST
 *
 * Uses Effect internally for error handling. Tree-sitter always produces a tree
 * even with syntax errors (recoverable parsing).
 *
 * @param parser - The tree-sitter parser instance
 * @param code - The source code to parse
 * @param language - The programming language
 * @returns Effect resolving to ParseResult
 */
export function parse(
	parser: Parser,
	code: string,
	language: Language,
): Effect.Effect<ParseResult, ParseError | GrammarLoadError> {
	return Effect.gen(function* () {
		// Load and set the language grammar
		const grammar = yield* getLanguageGrammar(language)
		parser.setLanguage(grammar)

		// Parse the code
		const tree = parser.parse(code)

		if (!tree) {
			return yield* Effect.fail({
				message: 'Parser returned null - no language set or parsing cancelled',
				recoverable: false,
			} satisfies ParseError)
		}

		// Check for parse errors
		if (hasParseErrors(tree)) {
			return {
				tree,
				error: {
					message: getParseErrorMessage(tree),
					recoverable: true, // Tree-sitter always produces a tree
				},
			} satisfies ParseResult
		}

		return {
			tree,
			error: null,
		} satisfies ParseResult
	})
}

/**
 * Create a ParserService implementation
 */
function makeParserService(parser: Parser): ParserService {
	return {
		_tag: 'ParserService',
		parse: (code: string, language: Language) => parse(parser, code, language),
		getParser: () => parser,
	}
}

/**
 * Live layer that provides ParserService
 */
export const ParserServiceLive: Layer.Layer<ParserService, ParserInitError> =
	Layer.effect(
		ParserService,
		Effect.gen(function* () {
			yield* initParser()
			const parser = new Parser()
			return makeParserService(parser)
		}),
	)

// ============================================================================
// Public API - Unwraps Effect for consumers
// ============================================================================

/**
 * Shared parser instance for the public API
 */
let sharedParser: Parser | null = null

/**
 * Get or create the shared parser instance
 */
async function getSharedParser(): Promise<Parser> {
	if (sharedParser) {
		return sharedParser
	}

	await Effect.runPromise(initParser())
	sharedParser = new Parser()
	return sharedParser
}

/**
 * Parse source code into an AST (public async API)
 *
 * @param code - The source code to parse
 * @param language - The programming language
 * @returns Promise resolving to ParseResult
 * @throws ParseError or GrammarLoadError if parsing fails irrecoverably
 */
export async function parseCode(
	code: string,
	language: Language,
): Promise<ParseResult> {
	const parser = await getSharedParser()
	return Effect.runPromise(parse(parser, code, language))
}

/**
 * Initialize the parser module (public async API)
 *
 * Call this before using other parser functions to ensure tree-sitter is ready.
 * This is called automatically by parseCode, but can be called explicitly for
 * early initialization.
 *
 * @returns Promise that resolves when initialization is complete
 * @throws ParserInitError if initialization fails
 */
export async function initializeParser(): Promise<void> {
	await getSharedParser()
}

/**
 * Reset the shared parser state (useful for testing)
 */
export function resetParser(): void {
	if (sharedParser) {
		sharedParser.delete()
		sharedParser = null
	}
	initialized = false
}
