# LOCOMO Retrieval Benchmark Results

Benchmark comparing search strategies for `FileMemoryStore` on the [LOCOMO](https://arxiv.org/abs/2402.02135) conversational memory dataset.

## Setup

- **Corpus**: 1 LOCOMO conversation (419 turns across 19 sessions)
- **Queries**: 70 single-hop (category 4) QA pairs
- **Task**: Given a natural-language question, retrieve the conversation turns containing the evidence needed to answer it
- **Metrics**: Recall@K (fraction of evidence turns in top-K results), MRR (mean reciprocal rank of first evidence hit)

## Results

| Strategy | Recall@5 | Recall@10 | MRR | Time |
|----------|----------|-----------|-----|------|
| **QMD (BM25, OR)** | **57.9%** | **63.6%** | **0.459** | 11.2s |
| Keyword (token overlap) | 40.7% | 45.0% | 0.281 | 9.7s |
| Grep (match count) | 5.7% | 5.7% | 0.025 | ~60s |
| Full context (no retrieval) | 100% | 100% | 1.000 | n/a |

## Analysis

### QMD vs Keyword
QMD with BM25 outperforms naive token-overlap by +42% relative Recall@5 and +63% relative MRR. The key advantages:
- **Term weighting**: BM25 accounts for term frequency, inverse document frequency, and document length normalization
- **OR semantics**: Documents matching more query terms rank higher, but don't require ALL terms present
- **Stop word stripping**: Removes common words (what, did, the, for) that would otherwise dominate AND-based queries

### Why Grep Fails
Grep ranks by raw match count without term importance. A file containing 10 instances of "the" outranks one with 2 instances of "charity" — catastrophic for relevance ranking on natural language queries. Grep is useful for exact-term lookup ("find all files mentioning X") but not for memory retrieval.

### Why Not Full Context?
Full conversation in the LLM context window gives perfect recall but:
1. Doesn't scale beyond the context window (419 turns is already borderline for many models)
2. Costs proportionally more tokens per query
3. FileMemoryStore exists precisely for when conversation history exceeds context limits

QMD recovers ~64% of relevant evidence at K=10, bridging most of the gap between no retrieval and full context at a fraction of the token cost.

## Implementation Details

### QmdSearchStrategy
- Backed by `@tobilu/qmd` (SQLite FTS5 inverted index)
- Lazy initialization: indexes on first search, incremental updates thereafter
- OR-based FTS5 query with stop word removal (bypasses QMD's default AND semantics)
- BM25 score normalization: `|score| / (1 + |score|)` maps to [0, 1)
- DB stored in parent directory of corpus to avoid indexing its own WAL files

### GrepSearchStrategy
- Shells out to `grep -ric` (recursive, case-insensitive, count)
- Ranks by match count per file, normalized to [0, 1]
- Zero infrastructure, no persistent state
- Best for exact keyword presence checks, not relevance ranking

### KeywordSearchStrategy
- Reads every file, tokenizes, scores by Jaccard-like token overlap
- No term weighting, no IDF
- Default fallback when no strategy is configured

## Running the Benchmark

```bash
cd strands-ts
npx tsx benchmarks/locomo/bench.ts
```

Requires `@tobilu/qmd` installed (`npm install` with `--legacy-peer-deps`).
