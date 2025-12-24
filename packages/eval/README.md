# @supermemory/eval

SWE-bench Lite retrieval-only evaluation harness comparing two Claude Agent SDK variants:

- **Agent1 (ops-only)**: Read/Grep/Glob tools only
- **Agent2 (ops+search)**: Read/Grep/Glob + semantic search via `code-chunk` embeddings

## Setup

```bash
# From monorepo root
bun install
```

Required environment variables:

```bash
ANTHROPIC_API_KEY=...  # Claude API access
GOOGLE_API_KEY=...     # Gemini embeddings (default)
# or
OPENAI_API_KEY=...     # If using --embedding-provider openai
```

## Usage

```bash
cd packages/eval

# Full evaluation on test split
bun run src/run.ts

# Dev split, limited instances
bun run src/run.ts --split dev --max-instances 10

# Only Agent1 (ops-only)
bun run src/run.ts --skip-agent2

# Specific instance
bun run src/run.ts --instance django__django-12345

# Custom embedding dimensions (768/1536/3072)
bun run src/run.ts --embedding-dimensions 768
```

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--split <dev\|test>` | Dataset split | `test` |
| `--max-instances <n>` | Limit instances | all |
| `--max-turns <n>` | Max agent turns | 20 |
| `--max-tool-calls <n>` | Max tool calls | 50 |
| `--model <name>` | Claude model | `claude-sonnet-4-5` |
| `--skip-agent1` | Skip ops-only agent | false |
| `--skip-agent2` | Skip ops+search agent | false |
| `--instance <id>` | Run specific instance(s) | - |
| `--run-dir <path>` | Output directory | `./runs` |
| `--embedding-provider` | `gemini` or `openai` | `gemini` |
| `--embedding-dimensions` | Gemini output dims | 1536 |

## Output

Runs output to `runs/<timestamp>/`:

```
runs/
└── 2025-01-01T12-00-00-000Z/
    ├── events/
    │   ├── django__django-12345_ops-only.jsonl
    │   └── django__django-12345_ops+search.jsonl
    ├── metrics.jsonl
    └── summary.json
```

## Metrics

- **Hit@k**: Whether oracle file appears in top-k predictions
- **MRR**: Mean Reciprocal Rank of first oracle file
- **Coverage@k**: Fraction of oracle files in top-k
- **Time-to-first-hit**: Turns/tool calls until first oracle file accessed
- **Embedding latency**: Index build + query times (Agent2 only)

## Architecture

```
src/
├── run.ts                    # CLI entrypoint
└── swebench/
    ├── types.ts              # SWEbenchInstance, metrics types
    ├── dataset.ts            # HuggingFace dataset loader with caching
    ├── git.ts                # Bare clone + worktree management
    ├── score.ts              # Per-instance metric computation
    ├── aggregate.ts          # Cross-instance aggregation
    ├── run.ts                # Main evaluation loop
    ├── agent/
    │   ├── prompts.ts        # Retrieval-only system/user prompts
    │   ├── variants.ts       # Agent1/Agent2 tool configurations
    │   └── semantic_search_adapter.ts  # Gemini embeddings + MCP server
    └── observe/
        └── instrumentation.ts  # SDK hooks, event writer
```

## How it works

1. Loads SWE-bench Lite dataset (300 instances)
2. For each instance:
   - Creates git worktree at target commit
   - Runs Agent1 (ops-only) with Read/Grep/Glob
   - Builds semantic index using `code-chunk` 
   - Runs Agent2 (ops+search) with additional semantic_search tool
   - Computes retrieval metrics against oracle files from patch
3. Aggregates metrics, prints summary, writes results

## Embedding cache

Semantic search indexes are cached at `~/.cache/swebench-eval/embeddings/` to avoid re-embedding repos. Cache key includes instance ID + embedding provider + dimensions.
