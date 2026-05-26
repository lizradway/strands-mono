# Context Management Benchmark Results

## Summary

We benchmarked the Strands SDK's context management strategies against ContextBench (span-level retrieval evaluation) using real OpenAI API calls (`gpt-4.1-mini`) on the `huggingface/transformers` repository.

**Primary finding:** For file-based coding agents, the `ContextOffloader` plugin with its retrieval/search tool is a net negative on token usage. Proactive compression alone (`SlidingWindowConversationManager` with `windowSize=40`) is the most efficient strategy.

---

## Strategies Tested

| Strategy | Description |
|----------|-------------|
| **CONTROL** | No context management (`NullConversationManager`) |
| **SlWin ws=40 proactive** | Sliding window, drops oldest messages past 40, with proactive compression |
| **SDK-Builtin ws=20** | SDK default: sliding window at 20, no proactive compression |
| **ContextOffloader + SlWin** | Offloads large tool results to external storage, provides `retrieve_offloaded_content` tool with pattern search + line range access |
| **ContextOffloader (noRetrieval) + SlWin** | Same offloading, but no retrieval tool — agent must re-read files with `read_file`/`search_code` |
| **ContextOffloader only** | Offloading without any sliding window compression |
| **Summarizing** | Replaces oldest messages with LLM-generated summaries |

---

## Results: Token Usage (avg across 2 tasks, 4 turns)

| Configuration | Avg Input Tokens | Savings vs Control | Recall |
|---|---|---|---|
| **SlWin ws=40 proactive only** | **247K** | **+26.3%** | 100% |
| SDK-Builtin ws=20 (no proactive) | 277K | +17.5% | 100% |
| SlWin ws=20 proactive only | 319K | +4.7% | 100% |
| CONTROL (none) | 335K | — | 100% |
| Plugin mrt=2000 p=750+SlWin ws=40 pc=0.6 | 348K | -3.9% | 100% |
| Plugin mrt=2000 p=750+SlWin ws=50 | 359K | -7.1% | 100% |
| Plugin mrt=1000 p=500+SlWin ws=40 | 486K | -45.0% | 100% |
| Plugin mrt=2500 p=1000+SlWin ws=40 | 497K | -48.3% | 100% |
| Plugin mrt=2500 p=250+SlWin ws=40 | 598K | -78.6% | 100% |
| Plugin mrt=2500 p=1000+Summ ratio=0.3 | 669K | -99.7% | 100% |
| Plugin mrt=2500 p=1000 only (no SlWin) | 774K | -131.0% | 100% |

> Negative savings = used MORE tokens than control.

---

## Key Finding: Retrieval Tool vs No Retrieval vs Re-read File

### The three approaches compared:

1. **With retrieval tool** (`retrieve_offloaded_content` with pattern/line_range search)
   - Agent sees `[offloaded]` placeholder → calls retrieval tool with grep pattern → gets matching lines back
   - Each retrieval adds a full LLM cycle (assistant request + tool result)

2. **Without retrieval tool** (offload but no way to get content back)
   - Agent sees `[offloaded]` placeholder → must use `read_file` or `search_code` to re-access content
   - Re-reads are targeted (specific file + line range) so often cheaper than full retrieval

3. **No offloading** (all content stays in context)
   - Agent sees full tool results inline forever
   - Context grows with every tool call, but no extra cycles needed

### Direct comparison (same offload threshold):

| Config | Avg Tokens | vs Control |
|---|---|---|
| Plugin mrt=2500 p=1000 **with retrieval** + SlWin ws=40 | 497K | -48% worse |
| Plugin mrt=2500 p=1000 **no retrieval** + SlWin ws=40 | 513K | -53% worse |
| Plugin mrt=1500 p=750 **with retrieval** + SlWin ws=40 | 401K | -20% worse |
| Plugin mrt=1500 p=750 **no retrieval** + SlWin ws=40 | 476K | -42% worse |
| Plugin mrt=1000 p=500 **with retrieval** + SlWin ws=40 | 486K | -45% worse |
| Plugin mrt=1000 p=500 **no retrieval** + SlWin ws=40 | 465K | -39% worse |

### Analysis:

The retrieval tool is **marginally better than no-retrieval** at higher thresholds (mrt=1500, mrt=2500) — it saves ~15-75K tokens by letting the agent search within offloaded content rather than doing blind re-reads. But both are **significantly worse than no offloading at all** for this task type.

**Why offloading hurts for file-based tools:**

The agent already has `read_file(path, start_line, end_line)` and `search_code(pattern)`. When it needs content from a previous tool result:
- Without offloading: the content is already in context (free, zero cycles)
- With offloading + retrieval: needs 1 extra cycle per retrieval
- With offloading + re-read: needs 1 extra cycle per re-read

The overhead of extra cycles overwhelms the token savings from offloading, because each cycle sends the full context (system prompt + all messages) to the model.

---

## When Would Offloading Help?

The retrieval tool's value proposition is for **non-reproducible, non-file content**:

| Tool type | Can re-fetch? | Offloading value |
|---|---|---|
| `read_file` | Yes (file is static) | **Negative** — re-read is cheaper |
| `search_code` | Yes (repo is static) | **Negative** — re-search is cheaper |
| `http_request` (API call) | Maybe not (rate limits, state changes) | **Positive** — only copy of the data |
| `execute_command` (build/test) | Expensive (minutes to re-run) | **Positive** — avoids re-execution |
| `query_database` | Maybe (state may change) | **Positive** — preserves point-in-time result |
| Web scraping | Page may change | **Positive** — only snapshot available |

**ContextBench only tests the file-based case**, which is the worst case for the offloader. A benchmark with API/command tools would likely show the opposite result.

---

## Recommended Defaults

### For file-based coding agents (most common case):

```typescript
const agent = new Agent({
  model,
  conversationManager: new SlidingWindowConversationManager({
    windowSize: 40,
    proactiveCompression: true,
  }),
  // NO ContextOffloader plugin — it hurts for file tools
})
```

**Result: 26% token savings, 100% recall, zero overhead.**

### For agents with non-reproducible tools (API calls, commands, etc.):

```typescript
const agent = new Agent({
  model,
  conversationManager: new SlidingWindowConversationManager({
    windowSize: 40,
    proactiveCompression: true,
  }),
  plugins: [
    new ContextOffloader({
      storage: new InMemoryStorage(),
      maxResultTokens: 2500,
      previewTokens: 1000,
      includeRetrievalTool: true, // agent can search/grep offloaded content
    }),
  ],
})
```

**Rationale:** When the tool result can't be cheaply re-fetched, offloading + retrieval is the only way to access it after compression drops it from the window. The search/line_range capabilities let the agent access specific parts without pulling back the full result.

---

## Methodology

- **Model:** gpt-4.1-mini (OpenAI)
- **Tasks:** 2 ContextBench instances (huggingface/transformers#13693, pydata/xarray#4075)
- **Turns:** 4 per configuration
- **Tools:** `read_file`, `search_code`, `list_files`, `find_symbols` + optional `retrieve_offloaded_content`
- **Evaluation:** Real API token counts from OpenAI usage metadata + ContextBench span-level metrics
- **Configurations tested:** 32 (varying maxResultTokens, previewTokens, windowSize, proactiveCompression threshold, retrieval tool ablation, summarizing comparison)

---

## Files

| File | Description |
|---|---|
| `v4/benchmark-summary.json` | Raw results from v4 run (real ContextOffloader plugin) |
| `tar-analysis.json` | TAR (Token-Accuracy Ratio) analysis |
| `contextbench-eval-all.json` | ContextBench span-level evaluation results |
| `context-management-benchmarks.ipynb` | Jupyter notebook with charts and analysis |
| `benchmark-summary.json` | Results from earlier v1 run (CombinedManager, not real plugin) |
