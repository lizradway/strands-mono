# Intern Project Brief: Sleep-Time Compute for Strands Agents

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK (strands-agents/sdk-typescript)  
**Prerequisites:** Familiarity with TypeScript, LLM APIs, basic understanding of agent frameworks  
**Difficulty:** Research-oriented, medium-high implementation complexity

---

## 1. Problem Statement

Strands agents today process knowledge only during active conversations. The `MemoryManager` design (PR #844) enables agents to persist facts to L2 (long-term memory) via extractors that distill messages into discrete knowledge entries. But extraction is a single-pass, write-and-forget operation — it captures *what was said*, not *what it means in the context of everything else the agent knows*.

Over time, an agent's L2 accumulates:
- Redundant entries ("user prefers dark mode" stored 5 times across sessions)
- Contradictory facts ("user works at Company A" from January, "user works at Company B" from March)
- Isolated facts that become powerful *when combined* but are never combined
- Raw observations that could be distilled into higher-order conclusions

The result: retrieval quality degrades as memory grows. The agent finds *more* results but *worse* results. Context injection fills the token budget with noise. Active recall returns outdated or duplicated entries.

**Sleep-time compute** solves this by dedicating offline compute — between sessions, during idle periods — to reasoning about accumulated knowledge. A background agent consolidates, infers, deduplicates, and restructures the memory store so that future retrieval returns higher-quality, denser information.

---

## 2. Background & Prior Art

### 2.1 The Paper

**"Sleep-time Compute: Beyond Inference Scaling at Test-time"** (Lin et al., 2025, arXiv 2504.13171)

Key findings:
- Introduces a two-phase inference model: **sleep phase** (offline enrichment of context) → **test phase** (query answering with enriched context)
- Demonstrated **5x reduction** in test-time compute for equivalent accuracy
- **13-18% accuracy improvements** when scaling sleep-time compute
- Economically favorable when **4+ queries share the same context** (amortization)
- Most effective when queries are **predictable from context**

The mechanism: iterative calls to `rethink_memory()` (up to 10 rounds), where the model progressively enriches a context representation by drawing inferences, reorganizing information, and pre-computing useful intermediate results.

### 2.2 Letta's Implementation

Letta (formerly MemGPT) ships sleep-time compute as a **dual-agent architecture** (v0.7.0+):

- **Primary agent** — handles user interactions (fast model, e.g., gpt-4o-mini)
- **Sleep-time agent** — manages memory editing asynchronously (stronger model, e.g., gpt-4)

The sleep-time agent has three tools executed in order:
1. `store_memories()` — processes message segments into archival memory
2. `rethink_user_memory()` — iteratively rewrites memory blocks (loops)
3. `finish_rethinking_memory()` — terminates the loop

Key architectural choice: the sleep-time agent writes to the *primary agent's* memory, not its own. It's a background service that improves another agent's knowledge store.

### 2.3 Strands Architecture (Context for This Project)

**Context Management Presets** (PR #831 — `designs/0010-context-strategy.md`) defines a three-tier cache hierarchy:
- **L0** — Context window (`agent.messages`, what the model sees per request)
- **L1** — Session history (append-only log, cursor-scoped, backed by `ContextManager` storage)
- **L2** — Long-term memory (cross-session knowledge, backed by `MemoryManager`)

The `contextManager` parameter on `Agent` owns L0 ↔ L1 movement (compression, tool result caching, navigation). Two strategies — `"auto"` (framework-driven) and `"agentic"` (agent-in-the-loop) — determine who controls what stays in L0.

**Long-Term Memory design** (PR #844 — `designs/0011-knowledge-bases.md`) defines how L2 works:
- `MemoryManager` — top-level primitive on `AgentConfig`, owns cross-session knowledge
- `KnowledgeStore` interface — `search(query)` required, `add(content, metadata)` optional
- Ingestion triggers: `tool`, `perTurn`, `onEviction`, `scheduled`
- `Extractor` interface — distills messages into discrete facts via a model call
- Multi-store orchestration — personal, team, org stores queried simultaneously
- Two retrieval mechanisms: active recall (agent calls `search_memory` tool) and context injection (system prompt enrichment every turn)

**The gap this project fills:** There is no mechanism that *reasons across* stored knowledge. Extraction creates L2 entries; sleep-time compute *improves* them.

---

## 3. Project Goals

### Primary Goal
Design and implement a sleep-time compute module for Strands that improves L2 memory quality through offline reasoning, and validate its effectiveness through benchmarking.

### Success Criteria
1. A working `SleepTimeProcessor` (or similar) that integrates with `MemoryManager`
2. Measurable improvement in retrieval quality (precision/recall on memory queries)
3. Measurable reduction in test-time token usage for equivalent task performance
4. A cost model showing when sleep-time compute is economically worthwhile
5. Clear documentation and integration guide

---

## 4. Technical Design

### 4.1 Architecture

```
                         ┌──────────────────┐
                         │   Primary Agent   │
                         │  (user-facing)    │
                         └────────┬─────────┘
                                  │ reads from L2
                                  ▼
┌──────────────────┐    ┌──────────────────┐
│  Sleep-Time      │───▶│  KnowledgeStore  │◀─── MemoryManager ingestion
│  Processor       │    │  (L2 backing)    │     writes raw facts here
│                  │    └──────────────────┘
│  - Reads L1 + L2│             ▲
│  - Reasons       │             │ writes enriched entries
│  - Writes back   │─────────────┘
└──────────────────┘
```

The sleep-time processor is a Strands agent that:
- **Reads from** L1 (recent session history) and L2 (existing memories)
- **Reasons about** the accumulated knowledge using iterative tool calls
- **Writes back** enriched, consolidated, or inferred entries to L2

### 4.2 Core Interface

```typescript
interface SleepTimeConfig {
  // When to run
  trigger: SleepTimeTrigger | SleepTimeTrigger[]

  // What model to use for reasoning (can differ from primary agent)
  model?: Model

  // How many rethinking iterations (paper uses up to 10)
  maxIterations?: number

  // Which stores to process (default: all writable stores)
  stores?: string[]

  // Token budget for sleep-time processing per run
  maxTokens?: number

  // Operations to perform
  operations?: SleepTimeOperation[]
}

type SleepTimeTrigger =
  | 'onSessionEnd'        // After session closes
  | 'onIdle'              // No interaction for N seconds
  | 'scheduled'           // Every N sessions or time interval
  | 'manual'              // Explicit API call

type SleepTimeOperation =
  | 'consolidate'         // Merge redundant entries
  | 'infer'              // Draw conclusions across facts
  | 'anticipate'         // Pre-compute likely-needed answers
  | 'reorganize'         // Restructure for better retrieval
  | 'correct'            // Resolve contradictions (newer wins)
```

### 4.3 Integration with MemoryManager

```typescript
const agent = new Agent({
  model,
  memoryManager: new MemoryManager({
    stores: [{ store: userStore, ingestion: { trigger: 'perTurn', extractor } }],
    sleepTime: {
      trigger: ['onSessionEnd', 'onIdle'],
      model: cheaperReasoningModel,    // or stronger model for deeper reasoning
      maxIterations: 5,
      operations: ['consolidate', 'infer', 'correct'],
    },
  }),
})
```

### 4.4 Sleep-Time Agent Tools

The sleep-time processor uses these tools internally:

| Tool | Purpose | Maps to |
|------|---------|---------|
| `readRecentHistory` | Load messages from L1 since last sleep cycle | `ContextManager.storage` read |
| `searchMemory` | Query existing L2 entries | `KnowledgeStore.search()` |
| `rethinkMemory` | Iteratively rewrite/enrich a set of entries | Internal reasoning loop |
| `storeInsight` | Write new derived knowledge | `KnowledgeStore.add()` |
| `deprecateEntry` | Mark an entry as superseded | Metadata update on store |
| `finishRethinking` | Terminate the reasoning loop | Control flow |

### 4.5 Sleep-Time Operations (Detail)

**Consolidation:**
- Query L2 for semantically similar entries
- Merge duplicates into single authoritative entries
- Preserve provenance metadata (which sessions contributed)
- Example: 5 entries about "user prefers TypeScript" → 1 entry with confidence score

**Inference:**
- Load recent L1 history + relevant L2 entries
- Draw conclusions that span multiple facts
- Example: "user asked about Kubernetes" + "user works on microservices" → "user likely deploying containerized services"

**Anticipation:**
- Based on patterns in L1 history, pre-compute answers to likely future queries
- Example: User asks about AWS services every Monday → pre-retrieve latest AWS updates

**Correction:**
- Detect contradictions (same entity, different values)
- Apply recency heuristic (newer facts win) or flag for user confirmation
- Example: "works at Company A" (Jan) vs "works at Company B" (Mar) → update to B, archive A

---

## 5. Evaluation Plan

### 5.1 Benchmarks to Build

**Memory Quality Benchmark:**
- Seed an agent's L2 with N sessions of simulated conversations
- Run sleep-time processing
- Measure: deduplication rate, contradiction resolution accuracy, inference validity
- Compare retrieval precision/recall before vs. after

**Test-Time Token Savings Benchmark:**
- Task: multi-session Q&A where answers depend on accumulated knowledge
- Baseline: standard MemoryManager with extraction only
- Treatment: MemoryManager + sleep-time processing between sessions
- Measure: tokens consumed per correct answer, latency, accuracy

**Amortization Benchmark:**
- Vary the number of queries that benefit from sleep-time processing
- Find the breakeven point (Letta's paper suggests ~4 queries)
- Plot: cost-per-query vs. number of queries, with and without sleep-time

**Predictability Benchmark:**
- Categorize queries by how predictable they are from context
- Measure sleep-time effectiveness per category
- Validate the paper's claim that gains correlate with predictability

### 5.2 Metrics

| Metric | What it measures | Target |
|--------|-----------------|--------|
| Retrieval precision@5 | Quality of top-5 memory results | >20% improvement over baseline |
| Test-time tokens | Tokens consumed during active conversation | >30% reduction for equivalent accuracy |
| Deduplication rate | % of redundant entries consolidated | >80% of true duplicates caught |
| Contradiction resolution | Accuracy of detecting and resolving conflicts | >90% precision |
| Sleep-time cost | Tokens spent during offline processing | Document cost model |
| Amortization breakeven | Queries needed to justify sleep-time cost | Target: ≤5 queries |

---

## 6. Timeline

### Phase 1: Foundation (Weeks 1-3)

**Week 1: Orientation + Design**
- Read the paper (arXiv 2504.13171), Letta's implementation, the MemoryManager design (PR #844), and the context strategy design (PR #831)
- Set up local dev environment with Strands SDK
- Write detailed technical design doc (refine Section 4 above)
- Identify which `KnowledgeStore` backend to use for development (likely `InMemoryKnowledgeStore` or `FileKnowledgeStore`)

**Week 2: Scaffold**
- Implement `SleepTimeProcessor` skeleton
- Build the sleep-time agent (Strands agent with specialized tools)
- Implement `readRecentHistory` and `searchMemory` tools
- Write unit tests for tool behaviors

**Week 3: Core Loop**
- Implement the iterative rethinking loop (`rethinkMemory` → `finishRethinking`)
- Implement `storeInsight` and `deprecateEntry`
- End-to-end test: seed L2, run sleep-time, verify writes

### Phase 2: Operations (Weeks 4-6)

**Week 4: Consolidation**
- Implement semantic similarity detection for duplicate entries
- Build merge logic (combine content, preserve metadata, update provenance)
- Test with synthetic duplicate sets

**Week 5: Inference + Correction**
- Implement cross-fact reasoning (load related entries, generate inferences)
- Implement contradiction detection and resolution
- Test with synthetic contradictory fact sets

**Week 6: Triggers + Integration**
- Implement trigger system (`onSessionEnd`, `onIdle`, `scheduled`, `manual`)
- Integrate with `MemoryManager` lifecycle hooks
- End-to-end integration test: multi-session agent with sleep-time processing between sessions

### Phase 3: Evaluation (Weeks 7-9)

**Week 7: Benchmark Scaffolding**
- Build evaluation harness (synthetic conversation generation, query sets)
- Implement memory quality metrics (precision, recall, deduplication rate)
- Implement token counting and cost tracking

**Week 8: Run Benchmarks**
- Memory quality benchmark (before/after sleep-time)
- Test-time token savings benchmark
- Amortization analysis (vary query count)

**Week 9: Analysis + Optimization**
- Analyze which operations help most
- Tune iteration count, prompt design, model selection
- Document findings (what works, what doesn't, when to use it)

### Phase 4: Polish (Week 10)

**Week 10: Documentation + Final Deliverables**
- Write integration guide and API documentation
- Clean up code, add comprehensive tests
- Final benchmark report with recommendations
- Present findings to team

---

## 7. Key Research Questions

These are open questions the intern should explore — they don't have known answers:

1. **Which operations are worth the cost?** Consolidation is cheap (dedup). Inference is expensive (cross-fact reasoning). Anticipation is speculative. Which ones actually improve downstream performance?

2. **What's the optimal iteration count?** Letta uses up to 10 `rethink_memory()` cycles. The paper shows diminishing returns. Where's the sweet spot for Strands?

3. **Strong model or weak model for sleep-time?** Letta uses a stronger model for sleep-time reasoning and a cheaper one for the primary agent. Is this always the right split? What about using a cheap model for consolidation but a strong one for inference?

4. **How does it interact with context injection vs. active recall?** The MemoryManager design supports both retrieval modes. Does sleep-time-enriched memory work better with one retrieval method vs. the other?

5. **Does the L0/L1/L2 hierarchy change the calculus?** Letta doesn't have an explicit L1. In Strands, the sleep-time agent can read L1 (full session history) — does this give it more signal than Letta's approach of only reading the primary agent's memory blocks?

6. **What's the right granularity?** Should the sleep-time agent process individual entries, or load a batch and reason about the whole batch at once?

7. **How do you evaluate "inference quality"?** A consolidation can be checked mechanically (are the merged entries equivalent?). But how do you validate that an inferred conclusion is correct and useful?

---

## 8. Resources

### Papers
- [Sleep-time Compute (Lin et al., 2025)](https://arxiv.org/abs/2504.13171) — the core paper
- [MemGPT (Packer et al., 2023)](https://arxiv.org/abs/2310.08560) — foundational memory architecture
- [Lost in the Middle (Liu et al., 2023)](https://arxiv.org/abs/2307.03172) — retrieval position effects
- [Self-RAG (Asai et al., 2023)](https://arxiv.org/abs/2310.11511) — self-reflective retrieval

### Implementations
- [Letta GitHub](https://github.com/lettaai/letta) — reference implementation (`letta/agents/voice_sleeptime_agent.py`)
- [Strands SDK TypeScript](https://github.com/strands-agents/sdk-typescript) — target codebase

### Strands Designs
- [PR #831](https://github.com/strands-agents/docs/pull/831) (`designs/0010-context-strategy.md`) — Context management presets (L0/L1/L2 hierarchy)
- [PR #844](https://github.com/strands-agents/docs/pull/844) (`designs/0011-knowledge-bases.md`) — MemoryManager primitive (L2 interface)

### Key Interfaces to Build Against
- `KnowledgeStore` — `search(query)` + `add(content, metadata)` 
- `Extractor` — `extract(messages): Promise<{ content, metadata }[]>`
- `IngestionConfig` — triggers, filters, extractor config
- `ContextManager` storage — L1 batch files (session history)

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Sleep-time processing doesn't improve retrieval enough to justify cost | Medium | High | Start with consolidation (lowest cost, most mechanical benefit). Only add inference/anticipation if consolidation alone shows gains. |
| Benchmarking is hard (no standard memory quality benchmarks exist) | High | Medium | Adapt Letta's ContextBench methodology. Build synthetic but realistic test sets. Focus on measurable proxies (deduplication rate, precision@k). |
| Integration with MemoryManager design isn't finalized | Medium | Medium | Build against the `KnowledgeStore` interface (stable). Keep integration layer thin so it adapts to design changes. |
| Model quality varies across providers | Low | Low | Test with 2-3 models. Document which models work well for sleep-time reasoning. |
| Scope creep into multi-agent coordination | Medium | Medium | Sleep-time agent is single-purpose. It reads from one agent's stores and writes back. No multi-agent coordination in v1. |

---

## 10. What "Done" Looks Like

At the end of 10 weeks, the intern delivers:

1. **A working module** — `SleepTimeProcessor` that integrates with `MemoryManager` and runs offline reasoning on L2 knowledge stores
2. **Benchmark results** — quantified improvements in retrieval quality and test-time token savings
3. **A cost model** — when to enable sleep-time compute (amortization analysis)
4. **A recommendation** — which operations are worth shipping, which are research-only
5. **A design doc** — suitable for inclusion in `strands-agents/docs/designs/`
6. **A presentation** — 15-minute demo of findings to the team

---

## Appendix: Example Walkthrough

### Session 1 (Monday)
User: "I'm working on the payments service. We use Stripe for processing."
→ MemoryManager extracts: `{ content: "User works on payments service", metadata: { session: 1 } }`
→ MemoryManager extracts: `{ content: "Payments uses Stripe for processing", metadata: { session: 1 } }`

### Session 2 (Tuesday)
User: "The Stripe webhook is failing in staging. We switched to Stripe Connect last week."
→ MemoryManager extracts: `{ content: "Stripe webhook failing in staging", metadata: { session: 2 } }`
→ MemoryManager extracts: `{ content: "Switched to Stripe Connect last week", metadata: { session: 2 } }`

### Sleep-Time Processing (Tuesday night, triggered by `onSessionEnd`)

Sleep-time agent loads recent L1 + existing L2 entries. Performs:

**Consolidation:**
- "User works on payments service" + "Payments uses Stripe for processing" → "User works on payments service (Stripe-based)"

**Inference:**
- "Switched to Stripe Connect" + "webhook failing in staging" → "Webhook failure may be related to Stripe Connect migration (Connect uses different webhook event types)"

**Correction:**
- "Uses Stripe for processing" (Session 1) superseded by "Switched to Stripe Connect" (Session 2) → Update to reflect current state

### Session 3 (Wednesday)
User: "Why is the webhook failing?"
→ Agent retrieves pre-computed inference: "Webhook failure may be related to Stripe Connect migration — Connect uses different event types than standard Stripe"
→ Agent provides targeted help immediately, without needing to re-derive the connection

**Without sleep-time:** Agent would retrieve 4 raw facts and need to reason about the connection in real-time (more tokens, higher latency, risk of missing the connection).
