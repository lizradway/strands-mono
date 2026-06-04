# Intern Project: Git-Based Memory with Consolidation

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK (strands-agents/sdk-typescript)  
**Prerequisites:** Familiarity with TypeScript, git internals, LLM APIs, basic understanding of agent frameworks  
**Difficulty:** Research-oriented, medium-high implementation complexity

---

## 1. Problem Statement

The `MemoryManager` design ([PR #844](https://github.com/strands-agents/docs/pull/844)) defines how agents persist cross-session knowledge to L2 (long-term memory) via a `KnowledgeStore` interface. But it doesn't prescribe a storage format, and it doesn't address what happens to memory *over time* — knowledge accumulates, duplicates, contradicts itself, and degrades retrieval quality.

Strands is a client-side SDK — there is no server running between sessions. Any memory maintenance must happen either at session boundaries (start or end) or be explicitly invoked by the developer. This rules out background daemons or "sleep-time" processing.

This project proposes **git as the storage substrate for agent memory**, with a developer-invoked **consolidation agent** that reasons across accumulated knowledge. Git provides:

- **Version history** — full audit trail of how memory evolved, `git log` shows what changed when
- **Branching for concurrent processing** — multiple consolidation strategies can run in parallel via worktrees, then merge
- **Conflict resolution semantics** — when two processes disagree on a fact, git's merge model provides a natural resolution mechanism
- **Progressive disclosure** — file hierarchy + frontmatter controls what loads into context (agent doesn't read the entire memory every turn)
- **Developer-friendly** — diffable, inspectable, works with existing tooling (GitHub, CI, code review)

The consolidation agent is not a background process — it's a Strands agent that the developer invokes when they want memory cleaned up (at session boundaries, in a cron job, in CI, manually). The SDK provides the logic; the developer provides the trigger.

---

## 2. Background & Prior Art

### 2.1 Letta's Context Repositories

Letta (formerly MemGPT) introduced [Context Repositories](https://www.letta.com/blog/context-repositories) — agent memory stored as files in a git repo:

- Every memory change is auto-committed with informative messages
- Progressive disclosure via frontmatter (controls what's loaded into context)
- Concurrent learning via git worktrees (multiple subagents process in parallel, then merge)
- Multi-agent coordination via standard git merge/conflict resolution
- Skill learning produces versioned, diffable skill files

Key insight: **git is already an append-only log with branching, merging, and history.** These are exactly the properties you want for agent memory. Using git means you don't have to build versioning, audit trails, or concurrent access — you get them for free.

### 2.2 Strands Architecture

**Context Management Presets** ([PR #831](https://github.com/strands-agents/docs/pull/831)) defines:
- **L0** — Context window (what the model sees per request)
- **L1** — Session history (append-only log within a session)
- **L2** — Long-term memory (cross-session, backed by `MemoryManager`)

**Long-Term Memory design** ([PR #844](https://github.com/strands-agents/docs/pull/844)) defines:
- `KnowledgeStore` interface — `search(query)` required, `add(content, metadata)` optional
- Ingestion triggers: `tool`, `perTurn`, `onEviction`, `scheduled`
- Extractor interface — distills messages into discrete facts
- Two retrieval modes: active recall (`search_memory` tool) and context injection (system prompt enrichment)

**The gap:** No existing `KnowledgeStore` implementation provides versioning, audit history, progressive disclosure, or a consolidation mechanism. A git-backed store provides all of these natively.

### 2.3 The Client-Side Constraint

Strands is a client-side SDK with no server process. This means:
- No background daemons running between sessions
- No automatic "sleep-time" processing
- Memory maintenance must be developer-invoked or run at session boundaries

The consolidation agent in this project is explicitly invoked — `await memoryStore.consolidate()` — not a background process. The developer decides when to run it (session start, session end, cron job, CI pipeline, manually).

---

## 3. Project Goals

### Primary Goal
Design and implement a git-backed `KnowledgeStore` with a consolidation agent, producing a memory system that improves over time through developer-invoked maintenance operations.

### Success Criteria
1. A working `GitKnowledgeStore` implementing the `KnowledgeStore` interface
2. Progressive disclosure — file hierarchy + frontmatter controls what loads into context
3. A consolidation agent that deduplicates, corrects contradictions, and draws inferences across accumulated facts
4. Concurrent consolidation via git worktrees (multiple strategies run in parallel, merge results)
5. Full audit trail — `git log` shows complete memory evolution history
6. Benchmarked improvement in retrieval quality after consolidation
7. Developer-ergonomic API for invoking consolidation at session boundaries or externally

---

## 4. Technical Design

### 4.1 Architecture

```
Developer invokes:
  await store.consolidate()     ← at session end, in cron, in CI, manually

┌─────────────────────────────────────────────────────┐
│              GitKnowledgeStore                        │
│                                                       │
│  .memory/                     (git repo)              │
│  ├── facts/                                           │
│  │   ├── user-preferences.md                         │
│  │   ├── project-context.md                          │
│  │   └── decisions.md                                │
│  ├── sessions/                                        │
│  │   ├── 2026-06-01.md       (session summaries)     │
│  │   └── 2026-06-02.md                               │
│  └── .metadata/                                       │
│      ├── index.json          (search index)          │
│      └── consolidation.json  (last run state)        │
│                                                       │
│  On add(): write fact → git commit                    │
│  On search(): read files + metadata index             │
│  On consolidate(): spawn consolidation agent          │
│                                                       │
└─────────────────────────────────────────────────────┘
         │
         │ consolidation agent runs as a Strands agent
         ▼
┌─────────────────────────────────────────────────────┐
│           Consolidation Agent                         │
│                                                       │
│  Tools:                                               │
│  ├── readMemoryFiles()   — read current memory state │
│  ├── searchMemory()      — find related facts        │
│  ├── updateFact()        — rewrite/merge facts       │
│  ├── deprecateFact()     — mark as superseded        │
│  ├── createFact()        — add derived knowledge     │
│  └── done()              — finish consolidation      │
│                                                       │
│  Operations:                                          │
│  ├── Deduplicate         — merge redundant entries   │
│  ├── Correct             — resolve contradictions    │
│  ├── Infer               — derive new conclusions    │
│  └── Reorganize          — restructure file layout   │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### 4.2 GitKnowledgeStore Interface

```typescript
import { KnowledgeStore, KnowledgeEntry } from '@strands-agents/sdk'

export class GitKnowledgeStore implements KnowledgeStore {
  constructor(config: GitStoreConfig)

  // KnowledgeStore interface
  async search(query: string, options?: SearchOptions): Promise<KnowledgeEntry[]>
  async add(content: string, metadata?: Record<string, unknown>): Promise<void>

  // Git-specific capabilities
  async consolidate(options?: ConsolidateOptions): Promise<ConsolidateResult>
  async history(path?: string): Promise<MemoryCommit[]>
  async diff(since?: string): Promise<MemoryDiff>
  async rollback(commitSha: string): Promise<void>
}

interface GitStoreConfig {
  path: string                      // path to git repo (created if doesn't exist)
  model?: Model                     // model for consolidation agent
  autoCommit?: boolean              // commit on every add() (default: true)
  progressiveDisclosure?: {
    maxTokensPerFile?: number       // limit what's loaded from each file
    priorityFields?: string[]       // frontmatter fields that control loading priority
  }
}

interface ConsolidateOptions {
  operations?: ('deduplicate' | 'correct' | 'infer' | 'reorganize')[]
  maxIterations?: number            // consolidation agent reasoning cycles
  concurrent?: boolean             // use git worktrees for parallel processing
  dryRun?: boolean                 // show what would change without committing
}

interface ConsolidateResult {
  merged: number                   // facts deduplicated
  corrected: number                // contradictions resolved
  inferred: number                 // new facts derived
  tokensUsed: number               // cost of consolidation
  commits: string[]                // git commit SHAs produced
}
```

### 4.3 Memory File Format

Each memory file is a markdown document with structured frontmatter:

```markdown
---
topic: user-preferences
priority: high
lastUpdated: 2026-06-02
sources: [session-2026-06-01, session-2026-06-02]
confidence: 0.9
---

# User Preferences

- Prefers TypeScript over JavaScript
- Uses VS Code with vim keybindings
- Works on microservices architecture
- Database: PostgreSQL (switched from MongoDB in March 2026)
```

**Progressive disclosure:** When the agent requests memory, `GitKnowledgeStore` doesn't load every file. It:
1. Reads the index (file topics + priorities)
2. Selects files relevant to the current query
3. Respects token budget (loads high-priority files first, stops at budget)
4. Loads only the content section (skipping verbose history if not needed)

### 4.4 Commit Semantics

Every memory operation produces an informative git commit:

```
memory: add fact about user database preference
memory: consolidate — merged 3 duplicate entries about TypeScript preference
memory: correct — "works at Company A" superseded by "works at Company B" (recency)
memory: infer — user likely deploying containerized services (from: Kubernetes + microservices)
```

This means `git log --oneline .memory/` gives a human-readable history of the agent's knowledge evolution.

### 4.5 Concurrent Consolidation via Worktrees

For large memory stores, different consolidation operations can run in parallel:

```typescript
async consolidateConcurrent(): Promise<ConsolidateResult> {
  // Create worktrees for each operation
  const [dedup, correct, infer] = await Promise.all([
    this.runInWorktree('deduplicate', deduplicationAgent),
    this.runInWorktree('correct', correctionAgent),
    this.runInWorktree('infer', inferenceAgent),
  ])

  // Merge results back (git merge with conflict resolution)
  await this.mergeWorktree('deduplicate')
  await this.mergeWorktree('correct')
  await this.mergeWorktree('infer')

  return combineResults(dedup, correct, infer)
}
```

**Conflict resolution:** If two operations modify the same fact (e.g., dedup merges two entries while correction updates one of them), the merge produces a conflict. The consolidation agent resolves it — or flags it for the developer.

### 4.6 Search Implementation

Git doesn't have semantic search, so retrieval combines:

1. **Keyword search** — `git grep` over memory files (fast, zero-cost)
2. **Metadata index** — JSON index mapping topics/tags to file paths (fast lookup)
3. **Embedding index** (optional) — pre-computed embeddings stored in `.metadata/embeddings.json`, cosine similarity at query time

```typescript
async search(query: string, options?: SearchOptions): Promise<KnowledgeEntry[]> {
  const results: ScoredEntry[] = []

  // Fast path: keyword match
  const keywordHits = await this.gitGrep(query)
  results.push(...keywordHits.map(h => ({ ...h, score: 1.0 })))

  // Metadata path: topic/tag match
  const topicHits = this.index.findByTopic(query)
  results.push(...topicHits.map(h => ({ ...h, score: 0.8 })))

  // Optional: embedding similarity
  if (this.embeddings) {
    const semanticHits = await this.embeddings.search(query, options?.limit)
    results.push(...semanticHits)
  }

  return dedupeAndRank(results).slice(0, options?.limit ?? 10)
}
```

### 4.7 Integration with MemoryManager

`GitKnowledgeStore` plugs directly into the existing `MemoryManager` design:

```typescript
const store = new GitKnowledgeStore({
  path: './.agent-memory',
  model: consolidationModel,
})

const agent = new Agent({
  model,
  memoryManager: new MemoryManager({
    stores: [{ store, ingestion: { trigger: 'perTurn', extractor } }],
    includeTools: true,
  }),
})

// Developer invokes consolidation when appropriate
// At session end:
process.on('beforeExit', async () => {
  await store.consolidate({ operations: ['deduplicate', 'correct'] })
})

// Or in a cron job / CI pipeline:
// npx strands-memory consolidate --path ./.agent-memory --operations all
```

---

## 5. Evaluation Plan

### 5.1 Retrieval Quality (Before/After Consolidation)

- Seed memory with 10 sessions of simulated conversation (producing ~100 raw facts)
- Query with 20 questions that require recalled knowledge
- Measure precision@5 and recall before consolidation
- Run consolidation
- Measure again after
- Target: >25% improvement in retrieval precision after consolidation

### 5.2 Deduplication Effectiveness

- Seed memory with known duplicates (5x each of 20 facts = 100 entries with 80 redundant)
- Run consolidation with `deduplicate` only
- Measure: what percentage of true duplicates were merged?
- Target: >85% deduplication rate with <5% false merges

### 5.3 Contradiction Resolution

- Seed memory with 10 known contradictions (same entity, different values, different timestamps)
- Run consolidation with `correct` only
- Measure: accuracy of resolution (did it pick the right/newer value?)
- Target: >90% correct resolution

### 5.4 Concurrent Processing Benefit

- Compare sequential vs. concurrent consolidation (worktrees)
- Measure: wall-clock time, merge conflict rate, result quality
- Determine: is concurrent worth the complexity?

### 5.5 Progressive Disclosure Effectiveness

- Build memory store with 50+ files (large)
- Measure: tokens loaded with/without progressive disclosure
- Measure: retrieval accuracy with/without (does loading less hurt accuracy?)
- Target: >50% token reduction with <10% accuracy loss

### 5.6 Cost Model

- Measure tokens consumed per consolidation run at different memory sizes (50, 100, 500 facts)
- Determine breakeven: how many sessions before consolidation pays for itself in improved retrieval?

---

## 6. Timeline

### Phase 1: Foundation (Weeks 1-3)

**Week 1: Orientation + Design**
- Read MemoryManager design (PR #844), context strategy design (PR #831), Letta's Context Repositories blog
- Study existing `KnowledgeStore` implementations (`InMemoryKnowledgeStore`, `FileKnowledgeStore`)
- Design the git memory file format (frontmatter, directory structure, commit semantics)
- Design the `GitKnowledgeStore` interface

**Week 2: Core Store Implementation**
- Implement `GitKnowledgeStore` — `add()`, `search()`, auto-commit
- Implement memory file format (markdown + frontmatter)
- Implement metadata index (JSON, updated on write)
- Implement `history()` and `diff()` methods
- Unit tests: add facts, search, verify commits

**Week 3: Progressive Disclosure + Search**
- Implement progressive disclosure (priority-based file loading, token budgets)
- Implement multi-strategy search (keyword + metadata + optional embeddings)
- Implement `rollback()` for undoing bad consolidation
- Integration test: full `MemoryManager` integration with `GitKnowledgeStore`

### Phase 2: Consolidation Agent (Weeks 4-6)

**Week 4: Consolidation — Deduplication + Correction**
- Build the consolidation agent (Strands agent with memory-manipulation tools)
- Implement `deduplicate` operation (find similar entries, merge)
- Implement `correct` operation (find contradictions, resolve via recency)
- Test with synthetic duplicate/contradictory fact sets

**Week 5: Consolidation — Inference + Reorganization**
- Implement `infer` operation (cross-fact reasoning, derive new conclusions)
- Implement `reorganize` operation (restructure file layout for better retrieval)
- Test end-to-end: multi-session agent → accumulate facts → consolidate → verify improvement

**Week 6: Concurrent Consolidation**
- Implement git worktree-based parallel processing
- Run different operations in separate worktrees simultaneously
- Implement merge logic + conflict resolution
- Benchmark: sequential vs. concurrent (speed + quality)

### Phase 3: Evaluation (Weeks 7-9)

**Week 7: Benchmark Framework**
- Build evaluation harness (seed memory, run queries, score results)
- Implement all metrics (precision, deduplication rate, contradiction resolution accuracy)
- Run baseline benchmarks (before consolidation)

**Week 8: Full Benchmarks**
- Run consolidation on benchmark sets
- Measure all metrics before/after
- Test progressive disclosure effectiveness
- Produce cost model (tokens per consolidation at various memory sizes)

**Week 9: Analysis + CLI**
- Analyze results — which operations help most? When is concurrent worth it?
- Build CLI tool (`npx strands-memory consolidate`) for developer-invoked maintenance
- Document recommended consolidation schedule for different use cases

### Phase 4: Polish (Week 10)

**Week 10: Deliverables**
- Final code cleanup and comprehensive tests
- Write integration guide and API documentation
- Benchmark report with recommendations
- Design doc for inclusion in `strands-agents/docs/designs/`
- Present findings to team

---

## 7. Key Research Questions

1. **Does git add meaningful value over plain files?** The version history and branching are nice, but do they justify git's complexity? Would a simpler append-only file store with explicit snapshots work just as well?

2. **Is progressive disclosure (file hierarchy) competitive with embedding-based retrieval?** For structured domains (user preferences, project decisions) it might be better. For unstructured knowledge it might be worse. Where's the boundary?

3. **How often should consolidation run?** Every session end? Every 10 sessions? Only when retrieval quality degrades? What's the right cadence for different use cases?

4. **Does concurrent consolidation produce better results?** Running dedup/correct/infer in parallel via worktrees is faster, but merge conflicts might produce worse results than sequential processing where each operation sees the previous one's output.

5. **What's the right file granularity?** One file per topic? One file per fact? One giant file? The choice affects retrieval, progressive disclosure, and consolidation granularity.

6. **How does memory size scale?** At 50 facts, everything is fine. At 5,000 facts, does git-based memory still work? Where do file count, search performance, and consolidation cost become problems?

7. **Can the consolidation agent be trusted?** If it incorrectly merges two facts or draws a wrong inference, the damage persists. How to validate consolidation quality? Is `dryRun` + human review the right pattern?

---

## 8. Resources

### Prior Art
- [Letta Context Repositories](https://www.letta.com/blog/context-repositories) — git-backed agent memory with concurrent worktree processing
- [MemGPT (Packer et al., 2023)](https://arxiv.org/abs/2310.08560) — foundational agent memory architecture
- [Sleep-time Compute (Lin et al., 2025)](https://arxiv.org/abs/2504.13171) — offline memory consolidation (Letta's theoretical basis)

### Strands Designs
- [PR #831](https://github.com/strands-agents/docs/pull/831) (`designs/0010-context-strategy.md`) — context management presets (L0/L1/L2 hierarchy)
- [PR #844](https://github.com/strands-agents/docs/pull/844) (`designs/0011-knowledge-bases.md`) — MemoryManager primitive (KnowledgeStore interface)

### Key Interfaces
- `KnowledgeStore` — `search(query)` + `add(content, metadata)`
- `Extractor` — `extract(messages): Promise<{ content, metadata }[]>`
- `MemoryManagerConfig` — stores, ingestion, tools configuration
- Existing implementations: `InMemoryKnowledgeStore`, `FileKnowledgeStore`, `BedrockKnowledgeBaseStore`

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Git adds complexity without sufficient value | Medium | High | Benchmark against plain `FileKnowledgeStore` + manual snapshots. If git's value-add is minimal, document why and recommend the simpler approach. A negative result is valid. |
| Consolidation agent makes bad edits (corrupts memory) | Medium | High | Always commit before consolidation (rollback point). Implement `dryRun` mode. Add validation step after consolidation (check that key facts survived). |
| Search quality is poor without embeddings | High | Medium | Start with keyword + metadata index. Add optional embedding layer. Benchmark each search strategy independently. For structured memory (preferences, decisions), keyword may suffice. |
| Git worktree complexity isn't worth it for typical memory sizes | Medium | Low | Implement sequential consolidation first. Add concurrent as an optimization. Benchmark to determine the memory size threshold where concurrent helps. |
| Memory file format is too rigid/too loose | Medium | Medium | Start simple (one file per topic, markdown + frontmatter). Iterate based on what the consolidation agent struggles with. The format can evolve. |
| Developer forgets to invoke consolidation (memory degrades) | High | Medium | Provide clear API hooks for session boundaries. Document recommended patterns. Consider a `warnOnDegradation` option that logs when retrieval quality drops. |

---

## 10. What "Done" Looks Like

At the end of 10 weeks, the intern delivers:

1. **`GitKnowledgeStore`** — a `KnowledgeStore` implementation backed by a local git repo, with versioning, progressive disclosure, and multi-strategy search
2. **Consolidation agent** — a Strands agent that deduplicates, corrects, infers, and reorganizes memory when invoked
3. **Concurrent processing** — optional worktree-based parallelism for consolidation operations
4. **CLI tool** — `npx strands-memory consolidate` for developer-invoked maintenance
5. **Benchmark results** — quantified improvement in retrieval quality after consolidation, cost model, comparison to non-git alternatives
6. **Integration with MemoryManager** — plugs directly into the existing `stores` config
7. **A presentation** — 15-minute demo showing memory evolution, consolidation, and git history

---

## Appendix: Example Walkthrough

### Session 1
```
User: "I'm working on the payments service. We use Stripe."
→ store.add("User works on payments service")  
→ store.add("Payments service uses Stripe")
→ git commit: "memory: add facts about user's project (payments, Stripe)"
```

### Session 5
```
User: "We switched to Stripe Connect last week."
→ store.add("Switched to Stripe Connect")
→ git commit: "memory: add fact about Stripe Connect migration"
```

### Developer invokes consolidation (e.g., at session end)
```typescript
const result = await store.consolidate({
  operations: ['deduplicate', 'correct', 'infer'],
})
```

**Git log after consolidation:**
```
a1b2c3d memory: consolidate — merged 2 entries about Stripe into 1
f4e5d6c memory: correct — "uses Stripe" superseded by "uses Stripe Connect" (recency)
7g8h9i0 memory: infer — webhook issues may relate to Connect migration
```

### Session 6
```
User: "Why is the webhook failing?"
→ store.search("webhook failing")
→ Returns: "Webhook issues may relate to Stripe Connect migration (Connect uses different event types)"
→ Agent answers accurately without re-deriving the connection
```

### Developer inspects memory history
```bash
$ git log --oneline .agent-memory/
7g8h9i0 memory: infer — webhook issues may relate to Connect migration
f4e5d6c memory: correct — "uses Stripe" superseded by "uses Stripe Connect"
a1b2c3d memory: consolidate — merged 2 entries about Stripe into 1
... (full history of every fact learned and every consolidation run)

$ git diff HEAD~3 .agent-memory/facts/project-context.md
# Shows exactly what consolidation changed
```
