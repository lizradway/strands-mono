# Intern Project Brief: Agentic Context Management Strategy

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK (strands-agents/sdk-typescript)  
**Prerequisites:** Familiarity with TypeScript, LLM APIs, basic understanding of agent frameworks  
**Difficulty:** Research-oriented, medium-high implementation complexity

---

## 1. Problem Statement

The Context Management Presets design ([PR #831](https://github.com/strands-agents/docs/pull/831)) defines two strategies for managing the L0 context window:

- **`"auto"`** — the framework transparently compresses and evicts messages when context pressure builds. The agent never knows it's happening.
- **`"agentic"`** — the agent gets tools to actively manage its own context. It decides when to compress, what to protect, and how to navigate evicted history.

`"auto"` ships first because it's safe and predictable. `"agentic"` is marked as **experimental** in the design because it depends on an open research question: *do models effectively use context management tools?*

This is not a trivial question. Giving an agent tools to manage its own context introduces a meta-cognitive layer — the agent must reason about *what it knows* and *what it's about to lose*, not just *what to do next*. Models may:
- Ignore the tools entirely (never compress, hit the wall anyway)
- Over-use them (compress too aggressively, lose important context)
- Use them at the wrong time (compress mid-reasoning, breaking a chain of thought)
- Fail to pin critical information (let the task prompt get evicted)

The research question is: under what conditions do agents benefit from self-managed context, and what tool design / prompting / guardrails make it reliable?

---

## 2. Background & Prior Art

### 2.1 Strands Context Management Architecture

The Context Management Presets design ([PR #831](https://github.com/strands-agents/docs/pull/831)) defines a three-tier cache hierarchy:

| Tier | What it is | Access cost | Backed by |
|------|-----------|-------------|-----------|
| **L0** — Context window | `agent.messages` — what the model sees per request | Zero (already in context) | In-memory message list |
| **L1** — Session history | Append-only log of evicted messages | Low (tool call) | `ContextManager` storage |
| **L2** — Long-term memory | Cross-session knowledge | Higher (query + load) | `MemoryManager` / vector store |

Both strategies share the same infrastructure. The difference is who controls L0:

| Capability | `"auto"` | `"agentic"` |
|--|----------|-------------|
| Framework compresses when threshold hit | Yes | Yes (safety net) |
| Framework caches oversized tool results | Yes | Yes |
| Agent can recover truncated tool output | Yes (`retrieveToolResult`) | Yes |
| Agent can trigger compression | No | Yes (`compressContext`) |
| Agent can protect messages from eviction | No | Yes (`pinMessage`) |
| Agent can read from L1 | No | Yes (`getHistory`) |
| Agent can search L1 | No | Yes (`searchHistory`) |
| Agent can spawn context-aware children | No | Yes (`delegateWithContext`) |
| Agent can check its context budget | No | Yes (`getContextBudget`) |

The plugin decomposition in v2:

| Component | Role | Tools | Mode |
|-----------|------|-------|------|
| `ContextManager` | Config resolver + shared infrastructure | `getContextBudget` (agentic) | Always |
| `ToolResultCache` | Cache oversized tool results | `retrieveToolResult` | Both |
| `ContextCompression` | L0 writes — compression, pinning | `compressContext`, `pinMessage` | Both |
| `ContextNavigation` | Read from L1 (session history) | `getHistory`, `searchHistory` | Agentic only |
| `ContextDelegation` | Context-aware child spawning | `delegateWithContext` | Agentic only |

### 2.2 Prior Art: Agents Managing Their Own Context

**MemGPT / Letta (2023-2025)**  
The original MemGPT paper (Packer et al., 2023) is the foundational work on agents managing their own context. Key ideas:
- OS-inspired virtual memory: main context (RAM) + external storage (disk)
- Agent has explicit `core_memory_save`, `core_memory_replace`, `archival_memory_insert`, `archival_memory_search` tools
- The agent decides what to page in/out
- Demonstrated improved performance on multi-session tasks vs. fixed-context baselines

Limitations observed:
- Models sometimes "forget to remember" — don't save critical info before it's evicted
- Memory management tool calls add latency and cost to every turn
- Weaker models struggle with the meta-cognitive load

**LangChain Deep Agents (2025)**  
Uses a "planning tool as context management" — inspired by Claude Code's todo list. The planning tool is essentially a no-op that keeps agents focused on complex objectives by writing structured state that persists across turns.

**Claude Code (Anthropic)**  
Uses a todo/task list as a form of self-managed working memory. The agent writes plans, checks off items, and uses the list to maintain coherence across long sessions. This is a lightweight form of agentic context management without explicit compression tools.

### 2.3 The Research Gap

No framework has rigorously evaluated *when* agentic context management outperforms framework-managed context. The existing evidence is anecdotal:
- MemGPT shows it works for multi-session personal assistants
- Claude Code shows planning tools help for complex coding tasks
- But no one has measured: What's the breakeven? When does the overhead of meta-cognition exceed the benefit? Which tools matter most? What prompting strategies make agents reliably use context tools?

---

## 3. Project Goals

### Primary Goal
Implement the `"agentic"` context management strategy for Strands and produce a research evaluation answering: when does agent-managed context outperform framework-managed context?

### Success Criteria
1. Working implementation of all agentic context tools (`compressContext`, `pinMessage`, `getHistory`, `searchHistory`, `getContextBudget`, `delegateWithContext`)
2. Benchmark suite comparing `"auto"` vs. `"agentic"` across task types
3. Empirical answer to: which tools do agents actually use, when, and does it help?
4. Prompting/system-prompt guidelines for reliable agentic context use
5. Recommendation on when to default to `"agentic"` vs. `"auto"`

---

## 4. Technical Design

### 4.1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Agent (agentic mode)                  │
│                                                           │
│  System prompt includes:                                  │
│  - Context budget awareness instructions                 │
│  - When/how to use context management tools              │
│                                                           │
│  Available tools:                                         │
│  ├── [user-defined tools]                                │
│  ├── retrieveToolResult    (from ToolResultCache)        │
│  ├── compressContext       (from ContextCompression)     │
│  ├── pinMessage            (from ContextCompression)     │
│  ├── getHistory            (from ContextNavigation)      │
│  ├── searchHistory         (from ContextNavigation)      │
│  ├── getContextBudget      (from ContextManager)         │
│  └── delegateWithContext   (from ContextDelegation)      │
│                                                           │
└─────────────────────────────────────────────────────────┘
         │                              │
         │ compresses to                │ reads from
         ▼                              ▼
┌─────────────────┐           ┌─────────────────┐
│   L0 (context)  │           │  L1 (history)   │
│   agent.messages│──evict──▶│  append-only log │
└─────────────────┘           └─────────────────┘
```

The safety net: even in agentic mode, the framework's `BeforeModelCallEvent` hook still fires if L0 exceeds the threshold. The agent's tools are *proactive* — the framework hook is *reactive* (last resort). This prevents crashes when the agent fails to self-manage.

### 4.2 Tool Specifications

#### `getContextBudget`

Returns the agent's current context state — how much is used, how much remains, what's at risk.

```typescript
interface ContextBudget {
  totalTokens: number          // Model's context window size
  usedTokens: number           // Current L0 usage
  remainingTokens: number      // Available budget
  utilizationRatio: number     // 0-1 (usedTokens / totalTokens)
  messageCount: number         // Number of messages in L0
  protectedMessages: number    // Messages that cannot be evicted
  compressionThreshold: number // Ratio at which framework auto-compresses
}
```

**Design question:** Should this be injected into every turn automatically (like a system prompt addition), or only available on-demand? Automatic injection costs tokens every turn. On-demand risks the agent not checking.

#### `compressContext`

Triggers compression of older messages in L0. The agent can specify what to compress.

```typescript
interface CompressContextInput {
  strategy?: 'summarize' | 'truncate'  // default: 'summarize'
  preserveRecent?: number              // keep last N messages untouched (default: 5)
  targetUtilization?: number           // compress until this ratio (default: 0.5)
}

interface CompressContextOutput {
  compressedMessages: number    // how many messages were compressed
  tokensSaved: number           // tokens freed
  newUtilization: number        // resulting utilization ratio
}
```

#### `pinMessage`

Marks a message as protected from eviction. Useful for task prompts, critical instructions, or intermediate results the agent needs to preserve.

```typescript
interface PinMessageInput {
  messageIndex: number          // which message to pin (relative to current L0)
  reason?: string               // why (for observability)
}
```

**Design question:** Should there be an `unpinMessage` tool? Or a max pin count to prevent the agent from pinning everything?

#### `getHistory`

Retrieves evicted messages from L1 by position (pagination).

```typescript
interface GetHistoryInput {
  startTurn?: number            // turn ID to start from (default: earliest)
  limit?: number                // max messages to return (default: 20)
}

interface GetHistoryOutput {
  messages: MessageSummary[]    // condensed view of historical messages
  hasMore: boolean              // pagination indicator
  totalTurns: number            // total turns in L1
}
```

#### `searchHistory`

Semantic or keyword search over L1 — find specific information that was evicted.

```typescript
interface SearchHistoryInput {
  query: string                 // what to search for
  strategy?: 'keyword' | 'semantic'  // default: TBD based on research
  limit?: number                // max results (default: 10)
}

interface SearchHistoryOutput {
  results: {
    turnId: number
    content: string             // relevant excerpt
    role: 'user' | 'assistant'
    relevanceScore?: number
  }[]
}
```

#### `delegateWithContext`

Spawns a child agent with a subset of the current context. For long tasks where the parent is running out of context, it can delegate a sub-task to a fresh agent with relevant history.

```typescript
interface DelegateWithContextInput {
  task: string                  // what the child should accomplish
  contextSelection: {
    includeSystemPrompt: boolean
    includeRecentMessages?: number   // last N messages
    includeSearchResults?: string    // query to select relevant history
    includePinnedMessages?: boolean
  }
  model?: string                // optional different model for child
}

interface DelegateWithContextOutput {
  result: string                // child agent's final response
  tokenCost: number             // tokens consumed by child
}
```

### 4.3 System Prompt Design

The agentic strategy needs system prompt instructions that teach the agent *when* and *how* to manage its context. This is a critical design challenge — the instructions themselves consume tokens.

Proposed approach (to be validated through experimentation):

```
You have access to context management tools. Your context window has a finite budget.

Guidelines:
- Check your budget (getContextBudget) when working on long tasks
- When utilization exceeds 70%, consider compressing older context
- Pin messages that contain critical information you'll need later
- If you need information from earlier in the conversation that's no longer visible, search your history
- For large sub-tasks, consider delegating to a child agent to preserve your context budget
- Do NOT compress context mid-reasoning — finish your current thought first
```

**Key research question:** How much instruction is needed? Too little and agents ignore the tools. Too much and the instructions themselves waste context. Is few-shot prompting (examples of good context management) more effective than rules?

### 4.4 Safety Mechanisms

| Mechanism | Purpose |
|-----------|---------|
| Framework auto-compress (safety net) | Prevent crashes even if agent doesn't self-manage |
| Protected message floor | First N messages (task prompt) always protected |
| Max pin count | Prevent agent from pinning everything (defeating the purpose) |
| Compression cooldown | Prevent rapid successive compressions (thrashing) |
| Budget injection threshold | Auto-inject budget info when utilization > X% |

---

## 5. Evaluation Plan

### 5.1 Research Questions to Answer

1. **Does agentic context management outperform auto?** Under what conditions?
2. **Which tools do agents actually use?** Usage frequency, timing, appropriateness.
3. **What's the overhead?** Extra tokens spent on context management tool calls vs. tokens saved.
4. **Does it prevent information loss?** Can agents preserve critical context that auto-mode would evict?
5. **How does model capability affect it?** Do stronger models use context tools more effectively?
6. **What prompting strategies work?** Rules vs. examples vs. budget injection vs. minimal guidance.

### 5.2 Benchmark Tasks

**Task Category 1: Long-form coding tasks**
- Multi-file refactoring with many tool results (context accumulates fast)
- Baseline: auto-mode agent hits compression, loses track of earlier decisions
- Hypothesis: agentic agent pins architectural decisions, delegates file-level work

**Task Category 2: Multi-step research**
- Agent gathers information from multiple sources, synthesizes at the end
- Baseline: auto-mode compresses early findings, final synthesis is incomplete
- Hypothesis: agentic agent searches history to recover compressed findings

**Task Category 3: Conversational assistant (many turns)**
- 50+ turn conversation with callbacks to earlier topics
- Baseline: auto-mode loses early conversation context
- Hypothesis: agentic agent manages what to keep vs. compress based on importance

**Task Category 4: Short tasks (control)**
- Tasks that fit easily in context
- Hypothesis: agentic mode adds overhead with no benefit (should match or slightly underperform auto)

### 5.3 Metrics

| Metric | What it measures | Expected outcome |
|--------|-----------------|-----------------|
| Task completion accuracy | Does the agent accomplish the goal? | Agentic > Auto on long tasks |
| Information retention | Can the agent recall critical earlier context? | Agentic > Auto |
| Total token cost | Tokens consumed (including context tool calls) | Agentic slightly higher |
| Cost-adjusted accuracy | Accuracy per dollar spent | Agentic wins on long tasks, loses on short |
| Tool usage patterns | Which tools, when, how often | Informs tool design |
| Compression timing | When does the agent choose to compress? | Validates design heuristics |
| Pin behavior | What does the agent choose to protect? | Validates pin mechanism |
| Failure modes | When does agentic make things worse? | Informs guardrails |

### 5.4 Ablation Studies

Test each tool independently to measure its marginal contribution:

| Configuration | What it tests |
|---------------|--------------|
| Auto (baseline) | Framework-only management |
| Auto + `getContextBudget` only | Does awareness alone help? |
| Auto + `compressContext` | Does proactive compression help? |
| Auto + `pinMessage` | Does protecting messages help? |
| Auto + `searchHistory` | Does L1 access help? |
| Auto + `delegateWithContext` | Does delegation help? |
| Full agentic (all tools) | Combined effect |

### 5.5 Model Comparison

Run the full benchmark across:
- Claude Sonnet 4 (strong, good tool use)
- GPT-4o (strong, different tool-use style)
- Claude Haiku 3.5 (fast, weaker reasoning)
- GPT-4o-mini (fast, weaker reasoning)

Hypothesis: stronger models benefit more from agentic mode because they can reason about when to use context tools. Weaker models may be better off with auto.

---

## 6. Timeline

### Phase 1: Foundation (Weeks 1-3)

**Week 1: Orientation + Design**
- Read the context strategy design (PR #831), MemGPT paper, Letta's implementation
- Set up local dev environment with Strands SDK
- Understand existing plugin architecture, hook system, and tool registration
- Write detailed technical design doc for the agentic tools

**Week 2: Core Tools (Part 1)**
- Implement `getContextBudget` (read-only, simplest tool)
- Implement `compressContext` (wraps existing `ContextCompression` plugin methods)
- Implement `pinMessage` (metadata flag on messages)
- Unit tests for each tool

**Week 3: Core Tools (Part 2)**
- Implement `getHistory` (reads from L1 storage with pagination)
- Implement `searchHistory` (keyword search over L1 batches)
- Implement `delegateWithContext` (spawns child agent with context subset)
- End-to-end test: agent uses all tools in a multi-turn conversation

### Phase 2: System Prompt & Integration (Weeks 4-5)

**Week 4: System Prompt Research**
- Design and test 3-4 prompting strategies for context management instructions
- Measure: do agents actually use the tools? When? Appropriately?
- Iterate on prompt wording based on observed behavior
- Implement budget injection (auto-inject context state at high utilization)

**Week 5: Safety & Integration**
- Implement safety mechanisms (max pins, compression cooldown, framework safety net)
- Integrate with `ContextManager` config resolution (`"agentic"` string → plugin composition)
- End-to-end integration: `new Agent({ contextManager: "agentic" })` works

### Phase 3: Evaluation (Weeks 6-9)

**Week 6: Benchmark Design**
- Design synthetic task suites for each category (coding, research, conversational, control)
- Build evaluation harness (automated scoring, token tracking, tool usage logging)
- Implement metrics collection

**Week 7: Core Benchmarks**
- Run auto vs. agentic comparison across all task categories
- Collect tool usage patterns and failure modes
- Initial analysis: where does agentic win/lose?

**Week 8: Ablation Studies**
- Run each tool independently (measure marginal contribution)
- Test across 2-3 models (strong vs. weak)
- Identify which tools are load-bearing vs. marginal

**Week 9: Optimization**
- Tune system prompts based on failure mode analysis
- Adjust safety mechanisms based on observed thrashing/over-pinning
- Re-run benchmarks with optimized configuration
- Document findings

### Phase 4: Polish (Week 10)

**Week 10: Deliverables**
- Write integration guide and API documentation
- Final benchmark report with recommendations
- Decision framework: when to use `"auto"` vs. `"agentic"`
- Present findings to team

---

## 7. Key Research Questions

1. **Is the meta-cognitive overhead worth it?** Every context management tool call costs tokens. When do the savings (from better compression timing, preserved critical context) exceed the cost of the tool calls themselves?

2. **What's the minimum viable tool set?** Maybe agents only need `getContextBudget` + `compressContext` and the other tools add complexity without benefit. Or maybe `searchHistory` is the killer tool. The ablation study answers this.

3. **How should budget awareness be delivered?** Options: (a) tool the agent calls on-demand, (b) injected into system prompt every turn, (c) injected only when utilization exceeds a threshold, (d) included in the model's response metadata. Each has different cost/reliability tradeoffs.

4. **Do agents learn to manage context over a session?** Does an agent get better at using context tools as the conversation progresses (in-context learning)? Or does performance stay flat?

5. **What failure modes emerge?** Potential issues: compression thrashing (compress → realize it lost something → search history → re-add → compress again), over-pinning (everything is "critical"), under-use (agent ignores tools until crash).

6. **How does task structure affect the answer?** Hypothesis: agentic mode helps most for tasks with unpredictable information importance (where the framework can't know what to evict). Tasks with predictable structure (recent = important) may be fine with auto.

7. **Can delegation substitute for context management?** If an agent can spawn children for sub-tasks, does it even need compression/pinning? Or is delegation alone sufficient for long tasks?

---

## 8. Resources

### Papers
- [MemGPT (Packer et al., 2023)](https://arxiv.org/abs/2310.08560) — foundational work on agent-managed context
- [Lost in the Middle (Liu et al., 2023)](https://arxiv.org/abs/2307.03172) — position effects on retrieval accuracy
- [StreamingLLM (Xiao et al., 2023)](https://arxiv.org/abs/2309.17453) — attention sink and sliding window
- [Recursive Summarization (Wu et al., 2021)](https://arxiv.org/abs/2109.10862) — hierarchical summarization for long documents

### Implementations
- [Letta/MemGPT](https://github.com/lettaai/letta) — agent-managed memory with explicit tools
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — planning tool as context management
- [Strands SDK TypeScript](https://github.com/strands-agents/sdk-typescript) — target codebase

### Strands Designs
- [PR #831](https://github.com/strands-agents/docs/pull/831) (`designs/0010-context-strategy.md`) — Context management presets (defines agentic strategy)
- [PR #844](https://github.com/strands-agents/docs/pull/844) (`designs/0011-knowledge-bases.md`) — MemoryManager primitive (L2 interface)

### Key Interfaces to Build Against
- `ContextManager` — config resolution, token estimation, budget tracking
- `ContextCompression` plugin — compression logic, message protection
- `ToolResultCache` plugin — oversized tool result caching
- L1 storage — batch files of evicted messages
- Agent tool registration — hook-based tool injection

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Models don't reliably use context tools | High | High | This is the core research question. Mitigate by testing multiple prompting strategies and identifying which models work. If no model reliably self-manages, the finding itself is valuable (validates keeping "auto" as default). |
| Agentic mode is always worse than auto | Medium | Medium | Even a negative result is publishable and useful — it validates the design decision to ship "auto" first. Pivot to identifying the *subset* of conditions where agentic helps. |
| Tool overhead exceeds savings | Medium | Medium | Track cost precisely. If overhead is high, focus on the minimal tool set that provides benefit (possibly just `getContextBudget` + `searchHistory`). |
| Benchmark tasks don't represent real usage | Medium | Medium | Partner with internal teams using Strands agents to source realistic long-running task scenarios. Supplement synthetic benchmarks with case studies. |
| `"auto"` strategy not yet implemented to compare against | Low | High | Coordinate with the team implementing auto-mode. If auto isn't ready, compare against no-context-management baseline (simulates the current SDK behavior). |
| Delegation complexity (spawning child agents) | Medium | Low | Implement delegation last. If it's too complex for the timeline, ship the other tools and flag delegation as future work. |

---

## 10. What "Done" Looks Like

At the end of 10 weeks, the intern delivers:

1. **A working implementation** — `contextManager: "agentic"` that registers all context management tools and integrates with the plugin architecture
2. **Benchmark results** — quantified comparison of auto vs. agentic across task types, models, and tool configurations
3. **An ablation analysis** — which tools matter, which are marginal
4. **System prompt guidelines** — validated prompting strategies for reliable context tool use
5. **A decision framework** — when to recommend `"agentic"` vs. `"auto"` to users
6. **A design doc** — suitable for inclusion in `strands-agents/docs/designs/`
7. **A presentation** — 15-minute demo of findings to the team

---

## Appendix A: Example Walkthrough

### Scenario: Multi-file refactoring (60+ turns)

**Turn 1-5:** User describes the refactoring task. Agent reads 8 files, builds understanding.

**Turn 15:** Agent checks budget → 62% utilized. Pins the architectural decision from turn 3 ("we're moving from class-based to functional components").

**Turn 25:** Agent checks budget → 78% utilized. Proactively compresses turns 6-20 (file reads that are now stale — files have been modified since). Summary preserved in L0.

**Turn 35:** User asks "wait, what was the typing issue we discussed earlier?" Agent searches history → finds the exchange from turn 12 about generic constraints. Returns the relevant excerpt without having kept it in L0 the whole time.

**Turn 45:** Agent's context is filling again. Delegates the remaining test file updates to a child agent with: system prompt + architectural decision (pinned) + recent 5 messages. Parent agent's context stays manageable.

**Turn 50:** Task complete. Total token cost: 15% higher than auto-mode, but task completion accuracy: 95% vs. 72% for auto (which lost the architectural decision during compression and made inconsistent changes in later files).

---

## Appendix B: Comparison with Auto Mode

| Dimension | `"auto"` | `"agentic"` |
|-----------|----------|-------------|
| **Who decides what to compress** | Framework (oldest messages first, skip protected) | Agent (can choose based on importance) |
| **What gets protected** | First N messages (positional) | Agent-selected messages (semantic) |
| **Access to evicted content** | None (or only via `retrieveToolResult`) | Full L1 search and browsing |
| **Sub-task handling** | Agent manages everything in one context | Can delegate sub-tasks to fresh contexts |
| **Overhead** | Zero (invisible to agent) | Token cost of tool calls + system prompt instructions |
| **Reliability** | High (deterministic rules) | Variable (depends on model quality) |
| **Best for** | Short tasks, cost-sensitive, predictable structure | Long tasks, complex reasoning, unpredictable importance |

---

## Appendix C: Prompting Strategy Variants to Test

### Variant A: Minimal (rules only)
```
You have context management tools available. Use them when your context is filling up.
```

### Variant B: Structured guidelines
```
Context Management Guidelines:
- Your context window is finite. Monitor your budget with getContextBudget.
- When utilization > 70%: compress older, less relevant messages.
- Pin messages containing decisions, requirements, or critical findings.
- If you need evicted information, search your history before re-doing work.
- For independent sub-tasks, delegate to preserve your context.
- Never compress mid-reasoning.
```

### Variant C: Budget injection (automatic)
System injects a `[Context: 73% used, 52k tokens remaining]` line when utilization exceeds 60%. No explicit instructions about tools — rely on the model figuring out tool semantics from descriptions.

### Variant D: Few-shot examples
Include 2-3 examples in the system prompt showing good context management decisions (when to pin, when to compress, when to search). More expensive but may be more reliable for weaker models.

### Variant E: Adaptive
Start with minimal instructions. If the agent hits 85% without using any context tools, inject a stronger hint. Escalating nudges.
