# Intern Project: Git-Based Memory

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK (strands-agents/sdk-typescript)  
**Prerequisites:** Familiarity with TypeScript, git internals, LLM APIs, basic understanding of agent frameworks  
**Difficulty:** Research-oriented, medium-high implementation complexity

---

## Overview

Build a unified git-backed storage layer that serves as both the `ContextManager`'s L1 backend and the `MemoryManager`'s `KnowledgeStore` — a single versioned repository containing session history, extracted facts, and learned skills. Includes a developer-invoked consolidation agent that reasons across accumulated knowledge to deduplicate, correct contradictions, and derive new insights.

Inspired by Letta's [Context Repositories](https://www.letta.com/blog/context-repositories): one git repo is the single source of truth for everything an agent has learned and experienced. The Strands APIs stay unchanged — ContextManager still owns L0↔L1 movement, MemoryManager still owns L1→L2 extraction — but the physical storage converges into one versioned, inspectable, diffable repo.

---

## How It Fits the Existing APIs

```typescript
const gitStore = new GitMemoryStore({ path: './.agent-memory' })

const agent = new Agent({
  model,
  contextManager: {
    strategy: 'auto',
    storage: gitStore,        // L1 — session batches written here
  },
  memoryManager: new MemoryManager({
    stores: [{
      store: gitStore,        // L2 — extracted knowledge written here
      ingestion: { trigger: 'perTurn', extractor },
    }],
    injection: true,          // relevant knowledge injected into system prompt
    includeTools: true,       // agent gets search_memory + store_memory
  }),
})
```

The `GitMemoryStore` implements two interfaces:
- `Storage` (for ContextManager) — `writeBatch()`, `readBatch()`, `listBatches()`
- `KnowledgeStore` (for MemoryManager) — `search(query)`, `add(content, metadata)`

Both write to the same git repo in different directories:

```
.agent-memory/                    (one git repo, auto-committed)
├── sessions/                     ← L1 (ContextManager writes session batches)
│   ├── batch-001.json
│   └── batch-002.json
├── facts/                        ← L2 (extracted knowledge)
│   ├── user-preferences.md
│   ├── project-context.md
│   └── decisions.md
├── skills/                       ← L2 (learned reusable strategies)
│   └── debugging-approach.md
└── .metadata/
    ├── index.json                (search index — topics, tags, paths)
    └── consolidation.json        (last consolidation state)
```

### What Each Layer Still Owns

| Layer | Responsibility | What it writes to git |
|-------|---------------|----------------------|
| **ContextManager** (L0↔L1) | Compression, tool result caching, session history | `sessions/` — batch files of evicted messages |
| **MemoryManager** (L1→L2) | Extraction, retrieval, ingestion triggers | `facts/`, `skills/` — extracted knowledge |
| **Consolidation** (developer-invoked) | Dedup, correct, infer, reorganize | Modifies `facts/` and `skills/` in-place |
| **Git** (infrastructure) | Versioning, audit trail, rollback | Auto-commits on every write from any layer |

### Progressive Disclosure

Not every file is loaded into context every turn. The store uses a priority-based loading strategy:

1. **Always loaded:** files in a designated high-priority section (like Letta's `system/` directory)
2. **Query-matched:** files whose topic/tags match the current query (via metadata index)
3. **Token-budgeted:** loading stops when the injection token budget is reached

This maps to MemoryManager's `injection` config:
```typescript
injection: {
  maxTokens: 2000,           // budget for injected content
  query: (messages) => lastSubstantiveMessage(messages),  // what to search for
}
```

---

## What Gets Built

### 1. GitMemoryStore (unified storage)

A single class implementing both `Storage` (for ContextManager) and `KnowledgeStore` (for MemoryManager):
- Auto-commits every write with informative messages
- Maintains a metadata index for fast search
- Supports progressive disclosure (priority-based loading)
- Provides `history()`, `diff()`, `rollback()` for developer inspection
- Multi-strategy search: keyword (git grep) + metadata index + optional embeddings

### 2. Consolidation Agent

A Strands agent invoked by the developer (`await store.consolidate()`) that:
- **Deduplicates** — finds and merges redundant entries
- **Corrects** — resolves contradictions (recency-based or flagged for human review)
- **Infers** — draws conclusions across facts that span sessions
- **Reorganizes** — restructures files for better retrieval

Runs at session boundaries, in a cron job, in CI, or manually — not as a background daemon.

### 3. Concurrent Consolidation via Worktrees

Different consolidation operations can run in parallel via git worktrees:
- Each operation gets its own worktree (isolated copy)
- Results merge back to main branch
- Conflicts resolved by the consolidation agent (or flagged)

### 4. Skill Learning (stretch goal)

Agent reflects on task trajectories and generates reusable "skill files" — markdown documents containing approaches, pitfalls, and strategies. Stored in `skills/`, discovered on demand at runtime.

### 5. CLI Tool

`npx strands-memory consolidate --path ./.agent-memory` for developer-invoked maintenance outside of agent sessions.

---

## Success Criteria

1. **Working `GitMemoryStore`** implementing both `Storage` and `KnowledgeStore` interfaces
2. **Unified git repo** containing L1 session history + L2 knowledge in one versioned, inspectable store
3. **Progressive disclosure** — token-budgeted loading that selects relevant files per query
4. **Consolidation agent** that measurably improves retrieval quality (>25% precision improvement)
5. **Full audit trail** — `git log` shows complete memory evolution across sessions
6. **Developer ergonomics** — `consolidate()`, `history()`, `diff()`, `rollback()` APIs work naturally
7. **Benchmark results** — comparison against non-git alternatives (plain FileKnowledgeStore, InMemoryKnowledgeStore)

---

## Timeline (High Level)

| Phase | Weeks | Focus |
|-------|-------|-------|
| Foundation | 1-3 | GitMemoryStore core (dual interface, auto-commit, search, progressive disclosure) |
| Consolidation | 4-6 | Consolidation agent (dedup, correct, infer), concurrent worktree processing |
| Evaluation | 7-9 | Benchmarks (retrieval quality before/after, cost model, comparison to alternatives) |
| Polish | 10 | CLI tool, documentation, design doc, presentation |

---

## Key Research Questions

1. **Does git add value over plain files?** Version history + branching are elegant, but is the complexity justified? Benchmark against `FileKnowledgeStore` + manual snapshots.

2. **Is progressive disclosure competitive with embedding-based retrieval?** For structured memory (preferences, decisions) it may be better. For unstructured knowledge it may be worse.

3. **How often should consolidation run?** Every session? Every N sessions? Only when retrieval quality degrades?

4. **Unified L1+L2 in one repo — does the git history add noise?** Session batch commits are high-frequency and low-signal. Does interleaving them with knowledge commits make `git log` less useful?

5. **Does concurrent consolidation (worktrees) produce better results than sequential?** Merge conflicts may hurt quality.

6. **How does memory size scale?** At what point do file count, search performance, and consolidation cost become problems?

---

## Why This Project

- **Fits the existing APIs** — implements `Storage` + `KnowledgeStore`, plugs into ContextManager and MemoryManager unchanged
- **Client-side native** — git is local, no server needed. Consolidation is developer-invoked, not a background daemon.
- **Developer-friendly** — memory is inspectable (`git log`, `git diff`), diffable, rollbackable. No opaque vector DB.
- **Novel for Strands** — Letta is the only framework doing this. Strands would be second.
- **Research-rich** — progressive disclosure, consolidation effectiveness, skill learning all have open questions worth exploring
- **Immediately useful** — any Strands agent with `memoryManager` can swap in `GitMemoryStore` and get versioned, consolidatable memory

---

## Resources

### Prior Art
- [Letta Context Repositories](https://www.letta.com/blog/context-repositories) — git-backed memory with progressive disclosure and concurrent worktrees
- [MemGPT (Packer et al., 2023)](https://arxiv.org/abs/2310.08560) — foundational agent memory architecture
- [Sleep-time Compute (Lin et al., 2025)](https://arxiv.org/abs/2504.13171) — memory consolidation theory

### Strands Designs
- [PR #831](https://github.com/strands-agents/docs/pull/831) (`designs/0010-context-strategy.md`) — ContextManager, L0/L1/L2 hierarchy, `Storage` interface
- [PR #844](https://github.com/strands-agents/docs/pull/844) (`designs/0011-knowledge-bases.md`) — MemoryManager, `KnowledgeStore` interface

### Key Interfaces to Implement
- `Storage` — `writeBatch()`, `readBatch()`, `listBatches()` (ContextManager's L1 backend)
- `KnowledgeStore` — `search(query)`, `add(content, metadata)` (MemoryManager's L2 backend)
- `InjectionConfig` — `maxTokens`, `format`, `query` (controls progressive disclosure)
