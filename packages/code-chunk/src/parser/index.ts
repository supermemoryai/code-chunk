import { Effect } from 'effect'
import { Parser } from 'web-tree-sitter'
import type { Language, ParseError, ParseResult } from '../types'
import {
	clearGrammarCache,
	type GrammarLoadError,
	getLanguageGrammar,
} from './languages'
import { buildParseResult } from './shared'

export {
	clearGrammarCache,
	detectLanguage,
	GrammarLoadError,
	LANGUAGE_EXTENSIONS,
	loadGrammar,
} from './languages'
export {
	buildParseResult,
	getParseErrorMessage,
	hasParseErrors,
} from './shared'

export class ParserInitError extends Error {
	readonly _tag = 'ParserInitError'
	override readonly cause?: unknown

	constructor(message: string, cause?: unknown) {
		super(message)
		this.name = 'ParserInitError'
		this.cause = cause
	}
}

let initialized: boolean = false

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

export function parse(
	parser: Parser,
	code: string,
	language: Language,
): Effect.Effect<ParseResult, ParseError | GrammarLoadError> {
	return Effect.gen(function* () {
		const grammar = yield* getLanguageGrammar(language)
		parser.setLanguage(grammar)

		const tree = parser.parse(code)
		const result = buildParseResult(tree)

		if (result.error && !result.error.recoverable) {
			return yield* Effect.fail(result.error)
		}

		return result
	})
}

let sharedParser: Parser | null = null

async function getSharedParser(): Promise<Parser> {
	if (sharedParser) {
		return sharedParser
	}

	await Effect.runPromise(initParser())
	sharedParser = new Parser()
	return sharedParser
}

export async function parseCode(
	code: string,
	language: Language,
): Promise<ParseResult> {
	const parser = await getSharedParser()
	return Effect.runPromise(parse(parser, code, language))
}

export async function initializeParser(): Promise<void> {
	await getSharedParser()
}

export function resetParser(): void {
	if (sharedParser) {
		sharedParser.delete()
		sharedParser = null
	}
	initialized = false
	clearGrammarCache()
}
