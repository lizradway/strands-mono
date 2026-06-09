# Design: ContextManager Class

**Status**: Proposed  
**Date**: 2026-06-09  
**Scope**: TypeScript + Python SDK  
**Related**: [Context Strategy Design (v1 facade)](https://github.com/strands-agents/docs/pull/831), [MemoryManager Design](https://github.com/strands-agents/docs/pull/844), [Message Pinning](https://github.com/strands-agents/harness-sdk/pull/2644)

---

## 1. Problem

The v1 `contextManager: "auto"` facade proves the value of one-liner context management. But it's a fixed composition — users who need different compression strategies, content-aware routing, third-party integrations, or custom eviction logic have no path between `"auto"` and manually wiring plugins/conversation managers.

The SDK needs a `ContextManager` class that:
- Preserves the one-liner simplicity of `"auto"`
- Offers progressive disclosure to full customization
- Supports pluggable third-party compression services
- Unifies the concepts of compression, offloading, eviction, and protection into one model
- Provides the L1 transcript layer for message recovery and MemoryManager integration

---

## 2. Core Model

### 2.1 The Single Concept: Strategy

Everything the ContextManager does when under budget pressure is a **strategy** applied to messages. There is no separate "offloader" vs "compressor" vs "evictor" — these are all strategies:

| Strategy | L0 result | Writes to L1? | Recoverable? |
|----------|-----------|---------------|--------------|
| `"protect"` | Unchanged | No (still in L0) | N/A |
| `"summarize"` | Replaced with summary | Yes | Yes (from L1) |
| `"truncate"` | Replaced with partial (head/tail/head-tail) | Yes | Yes (from L1) |
| `"offload"` | Replaced with preview + reference | Yes | Yes (via retrieval tool) |
| `"drop"` | Removed entirely | No | No |
| `"skeleton"` | Code: keep signatures, drop bodies | Yes | Yes |
| `"schema-only"` | JSON: keep keys/structure, drop values | Yes | Yes |
| `"collapse-pairs"` | tool_use + tool_result → one-line summary | Yes | Yes |

### 2.2 L1 Writing

L1 writing is not a strategy attribute — it's a **ContextManager-level behavior**. Before any lossy transformation, the ContextManager persists the original to L1 (transcript). Strategies only decide *how* to transform L0; the ContextManager decides *whether* to preserve.

Exceptions:
- `"protect"` — no L1 write needed (message stays in L0)
- `"drop"` — explicitly discards without preservation

### 2.3 Priority-Based Eviction

Every message has a priority score. When budget pressure hits, the ContextManager:

1. Sorts messages by priority (lowest first)
2. Takes lowest-priority messages as candidates until enough budget would be freed
3. Writes candidates to L1 (preserve originals)
4. Passes candidates to the strategy (via ContentRouter or single strategy)
5. Strategy returns transformed messages
6. Merges untouched + transformed back into L0

Priority sources:
- **Role-based defaults**: user=100, assistant=80, tool_use=60, tool_result=40, tool_result_error=10
- **Recency**: decays over turns (recent messages are higher priority)
- **Pinned**: `priority: Infinity` — never becomes a candidate
- **Position-based**: `protectFirst: N` pins the first N messages automatically

Pinning (from PR #2644) maps directly: `metadata.custom.pinned = true` → `priority: Infinity`. The existing `pinMessage()`/`unpinMessage()`/`isPinned()` utilities continue to work unchanged.

---

## 3. Developer Experience

```typescript
// Level 1: One-liner (80% of users)
const agent = new Agent({ contextManager: "auto" })

// Level 2: Tweak the preset
const agent = new Agent({
  contextManager: { preset: "auto", storage: new S3Storage(...), threshold: 0.9 }
})

// Level 3: Content-aware routing
const agent = new Agent({
  contextManager: new ContextManager({
    strategy: new ContentRouter({
      toolResults: new OffloadStrategy({ preview: "head-tail", keepRecent: 3 }),
      toolResultErrors: new DropStrategy({ keepLast: 1 }),
      assistantMessages: new SummarizeStrategy({ ratio: 0.3 }),
      userMessages: "protect",
      images: "offload",
    }),
    storage: new S3Storage(...),
  })
})

// Level 4: Plug in third-party
const agent = new Agent({
  contextManager: new ContextManager({
    strategy: new HeadroomStrategy({ apiKey: '...' }),
  })
})
```

---

## 4. Strategy Interface

### 4.1 The core interface (what 3P implements)

```typescript
interface CompressionStrategy {
  name: string
  compress(messages: Message[], budget: TokenBudget): Promise<Message[]>
}
```

Messages in, fewer/smaller messages out. The ContextManager handles L1 writing, priority sorting, pin filtering, and budget tracking — strategies don't need to know about any of that.

### 4.2 TokenBudget

```typescript
type TokenBudget = {
  limit: number       // model's context window
  used: number        // current token usage
  remaining: number   // limit - used
  ratio: number       // used / limit (0-1)
  target: number      // how many tokens to free (used - threshold * limit)
}
```

### 4.3 Built-in strategies

```typescript
// String shorthands (use defaults)
type StrategyShorthand = "protect" | "summarize" | "truncate" | "offload" | "drop"
                       | "skeleton" | "schema-only" | "collapse-pairs"

// Configurable class instances
new SummarizeStrategy({ ratio?: number, model?: Model, prompt?: string })
new TruncateStrategy({ keep?: "head" | "tail" | "head-tail", tokens?: number })
new OffloadStrategy({
  preview?: "head" | "tail" | "head-tail",
  previewTokens?: number,
  thresholdRatio?: number,       // offload results > this fraction of context window (default 0.0075)
  threshold?: number,            // or absolute token count (overrides ratio)
  keepRecent?: number,           // never offload last N tool results
  skipTools?: string[],          // never offload results from these tools
  fallback?: CompressionStrategy | StrategyShorthand,
})
new SkeletonStrategy({ languages?: string[], fallback?: CompressionStrategy | StrategyShorthand })
new DropStrategy({ keepLast?: number })  // drop failed attempts, keep most recent N
```

### 4.4 ContentRouter

```typescript
class ContentRouter implements CompressionStrategy {
  name = 'content-router'

  constructor(routes: {
    toolResults?: CompressionStrategy | StrategyShorthand
    toolResultErrors?: CompressionStrategy | StrategyShorthand
    assistantMessages?: CompressionStrategy | StrategyShorthand
    userMessages?: CompressionStrategy | StrategyShorthand
    images?: CompressionStrategy | StrategyShorthand
    documents?: CompressionStrategy | StrategyShorthand
    code?: CompressionStrategy | StrategyShorthand
    json?: CompressionStrategy | StrategyShorthand
    default?: CompressionStrategy | StrategyShorthand
  })
}
```

The router inspects each message/content block and dispatches to the appropriate strategy. Unmatched content uses `default` (falls back to `"truncate"` if not specified).

### 4.5 FallbackChain

```typescript
class FallbackChain implements CompressionStrategy {
  name = 'fallback-chain'
  constructor(strategies: CompressionStrategy[])
  // Tries each in order. If one throws (e.g. API down), falls back to next.
}
```

---

## 5. Third-Party Integration

### 5.1 Design principles

- 3P strategies implement the same `CompressionStrategy` interface as ours
- No special adapter layer — 3P is just another strategy
- We ship wrapper packages for popular services (`@strands-agents/context-headroom`, etc.)
- The interface is simple enough (~10 lines) for community wrappers

### 5.2 Example wrapper (~10 lines)

```typescript
// @strands-agents/context-headroom
export class HeadroomStrategy implements CompressionStrategy {
  name = 'headroom'
  private client: HeadroomClient

  constructor(config: { apiKey: string }) {
    this.client = new HeadroomClient(config)
  }

  async compress(messages: Message[], budget: TokenBudget): Promise<Message[]> {
    return this.client.compress(messages, { targetTokens: budget.remaining })
  }
}
```

### 5.3 Potential 3P integrations

| Service | Type | What we'd wrap |
|---------|------|----------------|
| Headroom | Managed API | Multi-stage compression with reversible storage |
| LLMLingua-2 | Local library | BERT-based token classification (fast, no LLM call) |
| Claw Compactor | Local library | 14-stage fusion pipeline (AST-aware, JSON sampling) |
| Leanctx | Local library | Content-aware routing to different compressors |
| Sigmap | Local library | AST signature extraction (97% reduction for code) |
| Squeez | Local model | Trained tool output pruner (keeps relevant lines) |
| Snip | CLI tool | Composable pipeline for shell output filtering |

---

## 6. ContextManager Class

### 6.1 Constructor

```typescript
export class ContextManager implements Plugin {
  readonly name = 'strands:context-manager'

  constructor(config?: {
    strategy?: CompressionStrategy | ContentRouter | StrategyShorthand
    storage?: Storage
    threshold?: number              // proactive compression ratio (0-1], default 0.85
    protectFirst?: number           // pin first N messages, default 1
    transcript?: {
      enabled?: boolean             // write to L1 before eviction, default true
      retrieval?: boolean           // register retrieval tools, default true
    }
    budget?: {
      reserveForTools?: number      // fraction to keep free for tool results (0-1)
      reserveForMemory?: number     // fraction to keep free for memory injection (0-1)
    }
    telemetry?: boolean             // emit OTEL spans per strategy, default false
  })
}
```

### 6.2 What "auto" resolves to

```typescript
new ContextManager({
  strategy: new ContentRouter({
    toolResults: new OffloadStrategy({
      preview: "head-tail",
      thresholdRatio: 0.0075,
      keepRecent: 3,
    }),
    toolResultErrors: new DropStrategy({ keepLast: 1 }),
    assistantMessages: new SummarizeStrategy({ ratio: 0.3 }),
    userMessages: "protect",
    images: "offload",
  }),
  storage: new InMemoryStorage(),
  threshold: 0.85,
  protectFirst: 1,
  transcript: { enabled: true, retrieval: true },
})
```

### 6.3 Lifecycle hooks

| Hook | Action |
|------|--------|
| `BeforeModelCallEvent` | Check budget ratio. If > threshold, run proactive compression. |
| `AfterToolCallEvent` | Check tool result size. If > offload threshold, apply tool result strategy immediately. |
| `AfterModelCallEvent` | If `ContextWindowOverflowError`, run reactive compression (must succeed). |
| `AgentInitializedEvent` | Register retrieval tools if transcript.retrieval is true. |

### 6.4 Relationship to ConversationManager

When `contextManager` is set:
- `ConversationManager` is set to `NullConversationManager` (disabled)
- `ContextManager` owns all compression, overflow recovery, and proactive reduction
- Existing `conversationManager` param continues to work for users who don't use `contextManager`

### 6.5 Public API on the instance

```typescript
class ContextManager {
  // Read-only state
  get budget(): TokenBudget
  get transcript(): TranscriptReader  // .search(query), .getRecent(n)

  // Programmatic control
  compress(): Promise<void>           // trigger compression manually
  pin(messageIndex: number): void     // pin a message (priority → Infinity)
  unpin(messageIndex: number): void   // unpin a message (priority → default)
}
```

---

## 7. L1 Transcript

### 7.1 What it is

An append-only log of messages evicted from L0. Written before any lossy transformation. Provides the agent with a way to recover information that was compressed away.

### 7.2 Storage

Uses the same `Storage` interface as the offloader. Default: `InMemoryStorage` (non-durable). For session-based agents, use `FileStorage` or `S3Storage`.

### 7.3 Eviction

L1 grows as more messages are evicted from L0. Automatic eviction prevents unbounded storage growth:

```typescript
transcript: {
  maxSize?: number | string,     // e.g. 10_000_000 or "10MB"
  eviction?: "after-extraction" | "oldest-first" | "never"
}
```

| Eviction policy | Behavior |
|-----------------|----------|
| `"after-extraction"` | Only evict messages that MemoryManager has already processed (extracted to L2). Unprocessed messages stay until extraction completes. Default when `memoryManager` is configured. |
| `"oldest-first"` | Evict oldest messages regardless of extraction status. Default when no `memoryManager` is configured. |
| `"never"` | L1 grows unbounded. For short-lived agents or when storage is cheap. |

When `"oldest-first"` is used without a MemoryManager, unextracted information is permanently lost. This is acceptable for many use cases but worth surfacing — users who want cross-session knowledge should configure a MemoryManager.

### 7.4 Retrieval tools (registered when `transcript.retrieval: true`)

```
get_history(limit?: number, offset?: number) → Message[]
search_history(query: string, limit?: number) → Message[]
```

### 7.5 MemoryManager bridge

`MemoryManager` gets read access to the transcript for L1→L2 extraction:

```typescript
memoryManager.source = contextManager.transcript
```

ContextManager doesn't know or care about L2. It just exposes its transcript. MemoryManager extracts facts/knowledge from it at session boundaries or on a schedule.

---

## 8. Preview Strategies

How content is previewed when offloaded or truncated:

| Preview | Behavior | Best for |
|---------|----------|----------|
| `"head"` | Keep first N tokens | Structured data, code files |
| `"tail"` | Keep last N tokens | Logs, build output |
| `"head-tail"` | Keep first N/2 + last N/2, elide middle | Terminal output, API responses |

Configurable per strategy:

```typescript
new OffloadStrategy({ preview: "head-tail", previewTokens: 750 })
new TruncateStrategy({ keep: "tail", tokens: 500 })
```

---

## 9. Relationship to Memory SDK Proposal

This design covers L0↔L1 (within-session context management). The broader Memory SDK proposal covers L0↔L1↔L2 with cross-framework adapters.

How they relate:
- **ContextManager** owns L0 (context window) and L1 (session transcript)
- **MemoryManager** owns L2 (cross-session knowledge) and reads from L1 for extraction
- The `Storage` interface and `CompressionStrategy` interface are the same ones the Memory SDK proposal would use
- If the Memory SDK ships, ContextManager becomes a component within it (not replaced by it)

This design is compatible with the broader vision but doesn't depend on it. Ship ContextManager now; align with Memory SDK later if/when it materializes.

---

<details>
<summary><b>Appendix A: Full Developer Experience Examples</b></summary>

### Level 1: One-liner

```typescript
const agent = new Agent({ contextManager: "auto" })
```

### Level 2: Tweak the preset

```typescript
const agent = new Agent({
  contextManager: { preset: "auto", storage: new S3Storage(...), threshold: 0.9 }
})
```

### Level 3: Content-aware routing

```typescript
const agent = new Agent({
  contextManager: new ContextManager({
    strategy: new ContentRouter({
      toolResults: new OffloadStrategy({ preview: "head-tail", keepRecent: 3 }),
      toolResultErrors: new DropStrategy({ keepLast: 1 }),
      assistantMessages: new SummarizeStrategy({ ratio: 0.3 }),
      userMessages: "protect",
      images: "offload",
      code: "skeleton",
      json: "schema-only",
    }),
    storage: new S3Storage(...),
    threshold: 0.85,
  })
})
```

### Level 4: Third-party (single strategy)

```typescript
import { HeadroomStrategy } from '@strands-agents/context-headroom'

const agent = new Agent({
  contextManager: new ContextManager({
    strategy: new HeadroomStrategy({ apiKey: '...' }),
  })
})
```

### Level 5: Third-party mixed with routing

```typescript
const agent = new Agent({
  contextManager: new ContextManager({
    strategy: new ContentRouter({
      toolResults: "offload",
      assistantMessages: new HeadroomStrategy({ apiKey: '...' }),
      userMessages: "protect",
      code: new SkeletonStrategy({ fallback: "head-tail" }),
    }),
  })
})
```

### Level 6: Custom strategy

```typescript
class MyCompression implements CompressionStrategy {
  name = 'my-compression'

  async compress(messages: Message[], budget: TokenBudget): Promise<Message[]> {
    return myCustomLogic(messages, budget)
  }
}

const agent = new Agent({
  contextManager: new ContextManager({ strategy: new MyCompression() })
})
```

### Level 7: Full pipeline control

```typescript
const agent = new Agent({
  contextManager: new ContextManager({
    strategy: new ContentRouter({ ... }),
    storage: new S3Storage(...),
    threshold: 0.85,
    protectFirst: 1,
    transcript: { enabled: true, retrieval: true },
    budget: { reserveForTools: 0.2, reserveForMemory: 0.1 },
    telemetry: true,
  })
})
```

### Python equivalents

```python
# Level 1
agent = Agent(context_manager="auto")

# Level 3
agent = Agent(context_manager=ContextManager(
    strategy=ContentRouter(
        tool_results=OffloadStrategy(preview="head-tail", keep_recent=3),
        tool_result_errors=DropStrategy(keep_last=1),
        assistant_messages=SummarizeStrategy(ratio=0.3),
        user_messages="protect",
        images="offload",
    ),
    storage=S3Storage(...),
))

# Level 4: 3P
from strands_context_headroom import HeadroomStrategy
agent = Agent(context_manager=ContextManager(strategy=HeadroomStrategy(api_key="...")))

# Level 6: Custom
class MyCompression(CompressionStrategy):
    name = "my-compression"
    async def compress(self, messages, budget):
        return my_custom_logic(messages, budget)

agent = Agent(context_manager=ContextManager(strategy=MyCompression()))
```

</details>

---

<details>
<summary><b>Appendix B: Telemetry (OTEL)</b></summary>

When `telemetry: true`, the ContextManager emits:

### Spans

```
strands.context_manager
├── strands.context.proactive_compression
│   ├── attribute: tokens_before
│   ├── attribute: tokens_after
│   ├── attribute: strategy_used
│   └── attribute: messages_affected
├── strands.context.offload
│   ├── attribute: tool_name
│   ├── attribute: original_tokens
│   └── attribute: preview_tokens
└── strands.context.retrieval
    ├── attribute: query
    └── attribute: results_count
```

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `strands.context.compression_count` | Counter | Times compression fired |
| `strands.context.tokens_saved` | Histogram | Tokens freed per compression |
| `strands.context.utilization` | Gauge | Current context window ratio (0-1) |
| `strands.context.offload_count` | Counter | Tool results offloaded |
| `strands.context.retrieval_count` | Counter | Times agent retrieved from L1 |

</details>

---

<details>
<summary><b>Appendix C: Migration Path</b></summary>

### From v1 facade (`contextManager: "auto"`)

No breaking change. `"auto"` continues to work and resolves to the ContextManager class internally:

```typescript
// v1 (current)
new Agent({ contextManager: "auto" })

// v2 (this design) — same behavior, class instance under the hood
new Agent({ contextManager: "auto" })
// Equivalent to:
new Agent({ contextManager: new ContextManager({ preset: "auto" }) })
```

### From ConversationManager

```typescript
// Before
new Agent({ conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3 }) })

// After
new Agent({ contextManager: new ContextManager({ strategy: new SummarizeStrategy({ ratio: 0.3 }) }) })
```

### From message pinning (PR #2644)

Pin utilities (`pinMessage`, `unpinMessage`, `isPinned`) continue to work. The ContextManager reads `metadata.custom.pinned` and treats those messages as `priority: Infinity`.

`pinFirst: N` on conversation managers → `protectFirst: N` on ContextManager.

### Deprecation path

1. **v1 (current)**: `contextManager: "auto"` coexists with `conversationManager`
2. **v2 (this design)**: `contextManager` takes priority. Deprecation warning if both set.
3. **v3**: `conversationManager` removed from constructor type

</details>

---

<details>
<summary><b>Appendix D: Advanced Features (Future)</b></summary>

### Adaptive compression

Observe agent behavior and adjust thresholds:
- If agent frequently retrieves from L1 → threshold too aggressive
- If agent re-asks questions from summarized content → summaries too lossy
- Adjust dynamically based on feedback signals

Status: Research territory. No concrete API yet.

### Multi-agent context sharing

```typescript
const child = new Agent({
  contextManager: new ContextManager({
    inherit: parent.contextManager,  // read-only access to parent's L1
  })
})
```

Child sees parent's transcript but has its own L0. Prevents re-exploration in delegation patterns.

</details>
