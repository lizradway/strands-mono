# Design: Context Management Presets

- [1. Problem Statement](#1-problem-statement)
- [2. The Cache Hierarchy](#2-the-cache-hierarchy)
- [3. Presets](#3-presets)
- [4. TypeScript v1](#4-typescript-v1)
- [5. TypeScript v2](#5-typescript-v2)
- [6. Anticipated Questions](#6-anticipated-questions)
- Appendix A: Code Examples
- Appendix B: Alternatives Considered
- Appendix C: Composition Edge Cases
- Appendix D: Plugin & Strategy Details

---

## 1. Problem Statement

Every non-trivial agent eventually hits context limits. Strands already provides the building blocks to handle this — externalization, compression, conversation managers, hooks — but today these are independent extension points that users must discover, configure, and compose themselves. The SDK covers the 20% case (power users who want full control) but not the 80% case (developers who want context management to just work).

As the [context management roadmap](./ROADMAP.md) ships more capabilities, this gap widens. Each feature is another plugin or tool to wire up. The Strands [tenets](https://github.com/strands-agents/docs/blob/main/team/TENETS.md) call for **the obvious path to be the happy path** and for **simple things to be simple**. Context management should be a one-liner, not a composition exercise.

This design proposes opinionated defaults via a single `contextManagement` parameter on `Agent` — backed by the same extension points that power users already configure manually, but with sensible choices pre-made for everyone else.

---

## 2. The Cache Hierarchy

> **Note:** This hierarchy is presented here for context and understanding — it is not a formal proposal. Thomas's Memory primitive design will formalize the tiered model and define the boundaries between tiers.

Context management maps to a three-tier cache hierarchy. Every operation is movement between tiers.

| Tier | What it is | Access cost | Backed by |
|------|-----------|-------------|-----------|
| **L0 — Context window** | `agent.messages` — what the model sees on every request. May contain summaries where originals were evicted. | Zero (already in context) | In-memory message list |
| **L1 — Transcript** | Append-only log of messages evicted from L0. When messages are compressed out of L0, the originals are appended to L1. Each message is written once — no duplication. | Low (retrieval tool call) | `ContextManager` storage (`FileStorage`, `S3Storage`, etc.) |
| **L2 — Long-term memory** | Cross-session knowledge — archival memory, semantic search index, learned facts. Persists beyond the current session. | Higher (query + load from persistent storage) | Memory primitive, vector store, managed memory services |

L2 (long-term memory) is a separate primitive (`memoryManager`) — out of scope for this document.

---

## 3. Presets

The `contextManagement` parameter accepts a **strategy** that determines who controls L0 — what stays in the context window and when things get compressed to L1.

Both strategies share the same infrastructure. When context pressure builds, L0 is compressed — evicted messages are appended to the transcript (L1) before removal from L0. The transcript is append-only, chronologically ordered, never edited. Oversized tool results are cached separately, and `retrieveToolResult` is always available so the agent can recover truncated outputs without reasoning about context.

The difference: in **auto**, the agent interacts with content. In **agentic**, the agent reasons about its own context.

The logic lives in plugins, not tools. Tools are agent-facing wrappers around plugin methods. In auto mode, the framework calls plugin methods via hooks (e.g., `ContextCompression.compress()` fires on threshold). In agentic mode, the same hooks still fire as a safety net, but tools are also registered so the agent can invoke the same methods proactively. The strategy controls which tools are exposed — not what logic exists.

| | `"auto"` | `"agentic"` |
|--|----------|-------------|
| Framework compresses when threshold hit | Yes | Yes |
| Framework caches oversized tool results | Yes | Yes |
| Agent can recover truncated tool output | Yes (`retrieveToolResult`) | Yes |
| Agent can trigger compression | No | Yes (`compressContext`) |
| Agent can protect messages from eviction | No | Yes (`pinMessage`) |
| Agent can read from the transcript (L1) | No | Yes (`getTranscript`) |
| Agent can search the transcript | No | Yes (`searchTranscript`) |
| Agent can spawn context-aware children | No | Yes (`delegateWithContext`) |
| Agent can check its context budget | No | Yes (`getContextBudget`) |

Users who don't want presets can build custom context management using the same infrastructure. Token tracking ([#1197](https://github.com/strands-agents/sdk-python/issues/1197)), message metadata ([#1532](https://github.com/strands-agents/sdk-python/issues/1532)), token estimation ([#1294](https://github.com/strands-agents/sdk-python/issues/1294)), and context limit ([#1295](https://github.com/strands-agents/sdk-python/issues/1295)) together give users everything they need to write their own `BeforeModelCallEvent` hooks with custom policies. The presets are opinionated compositions of these primitives, not the only way to use them.

### `"auto"` — The framework decides

The framework manages L0 transparently. When context pressure builds, messages are summarized or dropped in L0. The agent doesn't know context management is happening — it just never hits a wall. The only tool exposed is `retrieveToolResult` for recovering truncated tool outputs.

In v2, `ContextCompression` also writes evicted messages to the transcript (L1) before compression — enabling `ContextNavigation` and `memoryManager` to read from it.

**Use cases:** Beginners who don't want to think about context yet. Production deployments where predictability matters more than autonomy. Cost-sensitive workloads at scale. Multi-agent systems where child agents need lightweight, hands-off management. Anyone who wants it to just not break.

### `"agentic"` — The agent decides

> **Note:** `"agentic"` is experimental. It depends on research into whether models effectively use context management tools. `"auto"` ships first and is the primary focus.

Everything `"auto"` does still happens — the agent *also* gets tools to actively manage its own L0. It can decide when to compress, what to protect from eviction, and browse evicted messages in L1.

The transcript is append-only — evicted messages accumulate but are never edited. The agent's power is over L0: what stays in the context window.

**Use cases:** Research agents and coding assistants that benefit from self-awareness about their context state. Long-running autonomous agents. Exploratory development where agent autonomy is the point. Parent agents in multi-agent orchestrations.

### Growth and ownership

More strategies may be added as context management capabilities evolve. Per the [pay-for-play tenet](https://github.com/strands-agents/docs/blob/main/team/TENETS.md), the Strands team owns these presets and reserves the right to make breaking changes to them — what a strategy resolves to underneath (which plugins, which defaults) can change between versions. Users who need stability should configure plugins directly rather than relying on preset internals.

Defaults for all preset configurations (thresholds, strategies, token limits) should be informed by benchmarking before shipping. No default should be set based on intuition alone.

---

## 4. TypeScript v1

Ships `contextManagement: "auto"` as an opt-in parameter.

### What ships

```typescript
// Minimal — defaults to SandboxStorage
const agent = new Agent({ contextManagement: "auto" });

// Explicit storage
const agent = new Agent({
  contextManagement: { strategy: "auto", storage: new S3Storage({ bucket: "my-session" }) },
});

// Disable offloading (compression only)
const agent = new Agent({
  contextManagement: { strategy: "auto", contextOffloader: false },
});

// Custom offloader threshold
const agent = new Agent({
  contextManagement: { strategy: "auto", contextOffloader: { threshold: 5000 } },
});
```

`contextManagement` accepts a string shorthand, a config object, or a `ContextManager` class instance — matching the `model` pattern. Config objects are the happy path (no imports, zero ceremony). Class instances are accepted for power users who need lifecycle hooks or direct storage access. The Agent resolves config into a `ContextManager` instance internally either way.

In v1, the default is `undefined` (no context management). This avoids surprises on upgrade and gives us time to prove the behavior works before making it default.

Under the hood, this wires up:

| Component | What it does |
|-----------|-------------|
| **`ContextOffloader`** | Oversized tool results cached separately (short-lived, auto-evicting) via `AfterToolCallEvent` hook. Agent sees a truncated preview. Provides `retrieveToolResult` tool for on-demand access. Absorbed into `ContextCompression` in v2. |
| **Proactive compression on conversation manager** | `BeforeModelCallEvent` hook checks L0 token usage against threshold. When exceeded, compresses older messages in L0. |
| **Message protection** | Position-based pinning (`protectedMessages = 1` by default) ensures the task prompt is never evicted. |

### Coexistence with `conversationManager`

In v1, the user's conversation manager is respected. The preset configures proactive compression *on* whichever conversation manager the user provides (or the default):

```typescript
// Uses default conversation manager with proactive compression
const agent = new Agent({ contextManagement: "auto" });

// Uses user's conversation manager, still gets proactive compression
const agent = new Agent({
  contextManagement: "auto",
  conversationManager: new SummarizingConversationManager(),
});
```

---

## 5. TypeScript v2

Three changes:
1. **`"auto"` becomes the default** — every agent gets context management unless opted out
2. **`"agentic"` ships** — agent-in-the-loop context management
3. **`conversationManager` is deprecated** — its compression responsibility moves to `ContextCompression`

### Plugin decomposition

Each plugin has a single cohesive responsibility. Storage is configured at the `ContextManager` level and shared — `ContextCompression` writes the transcript, `ContextNavigation` and `memoryManager` read from it.

| Component | Domain | Tools | Mode |
|-----------|--------|-------|------|
| **`ToolResultCache`** | Cache oversized tool results | `retrieveToolResult` | Both (always available) |
| **`ContextCompression`** | L0 writes — compression, pinning | `compressContext`, `pinMessage` (agentic) | Both |
| **`ContextNavigation`** | L1 reads — transcript access | `getTranscript`, `searchTranscript` | Agentic only |
| **`ContextDelegation`** | Context-aware child spawning | `delegateWithContext` | Agentic only |
| `getContextBudget` | Inspect current L0 token usage | — | Agentic (standalone tool) |

v2 introduces `OnContextOverflowEvent` — a new lifecycle event fired on context length errors, replacing the opaque retry logic in conversation managers. The SDK already normalizes these errors across all providers into `ContextWindowOverflowError` — this event just exposes that to plugins.

### `conversationManager` deprecation

In v2, `ContextCompression` takes over compression and transcript writing. Nothing left for `conversationManager`.

**Deprecation path:**
1. **v1 (coexist):** Both live side by side. No conflict.
2. **v2 (deprecate):** Deprecation warning emitted. `contextManagement` takes precedence if both are set.
3. **v3 (remove):** `conversationManager` removed from the constructor type.

---

## 6. Anticipated Questions

**Q: Why isn't `"auto"` the default in v1?**

We need to prove the behavior first. v1 is opt-in so we can validate with early adopters. v2 makes it the default once we're confident it works reliably.

**Q: What happens when users upgrade from v1 to v2?**

Two changes: (1) `"auto"` becomes the default — agents that didn't set `contextManagement` now get it automatically. Users who don't want this can set `contextManagement: false`. (2) Internals upgrade — `ToolResultCache` replaces `ContextOffloader`, `ContextCompression` replaces conversation manager compression — same external behavior.

**Q: What if the user provides their own plugin?**

Deduplication detects by type and skips the preset's version. User's `ToolResultCache`, `ContextCompression`, or `ContextNavigation` (v2) wins.

**Q: Why a config object instead of a class?**

Both are accepted — matching the `model` pattern. Config objects are the happy path (string shorthands work, no imports needed, zero ceremony). Class instances are accepted for power users who need lifecycle hooks, direct storage access, or testability. The Agent resolves config into a `ContextManager` instance internally either way.

**Q: What if models don't effectively use context management tools?**

That's why `"agentic"` is experimental. `"auto"` ships first with proven framework-driven behavior.

**Q: Can users stay on `conversationManager` in v2?**

Yes, with a deprecation warning. It still works — `contextManagement` takes precedence if both are set. Removal happens in v3.

**Q: How does Memory relate to context management?**

Memory is a separate primitive (`memoryManager` parameter) with its own mode and storage — out of scope for this doc, covered by Thomas's Memory primitive design. `contextManager` owns L0 ↔ L1 (within-session); `memoryManager` owns L1 → L2 (cross-session knowledge extraction). The Agent brokers the connection — `memoryManager` gets read access to `contextManager`'s transcript for extraction. Users configure each independently.

---

<details>
<summary><b>Appendix A: Code Examples</b></summary>

### v1 — Auto, minimal

```typescript
import { Agent } from "@strands-agents/sdk";

const agent = new Agent({
  contextManagement: "auto",
  tools: [shell, fileRead],
});
```

### v1 — Auto, with user's conversation manager

```typescript
import { Agent } from "@strands-agents/sdk";

const agent = new Agent({
  contextManagement: "auto",
  conversationManager: new SummarizingConversationManager(),
  tools: [shell, fileRead],
});
```

### v2 — Default (no configuration needed)

```typescript
import { Agent } from "@strands-agents/sdk";

const agent = new Agent({
  tools: [shell, fileRead],
});
// Context management on by default. SandboxStorage, auto strategy.
```

### v2 — Custom storage

```typescript
import { Agent } from "@strands-agents/sdk";
import { S3Storage } from "@strands-agents/storage-s3";

const agent = new Agent({
  contextManagement: {
    storage: new S3Storage({ bucket: "my-session" }),
    strategy: "auto",
    compression: { threshold: 0.8, protectedMessages: 2 },
  },
  tools: [shell, fileRead],
});
```

### v2 — Agentic

```typescript
import { Agent } from "@strands-agents/sdk";

const agent = new Agent({
  contextManagement: "agentic",
  tools: [shell, fileRead],
});
// ContextCompression + ContextNavigation + ContextDelegation active.
// Agent controls its own L0: compress, pin, search L1 history.
```

### v2 — Class instance (power user)

```typescript
import { Agent, ContextManager } from "@strands-agents/sdk";
import { S3Storage } from "@strands-agents/storage-s3";

const cm = new ContextManager({
  storage: new S3Storage({ bucket: "my-session" }),
  strategy: "agentic",
});

const agent = new Agent({
  contextManagement: cm,
  tools: [shell, fileRead],
});

// Direct access to storage (e.g., for Memory integration or testing)
cm.storage; // S3Storage instance
await cm.dispose(); // Cleanup when done
```

### v2 — Opt out

```typescript
import { Agent } from "@strands-agents/sdk";

const agent = new Agent({
  contextManagement: false,
  tools: [shell, fileRead],
});
```

### v2 — Migration from conversationManager

```typescript
// Before (v1 — still works with deprecation warning in v2)
const agent = new Agent({
  conversationManager: new SummarizingConversationManager(),
});

// After (v2 — migrated)
const agent = new Agent({
  contextManagement: { compression: { strategy: "summarize" } },
});
```

</details>

---

<details>
<summary><b>Appendix B: Alternatives Considered</b></summary>

### Class-only primitive (no config object path)

```typescript
new Agent({
  contextManagement: new ContextManager({
    storage: new S3Storage(...),
    strategy: "agentic",
  }),
});
```

**Why rejected as the only path:** Forces an import and instantiation even for the common case. String shorthands (`"auto"`) are simpler. However, class instances ARE accepted as a power-user path — the design supports both (see "Config object or class instance" above).

### Presets as separate Plugin classes

```typescript
new Agent({ plugins: [new AutoContextManager()] });
```

**Why rejected:** Lower discoverability. A constructor parameter is easier to find than a plugin import.

### Factory static methods

```typescript
Agent.withAutoContext({ tools: [...] });
```

**Why rejected:** Must expose full constructor parameter set. Suggests "different kind of Agent."

### Single unified plugin

```typescript
new Agent({
  plugins: [new ContextManager({ mode: "agentic", ... })],
});
```

**Why rejected:**
- God object trajectory as capabilities grow
- Can't ship plugins independently
- Preset hides the decomposition anyway

### Single monolithic class (no plugin decomposition)

```typescript
new Agent({
  contextManager: new ContextManager({ strategy: "summarize", ... }),
});
// Where ContextManager owns compression, caching, navigation, delegation — everything in one class
```

**Why rejected:**
- God object — owns everything
- Fights the composable plugin architecture
- Limits future additions

Note: We adopted the `ContextManager` name but with a different architecture — it's a thin config resolver that composes separate plugins, not a monolith.

</details>

---

<details>
<summary><b>Appendix C: Composition Edge Cases</b></summary>

### v1: User provides both preset and conversationManager

```typescript
new Agent({
  contextManagement: "auto",
  conversationManager: new SummarizingConversationManager(),
});
```

**Behavior:** User's conversation manager is used for compression. `ContextOffloader` still handles tool result caching. No conflict.

### v2: User provides both (deprecated)

```typescript
new Agent({
  contextManagement: "agentic",
  conversationManager: new SummarizingConversationManager(),
});
```

**Behavior:** `contextManagement` takes precedence. Deprecation warning emitted.

### v2: User provides overlapping ContextCompression

```typescript
new Agent({
  contextManagement: "agentic",
  plugins: [new ContextCompression({ storage: new S3Storage(...) })],
});
```

**Behavior:** User's `ContextCompression` wins (dedup). Preset's `ContextNavigation` still registers.

</details>

---

<details>
<summary><b>Appendix D: Plugin & Strategy Details</b></summary>

### `ContextManagerConfig`

```typescript
type ContextManagerInput = "auto" | "agentic" | ContextManagerConfig | ContextManager | false;

interface ContextManagerConfig {
  storage?: Storage;                             // default: SandboxStorage
  strategy?: "auto" | "agentic";                // default: "auto"
  tokenCountingStrategy?: "auto" | "heuristic"; // default: "auto"

  // ToolResultCache plugin config
  toolResultCache?: {
    threshold?: number;                          // token count above which results are cached (TBD)
    maxAge?: number;                             // auto-eviction time in ms (TBD)
  } | false;

  // ContextCompression plugin config
  compression?: {
    threshold?: number;                          // ratio of context window (0–1]; default: 0.7
    strategy?: "truncate" | "summarize";         // default: "summarize"
    protectedMessages?: number;                  // default: 1
  } | false;

  // ContextNavigation plugin config (agentic only)
  navigation?: {
    searchStrategy?: "keyword" | "semantic";     // default: TBD
  } | false;

  // ContextDelegation plugin config (agentic only)
  delegation?: {
    maxChildContextRatio?: number;               // ratio of parent context to share (TBD)
  } | false;
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `storage` | `SandboxStorage` | Backs the transcript (L1). Evicted messages are appended here before compression removes them from L0. Shared across plugins — `ContextCompression` writes, `ContextNavigation` and `memoryManager` read. |
| `strategy` | `"auto"` | Who controls L0: framework (`"auto"`) or agent (`"agentic"`) |
| `tokenCountingStrategy` | `"auto"` | `"auto"` uses native provider API with heuristic fallback; `"heuristic"` always estimates |
| `toolResultCache` | enabled | `ToolResultCache` plugin config. Set to `false` to disable. |
| `toolResultCache.threshold` | TBD | Token count above which tool results are cached |
| `toolResultCache.maxAge` | TBD | Auto-eviction time for cached tool results |
| `compression` | enabled | `ContextCompression` plugin config. Set to `false` to disable. |
| `compression.threshold` | `0.7` | Ratio of context window (0–1] that triggers compression (originals appended to L1, then L0 gets summary or drop) |
| `compression.strategy` | `"summarize"` | What replaces evicted messages in L0: `"summarize"` (condensed block) or `"truncate"` (removed entirely) |
| `compression.protectedMessages` | `1` | Initial messages pinned in L0 (never evicted) |
| `navigation` | enabled (agentic) | `ContextNavigation` plugin config (transcript reads). Set to `false` to disable. Ignored in `"auto"`. |
| `delegation` | enabled (agentic) | `ContextDelegation` plugin config. Set to `false` to disable. Ignored in `"auto"`. |

### What the strategy resolves to

```typescript
// Storage is configured at the ContextManager level and passed to plugins

"auto" → [
  new ToolResultCache({ ... }),
  new ContextCompression({ storage, ... }),
]

"agentic" → [
  new ToolResultCache({ ... }),
  new ContextCompression({ storage, ... }),
  new ContextNavigation({ storage }),
  new ContextDelegation({ storage }),
]
```

### Config object vs class instance

```typescript
// Config object (happy path — no import needed)
new Agent({ contextManagement: "auto" })
new Agent({ contextManagement: { strategy: "agentic", storage: new S3Storage(...) } })

// Class instance (power users — lifecycle, cross-primitive access, testing)
const cm = new ContextManager({ strategy: "agentic", storage: new S3Storage(...) });
new Agent({ contextManagement: cm })
```

**Config object:** String shorthands work, zero ceremony, serializable, Agent brokers cross-primitive access.

**Class instance:** Lifecycle hooks (`initialize()`, `dispose()`), direct access (`agent.contextManagement.storage`), testable, consistent with `conversationManager` pattern.


### How it grows

```
New transcript capability           → lives in ContextCompression (writes) or ContextNavigation (reads)
New tool result behavior            → lives in ToolResultCache
New compression strategy/heuristic  → lives in ContextCompression
New agentic browsing tool           → lives in ContextNavigation
New delegation capability           → lives in ContextDelegation
New config knob                     → gets a sensible default, preset users never see it
New plugin entirely                 → preset composes it automatically
```

### Compression strategies

| Strategy | What stays in L0 | L1 |
|----------|------------------|----------------------|
| `"truncate"` | Messages removed entirely (skip protected) | Originals appended to L1 |
| `"summarize"` | Summary replaces evicted messages | Originals appended to L1 |

### conversationManager migration

| `conversationManager` (today) | `contextManagement` equivalent |
|-------------------------------|-------------------------------|
| `new SlidingWindowConversationManager()` | `{ compression: { strategy: "truncate" } }` |
| `new SummarizingConversationManager()` | `{ compression: { strategy: "summarize" } }` |
| `NullConversationManager` | `false` |
| Custom subclass | `{ compression: { strategy: customFn } }` |

### Type resolution

```typescript
if (typeof input === "string")              → new ContextManager({ strategy: input })
if (input instanceof ContextManager)     → use directly
if (typeof input === "object")              → new ContextManager(input)
if (input === false)                        → null (disabled)
```

</details>
