import { Effect } from 'effect'
import { Parser, Language as TSLanguage } from 'web-tree-sitter'

import type { Language, ParseResult, WasmBinary, WasmConfig } from '../types'
import { buildParseResult } from './shared'

export class WasmParserError extends Error {
	readonly _tag = 'WasmParserError'
	override readonly cause?: unknown

	constructor(message: string, cause?: unknown) {
		super(message)
		this.name = 'WasmParserError'
		this.cause = cause
	}
}

export class WasmGrammarError extends Error {
	readonly _tag = 'WasmGrammarError'
	readonly language: Language
	override readonly cause?: unknown

	constructor(language: Language, message?: string, cause?: unknown) {
		super(message ?? `No WASM binary provided for language: ${language}`)
		this.name = 'WasmGrammarError'
		this.language = language
		this.cause = cause
	}
}

async function toUint8Array(binary: WasmBinary): Promise<Uint8Array> {
	if (binary instanceof Uint8Array) {
		return binary
	}
	if (binary instanceof ArrayBuffer) {
		return new Uint8Array(binary)
	}
	if (binary instanceof Response) {
		const buffer = await binary.arrayBuffer()
		return new Uint8Array(buffer)
	}
	if (typeof binary === 'string') {
		const response = await fetch(binary)
		const buffer = await response.arrayBuffer()
		return new Uint8Array(buffer)
	}
	throw new WasmParserError('Parser not initialized. Call init() first.')
}

export class WasmParser {
	private config: WasmConfig
	private initialized = false
	private grammarCache = new Map<Language, TSLanguage>()
	private sharedParser: Parser | null = null

	constructor(config: WasmConfig) {
		this.config = config
	}

	async init(): Promise<void> {
		if (this.initialized) return

		const wasmBinary = await toUint8Array(this.config.treeSitter)

		await Parser.init({
			locateFile: () => '',
			wasmBinary: wasmBinary.buffer,
		})

		this.sharedParser = new Parser()
		this.initialized = true
	}

	private async loadGrammar(language: Language): Promise<TSLanguage> {
		const cached = this.grammarCache.get(language)
		if (cached) return cached

		const wasmBinary = this.config.languages[language]
		if (!wasmBinary) {
			throw new WasmGrammarError(language)
		}

		const input = await toUint8Array(wasmBinary)
		const grammar = await TSLanguage.load(input)
		this.grammarCache.set(language, grammar)
		return grammar
	}

	async parse(code: string, language: Language): Promise<ParseResult> {
		if (!this.initialized || !this.sharedParser) {
			throw new WasmParserError('Parser not initialized. Call init() first.')
		}

		const grammar = await this.loadGrammar(language)
		this.sharedParser.setLanguage(grammar)

		const tree = this.sharedParser.parse(code)
		return buildParseResult(tree)
	}

	parseEffect(
		code: string,
		language: Language,
	): Effect.Effect<ParseResult, WasmParserError | WasmGrammarError> {
		return Effect.tryPromise({
			try: () => this.parse(code, language),
			catch: (error) => {
				if (
					error instanceof WasmParserError ||
					error instanceof WasmGrammarError
				) {
					return error
				}
				return new WasmParserError('Parse failed', error)
			},
		})
	}

	reset(): void {
		if (this.sharedParser) {
			this.sharedParser.delete()
			this.sharedParser = null
		}
		this.grammarCache.clear()
		this.initialized = false
	}
}

export async function createWasmParser(
	config: WasmConfig,
): Promise<WasmParser> {
	const parser = new WasmParser(config)
	await parser.init()
	return parser
}
