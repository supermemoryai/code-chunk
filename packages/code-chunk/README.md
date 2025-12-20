# code-chunk

AST-aware code chunking for semantic search and RAG pipelines.

Uses tree-sitter to split source code at semantic boundaries (functions, classes, methods) rather than arbitrary character limits. Each chunk includes rich context: scope chain, imports, siblings, and entity signatures.

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Quickstart](#quickstart)
- [API Reference](#api-reference)
- [License](#license)

## Features

- **AST-aware**: Splits at semantic boundaries, never mid-function
- **Rich context**: Scope chain, imports, siblings, entity signatures
- **Contextualized text**: Pre-formatted for embedding models
- **Multi-language**: TypeScript, JavaScript, Python, Rust, Go, Java
- **Batch processing**: Process entire codebases with controlled concurrency
- **Streaming**: Process large files incrementally
- **Effect support**: First-class Effect integration

## How It Works

Traditional text splitters chunk code by character count or line breaks, often cutting functions in half or separating related code. `code-chunk` takes a different approach:

### 1. Parse

Source code is parsed into an Abstract Syntax Tree (AST) using [tree-sitter](https://tree-sitter.github.io/tree-sitter/). This gives us a structured representation of the code that understands language grammar.

### 2. Extract

We traverse the AST to extract semantic entities: functions, methods, classes, interfaces, types, and imports. For each entity, we capture:
- Name and type
- Full signature (e.g., `async getUser(id: string): Promise<User>`)
- Docstring/comments if present
- Byte and line ranges

### 3. Build Scope Tree

Entities are organized into a hierarchical scope tree that captures nesting relationships. A method inside a class knows its parent; a nested function knows its containing function. This enables us to provide scope context like `UserService > getUser`.

### 4. Chunk

Code is split at semantic boundaries while respecting the `maxChunkSize` limit. The chunker:
- Prefers to keep complete entities together
- Splits oversized entities at logical points (statement boundaries)
- Never cuts mid-expression or mid-statement
- Merges small adjacent chunks to reduce fragmentation

### 5. Enrich with Context

Each chunk is enriched with contextual metadata:
- **Scope chain**: Where this code lives (e.g., inside which class/function)
- **Entities**: What's defined in this chunk
- **Siblings**: What comes before/after (for continuity)
- **Imports**: What dependencies are used

This context is formatted into `contextualizedText`, optimized for embedding models to understand semantic relationships.

## Installation

```bash
bun add code-chunk
# or
npm install code-chunk
```

## Quickstart

### Basic Usage

```typescript
import { chunk } from 'code-chunk'

const chunks = await chunk('src/user.ts', sourceCode)

for (const c of chunks) {
  console.log(c.text)
  console.log(c.context.scope)    // [{ name: 'UserService', type: 'class' }]
  console.log(c.context.entities) // [{ name: 'getUser', type: 'method', ... }]
}
```

### Using Contextualized Text for Embeddings

Use `contextualizedText` for better embedding quality in RAG systems:

```typescript
for (const c of chunks) {
  const embedding = await embed(c.contextualizedText)
  await vectorDB.upsert({
    id: `${filepath}:${c.index}`,
    embedding,
    metadata: { filepath, lines: c.lineRange }
  })
}
```

The `contextualizedText` prepends semantic context to the raw code:

```
# src/services/user.ts
# Scope: UserService
# Defines: async getUser(id: string): Promise<User>
# Uses: Database
# After: constructor

  async getUser(id: string): Promise<User> {
    return this.db.query('SELECT * FROM users WHERE id = ?', [id])
  }
```

### Streaming Large Files

Process chunks incrementally without loading everything into memory:

```typescript
import { chunkStream } from 'code-chunk'

for await (const c of chunkStream('src/large.ts', code)) {
  await process(c)
}
```

### Reusable Chunker

Create a chunker instance when processing multiple files with the same config:

```typescript
import { createChunker } from 'code-chunk'

const chunker = createChunker({
  maxChunkSize: 2048,
  contextMode: 'full',
  siblingDetail: 'signatures',
})

for (const file of files) {
  const chunks = await chunker.chunk(file.path, file.content)
}
```

### Batch Processing

Process multiple files concurrently with error handling per file:

```typescript
import { chunkBatch } from 'code-chunk'

const files = [
  { filepath: 'src/user.ts', code: userCode },
  { filepath: 'src/auth.ts', code: authCode },
  { filepath: 'lib/utils.py', code: utilsCode },
]

const results = await chunkBatch(files, {
  maxChunkSize: 1500,
  concurrency: 10,
  onProgress: (done, total, path, success) => {
    console.log(`[${done}/${total}] ${path}: ${success ? 'ok' : 'failed'}`)
  }
})

for (const result of results) {
  if (result.error) {
    console.error(`Failed: ${result.filepath}`, result.error)
  } else {
    await indexChunks(result.filepath, result.chunks)
  }
}
```

Stream results as they complete:

```typescript
import { chunkBatchStream } from 'code-chunk'

for await (const result of chunkBatchStream(files, { concurrency: 5 })) {
  if (result.chunks) {
    await indexChunks(result.filepath, result.chunks)
  }
}
```

### Effect Integration

For Effect-based pipelines:

```typescript
import { chunkStreamEffect } from 'code-chunk'
import { Effect, Stream } from 'effect'

const program = Stream.runForEach(
  chunkStreamEffect('src/utils.ts', code),
  (chunk) => Effect.log(chunk.text)
)

await Effect.runPromise(program)
```

## API Reference

### `chunk(filepath, code, options?)`

Chunk source code into semantic pieces with context.

**Parameters:**
- `filepath`: File path (used for language detection)
- `code`: Source code string
- `options`: Optional configuration

**Returns:** `Promise<Chunk[]>`

**Throws:** `ChunkingError`, `UnsupportedLanguageError`

---

### `chunkStream(filepath, code, options?)`

Stream chunks as they're generated. Useful for large files.

**Returns:** `AsyncGenerator<Chunk>`

Note: `chunk.totalChunks` is `-1` in streaming mode (unknown upfront).

---

### `chunkStreamEffect(filepath, code, options?)`

Effect-native streaming API for composable pipelines.

**Returns:** `Stream.Stream<Chunk, ChunkingError | UnsupportedLanguageError>`

---

### `createChunker(options?)`

Create a reusable chunker instance with default options.

**Returns:** `Chunker` with `chunk()`, `stream()`, `chunkBatch()`, and `chunkBatchStream()` methods

---

### `chunkBatch(files, options?)`

Process multiple files concurrently with per-file error handling.

**Parameters:**
- `files`: Array of `{ filepath, code, options? }`
- `options`: Batch options (extends ChunkOptions with `concurrency` and `onProgress`)

**Returns:** `Promise<BatchResult[]>` where each result has `{ filepath, chunks, error }`

---

### `chunkBatchStream(files, options?)`

Stream batch results as files complete processing.

**Returns:** `AsyncGenerator<BatchResult>`

---

### `chunkBatchEffect(files, options?)`

Effect-native batch processing.

**Returns:** `Effect.Effect<BatchResult[], never>`

---

### `chunkBatchStreamEffect(files, options?)`

Effect-native streaming batch processing.

**Returns:** `Stream.Stream<BatchResult, never>`

---

### `formatChunkWithContext(text, context, overlapText?)`

Format chunk text with semantic context prepended. Useful for custom embedding pipelines.

**Returns:** `string`

---

### `detectLanguage(filepath)`

Detect programming language from file extension.

**Returns:** `Language | null`

---

### ChunkOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxChunkSize` | `number` | `1500` | Maximum chunk size in bytes |
| `contextMode` | `'none' \| 'minimal' \| 'full'` | `'full'` | How much context to include |
| `siblingDetail` | `'none' \| 'names' \| 'signatures'` | `'signatures'` | Level of sibling detail |
| `filterImports` | `boolean` | `false` | Filter out import statements |
| `language` | `Language` | auto | Override language detection |
| `overlapLines` | `number` | `10` | Lines from previous chunk to include in `contextualizedText` |

### BatchOptions

Extends `ChunkOptions` with:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `concurrency` | `number` | `10` | Maximum files to process concurrently |
| `onProgress` | `function` | - | Callback `(completed, total, filepath, success) => void` |

---

### Supported Languages

| Language | Extensions |
|----------|------------|
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `.py`, `.pyi` |
| Rust | `.rs` |
| Go | `.go` |
| Java | `.java` |

---

### Errors

**`ChunkingError`**: Thrown when chunking fails (parsing error, extraction error, etc.)

**`UnsupportedLanguageError`**: Thrown when the file extension is not supported

Both errors have a `_tag` property for Effect-style error handling.

## License

MIT
