# Intern Project Brief: Context Compression Research

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK (strands-agents/sdk-typescript), research + prototype + benchmark  
**Prerequisites:** Familiarity with TypeScript, LLM APIs, basic understanding of information retrieval and embeddings  
**Difficulty:** Research-heavy, medium implementation complexity, high novelty

---

## 1. Problem Statement

The Context Management Presets design ([PR #831](https://github.com/strands-agents/docs/pull/831)) defines `"auto"` mode: when context pressure builds, the framework compresses older messages in L0 (the context window). Today, the compression strategy is **positional** — oldest messages are evicted first, optionally replaced by a summary.

This is a blunt instrument. Positional eviction assumes recency equals importance, which is often wrong:
- A critical architectural decision from turn 3 matters more than a routine `ls` output from turn 25
- A file read from turn 10 that was never referenced again is less important than a constraint stated in turn 8 that shapes all subsequent decisions
- Multi-threaded conversations (debugging + architecture + requirements woven together) produce incoherent summaries when compressed linearly

The research question this project explores: **How should context be compressed? What should be evicted, when, and how — to maximize downstream task performance while minimizing token cost?**

This is distinct from the roadmap's context management work (which implements the `"auto"` infrastructure — hooks, thresholds, storage). This project explores **what that infrastructure should do** — the compression intelligence itself.

---

## 2. Research Areas

This project investigates three complementary approaches to context compression, each addressing a different weakness of positional eviction. They share infrastructure (benchmarks, metrics, the compression plugin interface) but explore independent hypotheses.

### 2.1 Importance-Based Eviction

**Hypothesis:** A cheap importance scorer can decide *what* to evict better than position alone, improving downstream task completion accuracy without significantly increasing cost.

**The problem with position:** An architectural decision from turn 3 that shapes all subsequent behavior is more important than a verbose tool result from turn 20 that was already consumed. But positional eviction drops turn 3 first.

**Approaches to explore:**

| Approach | Cost | Accuracy (expected) | How it works |
|----------|------|--------------------|----|
| Heuristic scoring | Zero (no LLM call) | Low-medium | Score by: message length, role (system > user > assistant), content type (decision > observation), reference count (was this message cited later?) |
| Embedding similarity | Low (~$0.001/message) | Medium | Embed each message + the current task prompt. Score = cosine similarity to task. High-similarity messages are retained. |
| LLM-as-judge | Medium (~$0.01/batch) | High | Batch messages, ask a cheap model "rank these by importance to the current task" |
| Hybrid | Low | Medium-high | Heuristic pre-filter → embedding re-rank → evict bottom N |

**Key research questions:**
- How much does importance-based eviction improve task completion vs. positional?
- What's the cost/accuracy tradeoff for each scoring approach?
- Can heuristics alone get 80% of the LLM-as-judge benefit at 0% of the cost?
- Does importance scoring generalize across task types (coding vs. research vs. conversation)?

**Evaluation:**
- Task suite: 10-15 long-running tasks where early context matters for late-stage decisions
- Metric: task completion accuracy at different compression ratios (50%, 70%, 90% of context evicted)
- Comparison: positional (baseline) vs. importance-based at each ratio

### 2.2 Semantic Compression (Cluster-First Summarization)

**Hypothesis:** Clustering messages by topic before compression produces more coherent, higher-quality summaries than linear (oldest-first) compression, improving the agent's ability to use compressed context.

**The problem with linear compression:** Conversations often interleave multiple threads — a debugging thread, an architecture discussion, and a requirements clarification. Linear summarization blends them into an incoherent soup. The summary says "we discussed auth and also the user mentioned they use Postgres and there was a test failure" — losing the causal structure within each thread.

**Approach:**

```
Step 1: Cluster messages by semantic topic
  [messages 1-30] → cluster A (auth architecture), cluster B (test debugging), cluster C (requirements)

Step 2: Compress each cluster independently
  cluster A → "Decided on JWT-based auth with refresh tokens, stored in httpOnly cookies"
  cluster B → "Test failure in user_auth.test.ts due to missing mock for token refresh endpoint"
  cluster C → "Requirements: must support SSO, 2FA optional for v1, audit log required"

Step 3: Retain cluster boundaries in L0
  [compressed A] [compressed B] [compressed C] [recent messages unchanged]
```

**Approaches to clustering:**
- **Embedding-based:** Embed each message, cluster with k-means or DBSCAN. Cheap, automatic.
- **Sliding window coherence:** Score coherence between adjacent messages. Low coherence = topic boundary.
- **LLM-based:** Ask a model to identify topic shifts. Most accurate, highest cost.
- **Hybrid:** Embedding clusters with LLM-refined boundaries.

**Key research questions:**
- Does cluster-aware compression produce more coherent summaries (measured by human eval or automated coherence scores)?
- Does the agent perform better on tasks that require recalling information from specific threads?
- What clustering method gives the best coherence/cost tradeoff?
- How many clusters emerge naturally in different task types? Is it stable enough to be useful?

**Evaluation:**
- Task suite: multi-threaded conversations where late-stage questions reference specific earlier threads
- Metric A: summary coherence (automated scoring — does each compressed block address one topic?)
- Metric B: thread-recall accuracy (given compressed context, can the agent answer questions about specific threads?)
- Comparison: linear compression vs. cluster-first at equivalent compression ratios

### 2.3 Content-Type-Aware Compression

**Hypothesis:** Different message content types have different compressibility — applying type-specific strategies produces better compression ratios with less information loss than uniform summarization.

**The insight:** Not all context is equally compressible:

| Content type | Compressibility | Optimal strategy |
|-------------|----------------|-----------------|
| Tool results (file reads, shell output) | Very high | Replace with pointer + 1-line summary ("read auth.ts — exports `createToken()`, `verifyToken()`, uses JWT") |
| Reasoning/decisions | Very low | Keep verbatim or lightly summarize (nuance matters) |
| Code blocks | Medium | Keep signature + key logic, drop boilerplate |
| User instructions/constraints | Very low | Never evict (pin equivalent) |
| Routine dialogue ("ok", "thanks", "yes do that") | Very high | Drop entirely |
| Error messages/stack traces | Medium | Keep error type + location, drop full trace |

**Approach:**

```typescript
interface ContentTypeCompressor {
  classify(message: Message): ContentType
  compress(message: Message, type: ContentType): CompressedMessage | null  // null = drop
}

// Each type gets its own compression strategy
const strategies: Record<ContentType, CompressionStrategy> = {
  'tool-result-file-read': replaceWithPointerAndSummary,
  'tool-result-shell':     keepExitCodeAndLastNLines,
  'decision':              keepVerbatim,
  'user-instruction':      keepVerbatim,
  'routine-dialogue':      drop,
  'reasoning':             lightSummarize,
  'error':                 keepTypeAndLocation,
  'code':                  keepSignatureOnly,
}
```

**Key research questions:**
- Can content type be classified cheaply (heuristics on role + content patterns) or does it need an LLM call?
- What's the compression ratio achievable per type without meaningful information loss?
- Does type-aware compression preserve more task-relevant information than uniform summarization at the same token budget?
- What's the Pareto frontier: compression ratio vs. downstream task accuracy for each type?

**Evaluation:**
- Task suite: tasks that produce diverse content types (coding tasks with file reads, shell commands, reasoning, code generation)
- Metric: information retention score (can the agent still access the key information from each compressed message?)
- Comparison: uniform summarization vs. type-aware at equivalent total token budget

---

## 3. Project Goals

### Primary Goal
Explore three approaches to intelligent context compression (importance-based, semantic clustering, content-type-aware), benchmark each against positional eviction, and produce recommendations for the `"auto"` strategy's default compression behavior.

### Success Criteria
1. Benchmark framework that measures compression quality across task types
2. Working prototype for each of the three approaches
3. Quantified comparison: each approach vs. positional eviction on task completion accuracy
4. Cost model for each approach (tokens spent on compression intelligence vs. tokens saved)
5. Recommendation: which approach(es) should ship as the default in `contextManager: "auto"`
6. Design doc proposing how the winner integrates with the `ContextCompression` plugin

---

## 4. Technical Design

### 4.1 Shared Infrastructure

All three approaches build on the same evaluation infrastructure:

```typescript
// Compression strategy interface (pluggable into ContextCompression plugin)
interface CompressionStrategy {
  compress(
    messages: Message[],
    options: {
      targetTokens: number       // how many tokens to free
      currentBudget: number      // total context window size
      protectedIndices: number[] // messages that cannot be evicted
    }
  ): Promise<CompressedResult>
}

interface CompressedResult {
  messages: Message[]          // the new L0 (compressed + retained)
  evicted: Message[]           // what was removed (written to L1)
  tokensFreed: number
  compressionCost: number      // tokens spent on the compression itself
}
```

```typescript
// Baseline: positional eviction (current behavior)
class PositionalCompression implements CompressionStrategy {
  async compress(messages, options): Promise<CompressedResult> {
    // Remove oldest non-protected messages until targetTokens is freed
    // Optionally summarize evicted messages
  }
}

// Research implementations
class ImportanceBasedCompression implements CompressionStrategy { ... }
class SemanticClusterCompression implements CompressionStrategy { ... }
class ContentTypeCompression implements CompressionStrategy { ... }
```

### 4.2 Benchmark Framework

```typescript
interface CompressionBenchmark {
  name: string
  tasks: BenchmarkTask[]
  strategies: CompressionStrategy[]
  metrics: MetricFn[]
}

interface BenchmarkTask {
  // A conversation that fills context, requiring compression mid-task
  conversation: Message[]      // full conversation (may exceed context window)
  query: string                // question to ask after compression
  groundTruth: string          // expected answer (for accuracy scoring)
  contextTrigger: number       // message index where compression fires
}

interface BenchmarkResult {
  strategy: string
  task: string
  accuracy: number             // 0-1: did the agent answer correctly post-compression?
  tokensRetained: number       // how much context remained
  compressionCost: number      // tokens spent on compression intelligence
  latency: number              // time to compress
}
```

### 4.3 Task Suites

**Suite 1: Early Decision Recall**
Tasks where a critical decision/constraint is stated early and must be followed throughout. Tests whether compression preserves important early context.
- Example: "We decided to use PostgreSQL, not MongoDB" (turn 3) → later: "Write the database migration" (turn 40)
- Failure mode: agent uses MongoDB syntax because the decision was evicted

**Suite 2: Multi-Thread Recall**
Tasks with interleaved topics where late questions reference specific earlier threads.
- Example: debugging thread + architecture thread + requirements thread → "What was the test failure about?" (references debugging thread only)
- Failure mode: compressed summary blends threads, agent gives confused answer

**Suite 3: Tool Result Recovery**
Tasks where tool results were consumed but the conclusion matters later.
- Example: agent reads 5 files (turns 10-15), later needs to reference a pattern found across them (turn 35)
- Failure mode: file contents evicted, agent can't recall the cross-file pattern

**Suite 4: Long Coding Task**
Multi-file refactoring with big tool results and architectural constraints that must be maintained across the whole session.
- Full SWE-bench-style task that exceeds context window
- Failure mode: agent makes inconsistent decisions because earlier context was lost

**Suite 5: Conversational Coherence**
50+ turn conversation with callbacks to earlier topics.
- Example: user mentions a preference in turn 5, asks about it in turn 45
- Failure mode: preference was compressed away, agent contradicts it

### 4.4 Metrics

| Metric | What it measures | How |
|--------|-----------------|-----|
| Task accuracy | Correct answer after compression | Compare to ground truth (exact match or LLM-as-judge) |
| Information retention | Critical facts preserved | Pre-define "key facts" per task, check if each survives compression |
| Compression ratio | How much context was freed | tokensFreed / originalTokens |
| Compression cost | Overhead of intelligent compression | Tokens consumed by the compression process itself |
| Net token savings | Savings minus overhead | tokensFreed - compressionCost |
| Latency | Time to compress | Wall clock time for compression step |
| Coherence (cluster only) | Summary quality | Automated coherence scoring of compressed output |

### 4.5 Approach-Specific Designs

#### Importance Scoring (2.1)

```typescript
interface ImportanceScorer {
  score(messages: Message[], taskContext: string): Promise<ScoredMessage[]>
}

interface ScoredMessage {
  index: number
  score: number       // 0-1, higher = more important
  signals: string[]   // why (for debugging/analysis)
}

// Heuristic scorer (zero-cost)
class HeuristicScorer implements ImportanceScorer {
  async score(messages, taskContext) {
    return messages.map((msg, i) => ({
      index: i,
      score: this.computeScore(msg, messages, taskContext),
      signals: this.explainScore(msg),
    }))
  }

  private computeScore(msg: Message, all: Message[], task: string): number {
    let score = 0.5 // baseline

    // Role signal
    if (msg.role === 'system') score += 0.3
    if (msg.role === 'user') score += 0.1

    // Content type signal
    if (containsDecision(msg)) score += 0.2
    if (isRoutineDialogue(msg)) score -= 0.3
    if (isLargeToolResult(msg)) score -= 0.1

    // Reference signal (was this message referenced later?)
    if (wasReferencedLater(msg, all)) score += 0.2

    // Recency (mild positional bias as tiebreaker)
    score += (i / all.length) * 0.1

    return Math.max(0, Math.min(1, score))
  }
}

// Embedding scorer (low-cost)
class EmbeddingScorer implements ImportanceScorer {
  async score(messages, taskContext) {
    const taskEmbedding = await embed(taskContext)
    const messageEmbeddings = await embedBatch(messages.map(m => m.content))
    return messages.map((msg, i) => ({
      index: i,
      score: cosineSimilarity(taskEmbedding, messageEmbeddings[i]),
      signals: ['embedding-similarity'],
    }))
  }
}

// LLM scorer (medium-cost)
class LLMScorer implements ImportanceScorer {
  async score(messages, taskContext) {
    const response = await this.model.invoke(
      `Given the current task: "${taskContext}"\n\n` +
      `Rate each message's importance (0-1) for completing this task:\n` +
      messages.map((m, i) => `[${i}] ${m.content.slice(0, 100)}`).join('\n')
    )
    return parseScores(response)
  }
}
```

#### Semantic Clustering (2.2)

```typescript
interface TopicClusterer {
  cluster(messages: Message[]): Promise<MessageCluster[]>
}

interface MessageCluster {
  topic: string                // inferred topic label
  messageIndices: number[]     // which messages belong to this cluster
  coherenceScore: number       // 0-1: how coherent is this cluster
}

// Embedding-based clustering
class EmbeddingClusterer implements TopicClusterer {
  async cluster(messages) {
    const embeddings = await embedBatch(messages.map(m => m.content))
    const clusters = dbscan(embeddings, { epsilon: 0.3, minPoints: 2 })
    return clusters.map(c => ({
      topic: await this.labelCluster(messages, c.indices),
      messageIndices: c.indices,
      coherenceScore: this.measureCoherence(embeddings, c.indices),
    }))
  }
}

// Then compress each cluster independently
class SemanticCompression implements CompressionStrategy {
  async compress(messages, options) {
    const clusters = await this.clusterer.cluster(messages)

    // Compress each cluster into a coherent summary
    const compressed = await Promise.all(
      clusters.map(c => this.summarizeCluster(messages, c))
    )

    // Retain recent messages uncompressed
    return {
      messages: [...compressed, ...recentMessages],
      evicted: olderMessages,
      tokensFreed: ...,
    }
  }
}
```

#### Content-Type Classification (2.3)

```typescript
type ContentType =
  | 'tool-result-file-read'
  | 'tool-result-shell'
  | 'tool-result-api'
  | 'decision'
  | 'user-instruction'
  | 'routine-dialogue'
  | 'reasoning'
  | 'error'
  | 'code'
  | 'unknown'

class ContentTypeClassifier {
  classify(message: Message): ContentType {
    // Heuristic classification (no LLM needed)
    if (message.role === 'tool') {
      if (message.toolName?.includes('read') || message.toolName?.includes('file'))
        return 'tool-result-file-read'
      if (message.toolName?.includes('shell') || message.toolName?.includes('exec'))
        return 'tool-result-shell'
      return 'tool-result-api'
    }
    if (message.role === 'user' && message.content.length < 20)
      return 'routine-dialogue'
    if (message.role === 'user')
      return 'user-instruction'
    if (containsCodeBlock(message.content))
      return 'code'
    if (containsErrorPattern(message.content))
      return 'error'
    if (containsDecisionLanguage(message.content))
      return 'decision'
    return 'reasoning'
  }
}

// Per-type compression strategies
const typeStrategies: Record<ContentType, (msg: Message) => Message | null> = {
  'tool-result-file-read': (msg) => ({
    ...msg,
    content: `[File read: ${msg.toolName}] ${extractSummaryLine(msg.content)}`,
  }),
  'tool-result-shell': (msg) => ({
    ...msg,
    content: `[Shell] exit ${extractExitCode(msg)} | ${lastNLines(msg.content, 3)}`,
  }),
  'routine-dialogue': () => null, // drop entirely
  'decision': (msg) => msg,       // keep verbatim
  'user-instruction': (msg) => msg, // keep verbatim
  'reasoning': (msg) => summarize(msg, { maxTokens: 50 }),
  'error': (msg) => ({
    ...msg,
    content: `[Error: ${extractErrorType(msg)}] at ${extractLocation(msg)}`,
  }),
  'code': (msg) => ({
    ...msg,
    content: extractSignatureOnly(msg.content),
  }),
  'unknown': (msg) => summarize(msg, { maxTokens: 100 }),
}
```

---

## 5. Evaluation Plan

### 5.1 Experimental Design

Each approach is evaluated independently against the positional baseline:

```
For each task suite:
  For each compression ratio (50%, 70%, 90%):
    For each strategy (positional, importance, semantic, content-type):
      1. Run conversation up to compression trigger point
      2. Apply compression strategy to free target tokens
      3. Continue conversation with compressed context
      4. Score: did the agent complete the task correctly?
      5. Record: accuracy, tokens freed, compression cost, latency
```

### 5.2 Statistical Rigor

- Run each configuration 3-5 times (LLM non-determinism)
- Report mean + std deviation for accuracy
- Use paired comparison (same task, same randomness seed where possible)
- Statistical significance testing for key claims (paired t-test or bootstrap)

### 5.3 Cost-Effectiveness Analysis

For each approach, compute:
- **Gross savings** = tokens freed by compression
- **Compression cost** = tokens consumed by the compression intelligence (embeddings, LLM calls, etc.)
- **Net savings** = gross savings - compression cost
- **Accuracy delta** = task accuracy (approach) - task accuracy (positional)
- **Cost per accuracy point** = compression cost / accuracy delta

This produces a Pareto frontier: accuracy vs. cost. The recommendation is the approach with the best accuracy at acceptable cost.

### 5.4 Ablation Studies

For importance-based:
- Heuristic only vs. embedding only vs. LLM only vs. hybrid
- Which heuristic signals matter most? (ablate each signal)

For semantic clustering:
- Embedding clustering vs. coherence-boundary vs. LLM-based
- Does cluster count matter? (force 2 vs. 5 vs. auto-detected)
- Does per-cluster summarization outperform cluster-aware ordering (keep clusters but don't summarize)?

For content-type:
- Heuristic classification accuracy (validate against human labels)
- Which per-type strategies actually help? (ablate each type's strategy)
- Does type-aware beat "just summarize everything" at the same budget?

---

## 6. Timeline

### Phase 1: Infrastructure (Weeks 1-3)

**Week 1: Orientation + Benchmark Framework**
- Read the context strategy design (PR #831), existing `ContextCompression` plugin, `ConversationManager` implementations
- Study the MemGPT paper's importance scoring approach
- Design the `CompressionStrategy` interface
- Build the benchmark runner (task → compress → continue → score)
- Implement positional compression baseline

**Week 2: Task Suites**
- Build 3-5 tasks for each of the 5 suites (15-25 tasks total)
- Validate tasks: confirm they exceed context window, confirm correct answers require compressed context
- Implement ground-truth scoring (exact match where possible, LLM-as-judge for open-ended)
- Run baseline (positional) across all suites at 50%, 70%, 90% compression

**Week 3: Importance-Based Eviction (v1)**
- Implement heuristic scorer (zero-cost signals)
- Implement embedding scorer (batch embeddings + cosine similarity)
- Run both against baseline on all suites
- Initial analysis: where does importance scoring help most?

### Phase 2: Research (Weeks 4-7)

**Week 4: Importance-Based (continued)**
- Implement LLM scorer (batch importance ranking)
- Implement hybrid (heuristic pre-filter → embedding re-rank)
- Ablation: which heuristic signals contribute most?
- Full comparison: heuristic vs. embedding vs. LLM vs. hybrid vs. positional

**Week 5: Semantic Clustering**
- Implement embedding-based clusterer (DBSCAN or k-means on message embeddings)
- Implement per-cluster summarization
- Run against multi-thread recall suite (where this should shine)
- Compare: cluster-first vs. linear summarization at same compression ratio

**Week 6: Content-Type Aware**
- Implement heuristic content-type classifier
- Validate classification accuracy (manually label 50 messages, compare)
- Implement per-type compression strategies
- Run against coding task suite (where diverse content types dominate)
- Compare: type-aware vs. uniform summarization at same token budget

**Week 7: Combinations + Edge Cases**
- Test combinations: importance scoring + content-type awareness (score importance, but compress type-aware)
- Test combinations: clustering + importance (cluster first, evict least-important clusters)
- Edge cases: what happens when all content is "important"? When clusters are unbalanced?
- Stress test: very high compression ratios (90%+) — which approach degrades most gracefully?

### Phase 3: Analysis + Integration (Weeks 8-9)

**Week 8: Full Benchmark + Analysis**
- Run complete benchmark matrix (all approaches × all suites × all ratios)
- Produce cost-effectiveness analysis (Pareto frontier)
- Identify: which approach wins for which task type?
- Identify: is there a universal winner, or should strategy be task-adaptive?

**Week 9: Integration Design**
- Write design doc: how the winning approach integrates with `ContextCompression` plugin
- Prototype integration with the `contextManager: "auto"` resolution
- Implement adaptive strategy selection (if results support it):
  detect task type → select best compression strategy automatically
- Test end-to-end: agent with research-informed compression vs. agent with positional

### Phase 4: Polish (Week 10)

**Week 10: Deliverables**
- Final benchmark report with visualizations (accuracy vs. compression ratio per approach)
- Clean up prototype implementations (publishable quality)
- Write recommendation doc: what should ship as default in `"auto"` mode
- Present findings to team

---

## 7. Key Research Questions

1. **Is importance scoring worth the cost?** The cheapest approach (heuristics) is free but possibly inaccurate. The most accurate (LLM-as-judge) costs tokens. Where's the sweet spot? Can heuristics alone beat positional?

2. **Do conversations actually have semantic clusters?** The clustering hypothesis assumes multi-threaded conversations are common. If most agent conversations are linear (one topic at a time), clustering adds overhead without benefit. How common is multi-threading in real agent usage?

3. **Is content-type classifiable without an LLM call?** If heuristic classification (role + patterns) is >90% accurate, this approach is essentially free. If it requires an LLM call per message, the cost may exceed the benefit.

4. **Is there a universal winner, or is it task-dependent?** Maybe importance scoring wins for coding tasks, clustering wins for research tasks, and content-type wins for tool-heavy tasks. If so, the real contribution is an adaptive strategy selector.

5. **How do these approaches compose?** Importance + content-type (score importance, compress by type) or clustering + importance (cluster, evict least important clusters) might outperform any single approach. But combinations add complexity — is the marginal gain worth it?

6. **What compression ratio is "safe"?** At 50% compression, most approaches might work fine. At 90%, information loss is severe regardless of strategy. Where's the cliff for each approach — the point where accuracy drops sharply?

7. **How does this interact with L1 recovery?** In `"agentic"` mode, the agent can search L1 to recover evicted content. Does smart compression + L1 recovery outperform naive compression + L1 recovery? Or does L1 access make compression quality irrelevant?

---

## 8. Resources

### Papers
- [MemGPT (Packer et al., 2023)](https://arxiv.org/abs/2310.08560) — importance-based memory management in agents
- [Lost in the Middle (Liu et al., 2023)](https://arxiv.org/abs/2307.03172) — position effects on retrieval; motivates non-positional eviction
- [StreamingLLM (Xiao et al., 2023)](https://arxiv.org/abs/2309.17453) — attention sink phenomenon; some messages disproportionately anchor attention
- [Recursive Summarization (Wu et al., 2021)](https://arxiv.org/abs/2109.10862) — hierarchical summarization for long documents
- [LongMem (Wang et al., 2023)](https://arxiv.org/abs/2306.07174) — decoupled memory for long-context language modeling

### Strands Designs
- [PR #831](https://github.com/strands-agents/docs/pull/831) (`designs/0010-context-strategy.md`) — context management presets, `ContextCompression` plugin
- [PR #844](https://github.com/strands-agents/docs/pull/844) (`designs/0011-knowledge-bases.md`) — MemoryManager (L2)

### Key Interfaces
- `ContextCompression` plugin — where compression logic lives
- `CompressionFn` type — custom compression function signature in the config
- `BeforeModelCallEvent` hook — where compression is triggered
- `OnContextOverflowEvent` — fired on context length errors (v2)
- Token estimation API — needed to measure compression ratios

### Related Work in Strands
- Context management benchmarks (existing in this repo at `context-management/benchmarks/`)
- Token tracking design (roadmap task #1)
- Proactive context compression (roadmap task #6 — this project informs *how* task #6 should compress)

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| No approach significantly beats positional | Medium | High | A negative result is still valuable — it validates the current approach and saves engineering effort on complex compression. Document *why* position works well enough (recency is a strong proxy for importance in most conversations). |
| Embedding costs are too high for real-time compression | Medium | Medium | Pre-compute embeddings incrementally (embed each message on arrival, not at compression time). Amortized cost is minimal. |
| Task suites don't represent real usage | Medium | Medium | Supplement synthetic tasks with replay of real agent conversations (anonymized). Ask the team for examples of conversations where context loss hurt. |
| Clustering produces meaningless groups | Medium | Low | Validate clustering quality before running full benchmarks. If DBSCAN with reasonable epsilon produces 1 giant cluster for most conversations, the hypothesis is invalid for that task type — document and move on. |
| Scope creep into implementing the full ContextCompression plugin | Low | Medium | This project produces *research + prototype*. The production implementation of ContextCompression is roadmap work (task #6). This project's output is: "here's what the compression logic should do, here's the evidence, here's a prototype." |
| Results are model-dependent | High | Medium | Run key comparisons on 2 models minimum (Claude Sonnet + GPT-4o-mini). If results diverge significantly, document per-model recommendations. |

---

## 10. What "Done" Looks Like

At the end of 10 weeks, the intern delivers:

1. **Benchmark framework** — reusable infrastructure for evaluating compression strategies, with 15-25 benchmark tasks across 5 suites
2. **Three prototype implementations** — importance-based, semantic clustering, and content-type-aware compression strategies
3. **Full benchmark results** — quantified comparison across all approaches, all suites, multiple compression ratios
4. **Cost-effectiveness analysis** — Pareto frontier showing accuracy vs. cost for each approach
5. **A recommendation** — which approach (or combination) should be the default for `contextManager: "auto"`
6. **A design doc** — proposing integration with the `ContextCompression` plugin, suitable for `strands-agents/docs/designs/`
7. **A presentation** — 15-minute overview of findings with visualizations

---

## Appendix A: Benchmark Task Examples

### Suite 1 (Early Decision Recall)

```typescript
{
  name: "database-choice",
  conversation: [
    { role: "user", content: "We're building a user service. Use PostgreSQL for the database — we need strong consistency and JSON support." },
    { role: "assistant", content: "Got it — PostgreSQL for strong consistency and native JSON. I'll design the schema with that in mind." },
    // ... 30 turns of coding, file reads, tool results ...
    { role: "assistant", content: "[large tool result from reading existing code]" },
    // ... more turns ...
  ],
  query: "Write the database migration for the new user preferences table.",
  groundTruth: "Uses PostgreSQL syntax (CREATE TABLE, JSONB type, etc.), not MongoDB/DynamoDB",
  contextTrigger: 25, // compression fires at message 25
}
```

### Suite 2 (Multi-Thread Recall)

```typescript
{
  name: "interleaved-threads",
  conversation: [
    { role: "user", content: "I'm seeing a test failure in auth.test.ts" },
    { role: "assistant", content: "Let me look at the test..." },
    // debugging thread continues...
    { role: "user", content: "Also, separately — what do you think about using Redis for session storage?" },
    { role: "assistant", content: "Redis is a good fit for sessions because..." },
    // architecture thread...
    { role: "user", content: "Back to the test — I tried your fix and it's still failing" },
    // back to debugging...
    // ... 40 more turns of interleaved discussion ...
  ],
  query: "What was the root cause of the test failure?",
  groundTruth: "The mock for token refresh was missing a timeout parameter",
  contextTrigger: 30,
}
```

### Suite 3 (Tool Result Recovery)

```typescript
{
  name: "cross-file-pattern",
  conversation: [
    // Agent reads 5 files, each has a similar pattern
    { role: "tool", toolName: "read_file", content: "[500 lines of auth.ts]" },
    { role: "assistant", content: "I see the auth module uses a factory pattern..." },
    { role: "tool", toolName: "read_file", content: "[500 lines of users.ts]" },
    { role: "assistant", content: "Users module also uses the factory pattern..." },
    // ... 3 more file reads + analysis ...
    // ... 20 turns of other work ...
  ],
  query: "You mentioned a pattern across the modules earlier. Apply that same pattern to the new notifications module.",
  groundTruth: "Uses the factory pattern consistently with the 5 previously-read modules",
  contextTrigger: 15,
}
```

---

## Appendix B: Expected Outcomes by Approach

| Approach | Expected strength | Expected weakness |
|----------|------------------|-------------------|
| **Positional** (baseline) | Simple, zero cost, works when recency ≈ importance | Fails on early critical decisions, multi-thread conversations |
| **Importance-based** | Preserves critical early context | May be expensive (LLM scorer), heuristics may be noisy |
| **Semantic clustering** | Coherent summaries, good for multi-thread | Overhead of clustering, may not help linear conversations |
| **Content-type** | High compression on tool results (biggest token consumers), preserves decisions cheaply | Classification may be inaccurate, doesn't address importance within a type |
| **Combined** | Best of multiple approaches | Highest complexity, may not justify marginal gains |

The most likely outcome: **content-type awareness provides the biggest bang-for-buck** (tool results are the largest token consumers and the most compressible), with **importance scoring as a secondary signal** for deciding what to keep within each type. Semantic clustering may only help in specific multi-threaded scenarios.

But this is a hypothesis — the benchmark will tell the truth.
