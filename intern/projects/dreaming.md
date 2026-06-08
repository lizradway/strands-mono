# Intern Project: Git-Based Agent Memory

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK (strands-agents/sdk-typescript)  
**Prerequisites:** Familiarity with TypeScript, git, LLM APIs, basic understanding of agent frameworks

---

## Overview

Build a unified git-backed storage layer for Strands agents that serves as both the ContextManager's L1 backend and the MemoryManager's KnowledgeStore. One versioned, inspectable, diffable repository containing everything an agent has learned and experienced — session history, extracted facts, and learned skills.

Inspired by Letta's [Context Repositories](https://www.letta.com/blog/context-repositories). The Strands APIs stay unchanged — ContextManager still owns L0↔L1, MemoryManager still owns L1→L2 — but the physical storage converges into one git repo with developer-invoked consolidation.

---

## Problem

Strands agents have no persistent, versioned memory substrate. Knowledge extracted by MemoryManager goes into a store with no history, no audit trail, no way to inspect what changed when, and no mechanism to improve quality over time. Session history (L1) and long-term knowledge (L2) live in separate, disconnected backends with no shared context.

Meanwhile, memory quality degrades as it accumulates — duplicates, contradictions, and isolated facts that could be powerful when combined but never are. There's no maintenance mechanism built into the SDK.

---

## Goals

Build a `GitMemoryStore` that:

1. **Unifies L1 and L2** — implements both the `Storage` interface (for ContextManager) and `KnowledgeStore` interface (for MemoryManager) against a single local git repo
2. **Auto-versions everything** — every write from any layer produces an informative git commit
3. **Supports progressive disclosure** — not everything loads into context every turn; relevant knowledge is selected based on the current query within a token budget
4. **Includes a consolidation agent** — a developer-invoked Strands agent that reasons across accumulated knowledge to deduplicate, resolve contradictions, and derive new insights
5. **Enables concurrent consolidation** — multiple consolidation operations can run in parallel via git worktrees and merge results
6. **Remains client-side** — no server, no daemon. Consolidation runs when the developer invokes it (session boundary, cron, CI, manually).

---

## Success Criteria

1. A working `GitMemoryStore` that plugs into both `contextManager.storage` and `memoryManager.stores` — passing integration tests with the existing SDK
2. `git log` on the memory repo tells a coherent, human-readable story of what the agent learned and when
3. Consolidation measurably improves retrieval quality (>25% precision@5 improvement on a benchmark of multi-session Q&A)
4. Progressive disclosure reduces tokens loaded per turn (>50% reduction vs. loading everything) without significant accuracy loss (<10%)
5. A developer can inspect, diff, and rollback agent memory using standard git tooling
6. A CLI entrypoint for running consolidation outside of an agent session
7. Benchmark comparison against non-git alternatives (FileKnowledgeStore, InMemoryKnowledgeStore) showing where git adds value and where it doesn't
8. A deployed end-to-end example — a Strands agent (code review, coding assistant, or similar) that uses `GitMemoryStore` for memory accumulation across sessions, with scheduled consolidation via GitHub Actions. Publishable as a labs/devtools sample or community example demonstrating the full lifecycle: agent learns → memory accumulates → consolidation improves → agent gets better over time

---

## Deployment Note

Since Strands is a client-side SDK with no server process, consolidation needs an external trigger. The natural pattern: a scheduled GitHub Action that runs the consolidation agent and commits results back to the memory repo. This sidesteps the "no daemon" constraint — CI is the server. The memory repo is already git, so committing consolidated results and pushing is native to the storage model.

---

## Research Questions to Explore

- Does git add meaningful value over plain files? Is the version history and branching worth the complexity?
- Is file-hierarchy-based retrieval (progressive disclosure) competitive with embedding-based retrieval?
- How often should consolidation run, and which operations (dedup, correction, inference) are worth their cost?
- Does concurrent consolidation via worktrees produce better or worse results than sequential?
- How does the system scale as memory grows (100 facts → 1,000 → 10,000)?
- Can skill learning (reflecting on trajectories to produce reusable strategy files) meaningfully improve agent performance over time?

---

## Prior Art & Resources

- [Letta Context Repositories](https://www.letta.com/blog/context-repositories) — the reference implementation (git-backed, progressive disclosure, worktrees)
- [MemGPT (Packer et al., 2023)](https://arxiv.org/abs/2310.08560) — foundational agent memory architecture
- [Sleep-time Compute (Lin et al., 2025)](https://arxiv.org/abs/2504.13171) — memory consolidation theory
- [PR #831](https://github.com/strands-agents/docs/pull/831) — ContextManager design (`Storage` interface for L1)
- [PR #844](https://github.com/strands-agents/docs/pull/844) — MemoryManager design (`KnowledgeStore` interface for L2)
