# Design: Context Management Presets

- [1. Problem Statement](#1-problem-statement)
- [2. Motivation](#2-motivation)
- [3. Design Philosophy: Two Tiers](#3-design-philosophy-two-tiers)
- [4. Roadmap Task Mapping](#4-roadmap-task-mapping)
- [5. API Design](#5-api-design)
- [6. Recommended Design](#6-recommended-design)
- [7. Timeline](#7-timeline)
- [8. Anticipated Questions](#8-anticipated-questions)
- Appendix A: Full Code Examples
- Appendix B: Alternatives Considered
- Appendix C: Composition Edge Cases
- Appendix D: Evolution Over Time
- Appendix E: API Alternatives Considered
- Appendix F: Future Work — Tool Context Management

---

## 1. Problem Statement

Every non-trivial agent eventually hits context limits. Strands already provides the building blocks to handle this — externalization, compression, conversation managers, hooks — but today these are independent extension points that users must discover, configure, and compose themselves. The SDK covers the 20% case (power users who want full control) but not the 80% case (developers who want context management to just work).

As the [context management roadmap](./ROADMAP.md) ships more capabilities — proactive compression, tool discovery, message management, delegation — this gap widens. Each feature is another plugin or tool to wire up. The Strands [tenets](https://github.com/strands-agents/docs/blob/main/team/TENETS.md) call for **the obvious path to be the happy path** and for **simple things to be simple**. Context management should be a one-liner, not a composition exercise.

This design proposes opinionated defaults via a single `context_management` parameter on `Agent` — backed by the same extension points that power users already configure manually, but with sensible choices pre-made for everyone else.

---

## 2. Motivation

### Who is this for?

**Primary audience: Application developers who want context management to "just work."** They don't want to learn the internals of `AfterToolCallEvent` hooks or `Storage` protocols. They want to say "manage my context" and move on.

**Secondary audience: Advanced users who start with a preset and customize.** They use `"auto"` to get started, then graduate to `ContextManagementConfig` or raw plugin configuration when they need S3 storage, custom thresholds, or non-default behavior.

This follows the Strands pattern: opinionated defaults that guide the 80% toward the happy path, with full extensibility for the 20% who need it. The preset *is* the obvious path. The individual plugins are the escape hatch — and they already exist today.

---

## 3. Design Philosophy: Two Tiers

Different agents need different relationships with their context, and that's driven by who's building them and what they're building.

Context management benefits every agent — beginners prototyping their first agent, production workloads optimizing cost, long-running research tasks pushing context limits. `"auto"` makes this zero-effort: the framework silently externalizes oversized results, compresses history before overflow, and keeps the agent running without any changes to agent behavior or additional LLM calls.

Strands is built around the model-driven approach — the model decides what to do, and the framework gets out of the way. `"agentic"` is the natural expression of that tenet applied to context management: give the agent tools to manage its own context and let it decide.

### `"auto"` — The framework decides

Context management happens transparently. The agent doesn't know it's happening. No extra tools are added. The user enables it and forgets about it.

**Characteristics:**
- Zero additional LLM tool-use turns
- No agent-visible changes (no new tools, no retrieval prompts)
- Pure cost reduction or failure prevention
- Hooks and conversation managers do the work silently

**Use cases:** Beginners who don't want to think about context yet. Production deployments where predictability matters more than autonomy (chatbots, customer service agents, pipeline automation). Cost-sensitive workloads at scale where spend reduction is the primary goal. Multi-agent systems where child agents need lightweight, hands-off management. Anyone who wants it to just not break.

### `"agentic"` — The agent decides

The agent is given tools to manage its own context. It can retrieve externalized content, manipulate its message history, discover new tools, and navigate past conversations. The framework provides capabilities; the agent decides when to use them.

**Characteristics:**
- Additional tool-use turns (agent calls management tools)
- Agent-visible changes (new tools appear in its toolset)
- Trades autonomy for additional LLM calls
- Higher capability ceiling, less predictable behavior

**Use cases:** Research agents and coding assistants that benefit from self-awareness about their context state. Long-running autonomous agents that need to retrieve previously externalized content on demand. Exploratory development where agent autonomy is the point. Parent agents in multi-agent orchestrations that need to reason about context budgets and delegate accordingly.

Users who want a mix of both or need enterprise-specific configuration (custom storage, audit trails, data residency) use `ContextManagementConfig`. See [Appendix B](#appendix-b-alternatives-considered) for other tier structures considered.

---

## 4. Roadmap Task Mapping

Every task in the [context management roadmap](./ROADMAP.md) fits into exactly one of three categories relative to presets: **infrastructure** (consumed internally by both tiers), **`"auto"`** (framework-transparent, no agent involvement), or **`"agentic"`** (agent-facing tools and awareness). This section explains each task, its tier, and the reasoning behind the placement.

### Infrastructure tasks (#1–#4) — already in progress

Tasks #1–#4 (token tracking, message metadata, token estimation, context limit) are foundational plumbing consumed internally by both tiers. They're detailed in the [roadmap](./ROADMAP.md) and not repeated here, but worth noting what they unlock beyond presets:

- **User-side observability.** Token tracking (#1) and context limit (#4) together let users build their own dashboards, alerts, or custom compression triggers without relying on presets at all. `agent.event_loop_metrics.last_known_context_tokens / agent.model.context_limit` gives a live usage percentage.
- **Custom hooks and cost control.** Token estimation (#3) lets users write `BeforeModelCallEvent` hooks that make cost-aware decisions — e.g., "if this request will exceed $0.50, ask for confirmation before sending." This is a stepping stone toward the cost management capabilities identified in the agent harness roadmap: running cost estimates mid-invocation, budget ceilings ("stop if this invocation exceeds $2"), and circuit breakers. The SDK currently has instrumentation (`EventLoopMetrics`) but no control primitives — token estimation combined with hook events bridges that gap, letting users build cost-aware execution policies on top of the same infrastructure that powers context management.
- **Message provenance.** Message metadata (#2) enables features outside context management entirely — audit trails, debugging tools, conversation replay UIs that show which messages were summarized and from what.

### `"auto"` tier tasks

These fire without the agent knowing. Implemented as hooks and conversation managers — zero additional tool-use turns.

**#5 — Large Tool Result Externalization** ([#1296](https://github.com/strands-agents/sdk-python/issues/1296))
- **What it is:** `ContextOffloader` plugin intercepts oversized tool results via `AfterToolCallEvent`, persists the full content to pluggable storage, and replaces the in-context result with a truncated preview and storage-aware references. **Available now** (PR #2162 merged).
- **Tier:** Both
- **Default storage:** Sandbox filesystem. When an agent has a sandbox configured, offloaded content is written to the sandbox's filesystem and references include the file path. The agent can read it back through the sandbox's built-in `read_file` — no additional tools needed, no security escalation. For agents without a sandbox, falls back to `InMemoryStorage` with the retrieval tool as the access path. Users can override with `FileStorage`, `S3Storage`, or any custom `Storage` implementation via `ContextManagementConfig`.

**#6 — Proactive Context Compression** ([#555](https://github.com/strands-agents/sdk-python/issues/555))
- **What it is:** A `BeforeModelCallEvent` hook that monitors context size (via #1/#3/#4) and triggers LLM-based summarization when context exceeds a threshold (e.g., 80% of limit). Older messages are replaced with a compact summary. The agent continues as if nothing happened. **Not yet shipped.**
- **Tier:** `"auto"`
- **Why auto:** Compression is invisible to the agent — old messages become a summary, but the agent doesn't see a "compression happened" notification or get tools to control it. It's a framework-level policy, not an agent capability. The agent didn't ask for compression; the framework decided it was necessary.

**Message Protection & Pinning** ([PR #2196](https://github.com/strands-agents/sdk-python/pull/2196))
- **What it is:** Position-based pinning (`protected_messages=N` on `SlidingWindowConversationManager`) — pins the first N messages so the initial task prompt is never evicted during trimming and overflow recovery. 
- **Tier:** `"auto"` — ships with a sensible default (e.g., `protected_messages=1` to preserve the task prompt).
- **Why auto:** This is a declarative framework policy, not an agent decision. The user sets it once and the conversation manager enforces it silently. More flexible pinning (metadata-based tagging, agent-driven keep/drop decisions via `manage_messages`) belongs in the `"agentic"` tier.

**#7 — In-event-loop Cycle Context Management** ([#298](https://github.com/strands-agents/sdk-python/issues/298))
- **What it is:** Mid-cycle compression triggered via `AfterToolCallEvent` — checks context size after each individual tool execution and compresses if a threshold is exceeded. This is distinct from #6: `BeforeModelCallEvent` only fires once per model call, but the model can request multiple tools in a single turn. All tool results accumulate before the next model call, so without #7, a single cycle requesting 5 heavy tools could overflow context before #6 gets a chance to fire. **Not yet shipped.**
- **Tier:** `"auto"`
- **Why auto:** Same reasoning as #6 — this is framework-level intervention during execution, not an agent-facing capability. The agent doesn't know or care that context was compressed between its 15th and 16th tool call.

### `"agentic"` tier tasks

These give the agent tools and awareness. `"agentic"` includes everything in `"auto"` plus these agent-facing capabilities — each one adds tools the agent can call, meaning additional LLM tool-use turns.

**Metadata-based Message Pinning** ([PR #2196](https://github.com/strands-agents/sdk-python/pull/2196))
- **What it is:** Using the message metadata field (#1532), the agent tags messages as `"pinned": true` and conversation managers skip them during eviction. More flexible than `"auto"`'s position-based pinning — a critical message mid-conversation can be marked as protected. **Not yet shipped** — depends on #1532.
- **Tier:** `"agentic"` only
- **Why not auto:** Requires the agent to decide which messages are important. Position-based pinning (in `"auto"`) is a framework policy; metadata-based pinning is an agent choice.

**manage_messages** (tools [PR #389](https://github.com/strands-agents/tools/pull/389))
- **What it is:** A `manage_messages` tool from `strands-tools` giving the agent turn-aware message history manipulation: list messages, get stats, drop specific turns, compact ranges, clear history, export/import. **Not yet shipped** — optional dependency on `strands-agents-tools`.
- **Tier:** `"agentic"` only
- **Why not auto:** Message manipulation is an agent decision — "I don't need turns 5-15 anymore, drop them." The framework can't know which messages the agent considers irrelevant to its current task. This is the complement to compression: compression is the framework's policy, message management is the agent's choice.

**#11 — Context-Aware Delegation** ([#1681](https://github.com/strands-agents/sdk-python/issues/1681))
- **What it is:** Extends existing `use_agent`/`AgentAsTool` with context awareness. The agent reasons about remaining context budget and decides when to delegate sub-tasks to child agents rather than doing them inline. Controls what context the child inherits. **Not yet shipped.**
- **How it could work:** Expose a `context_budget` tool or system prompt annotation that tells the agent its current usage (e.g., "you've used 140k of 200k tokens"). The agent uses this to decide: "this sub-task will generate heavy output, I should delegate it to a child agent." The child agent gets a filtered subset of the parent's context (task-relevant messages only, not the full history) via a `delegate_with_context` tool that wraps `AgentAsTool` with context slicing. The parent receives a summary of the child's result rather than the full output.
- **Tier:** `"agentic"` only
- **Why not auto:** Delegation is the agent's decision — the framework can't determine task boundaries or decide what context a child needs. This is agent-level planning, not framework policy.

**#12 — Context Navigation Meta-tools** ([#1682](https://github.com/strands-agents/sdk-python/issues/1682))
- **What it is:** Tools to search conversation history, retrieve past interactions, and navigate stored context. The agent actively queries its own history rather than relying on what's in the current window. **Not yet shipped.**
- **How it could work:** Backed by the session snapshot system ([TS reference](https://github.com/strands-agents/sdk-typescript/blob/main/strands-ts/src/session/storage.ts)). The `SessionManager` already captures immutable point-in-time snapshots of the full agent state (messages, app data) with chronological UUIDs. When compression or trimming evicts messages from active context, those messages still exist in prior snapshots. Navigation tools query this existing history rather than building a separate storage layer:
  - `search_history(query)` — iterate snapshots via `listSnapshotIds`, load each, search messages for matches, return snippets with turn numbers
  - `get_turn(n)` — find the snapshot that contains turn N, load it, return that turn
  - A simpler starting point: just expose `get_turn(n)` and let the agent use `manage_messages` import to pull turns back into active context
- **Tier:** `"agentic"` only
- **Why not auto:** Navigation is agent-initiated — "what did we discuss about authentication 30 turns ago?" There's no framework heuristic for when an agent needs to look backward; the agent must decide based on its current task.

**#13 — Tiered Memory (MemGPT-inspired)** ([#1683](https://github.com/strands-agents/sdk-python/issues/1683))
- **What it is:** OS-like virtual memory with three tiers: active context (RAM), recall memory (recent history/swap), archival memory (long-term/disk). The agent pages content between tiers based on relevance. Capstone feature — depends on nearly everything else. **Not yet shipped.**
- **How it could work:** The three tiers map to existing primitives:
  - **Active** = `agent.messages` (current context window)
  - **Recall** = recent session snapshots (the immutable snapshot history from `SessionManager` — messages evicted by compression or trimming are already here)
  - **Archival** = older snapshots or a vector store for semantic search over long-term history
  
  Three tools: `page_out(turns)` moves messages from active to recall (evicts from `agent.messages`, already captured in next snapshot), `page_in(query)` retrieves relevant messages from recall snapshots back into active context, `archive(turns)` explicitly moves messages to long-term archival. A `memory_status` tool shows the agent what's in each tier and how full active context is. The key insight from MemGPT: let the agent manage its own memory rather than imposing framework policies.
  
  The snapshot system means the recall tier is essentially free — it's a side effect of session persistence that already exists.
- **Tier:** `"agentic"` only
- **Why not auto:** No framework heuristic can match an agent's understanding of what's relevant to its current task. The agent decides what to keep in active context, what to page out, and what to recall.

---

## 5. API Design

A new keyword-only `context_management` parameter on `Agent.__init__` accepting `Literal["auto", "agentic"]`, a `ContextManagementConfig` object, or `None`:

```python
agent = Agent(context_management="auto", tools=[...])
```

| Dimension | Assessment |
|-----------|------------|
| Discoverability | High — shows up in `Agent.__init__` signature and IDE autocomplete |
| Simplicity | Highest — one keyword, one string |
| Type safety | Moderate — `Literal["auto", "agentic"]` gives IDE hints, but no compile-time validation beyond that |
| Customization | Via `ContextManagementConfig` object for the same parameter |
| Precedent | Common in Python — `logging.basicConfig(level="DEBUG")`, `json.dumps(indent=2)` |
| Coupling | Adds a parameter to Agent, but resolved early in `__init__` to plugins/tools |

This is syntactic sugar over the plugin system. Under the hood, `"auto"` resolves to the same `ContextOffloader` plugin a user would wire manually. Users who outgrow presets can always drop down to explicit plugin configuration — that escape hatch already exists today. See [Appendix E](#appendix-e-api-alternatives-considered) for other approaches considered and why they were rejected.

---

## 6. Recommended Design

### 6.1 New parameter on `Agent.__init__`

**File:** `sdk-python/src/strands/agent/agent.py` (~line 130)

```python
def __init__(
    self,
    ...,
    *,
    context_management: Literal["auto", "agentic"] | ContextManagementConfig | None = None,
    ...
):
```

Added as keyword-only, alongside existing `plugins`, `hooks`, `tools`. Default is `None` (no preset — current behavior).

### 6.2 New module: `src/strands/agent/context_management.py`

Contains two things:

**`ContextManagementConfig` dataclass** — Fine-grained control for users who want some but not all features:

```python
@dataclass
class ContextManagementConfig:
    """Configuration for context management features.

    Use this instead of "auto"/"agentic" when you need fine-grained control.
    """
    offload_tool_results: bool = True
    include_retrieval_tool: bool = False
    include_manage_messages: bool = False
    storage: Storage | None = None         # default: InMemoryStorage()

    # Future fields (added as features ship):
    # proactive_compression: bool = False
    # compression_threshold: float = 0.8
    # compression_model: str | None = None
    # dynamic_tool_registry: bool = False
```

**`_resolve_context_management()` function** — Internal resolver that turns a preset or config into concrete plugins and tools:

```python
def _resolve_context_management(
    preset: Literal["auto", "agentic"] | ContextManagementConfig | None,
) -> tuple[list[Plugin], list[Any]]:
    """Resolve a context management preset into plugins and tools.

    Returns:
        (plugins, tools) to merge with user-provided plugins and tools.
    """
    if preset is None:
        return [], []

    if isinstance(preset, str):
        config = _PRESETS[preset]
    else:
        config = preset

    plugins: list[Plugin] = []
    tools: list[Any] = []

    if config.offload_tool_results:
        storage = config.storage or InMemoryStorage()
        plugins.append(ContextOffloader(
            storage=storage,
            include_retrieval_tool=config.include_retrieval_tool,
        ))

    if config.include_manage_messages:
        _try_add_manage_messages(tools)

    return plugins, tools


_PRESETS: dict[str, ContextManagementConfig] = {
    "auto": ContextManagementConfig(
        offload_tool_results=True,
        include_retrieval_tool=True,
        include_manage_messages=False,
    ),
    "agentic": ContextManagementConfig(
        offload_tool_results=True,
        include_retrieval_tool=True,
        include_manage_messages=True,
    ),
}
```

**Lazy import for manage_messages** (strands-tools is optional):

```python
def _try_add_manage_messages(tools: list[Any]) -> None:
    try:
        from strands_tools import manage_messages
        tools.append(manage_messages)
    except ImportError:
        import logging
        logging.getLogger(__name__).warning(
            "strands-agents-tools is not installed. "
            "The 'manage_messages' tool will not be available. "
            "Install with: pip install strands-agents-tools"
        )
```

### 6.3 Changes to `Agent.__init__`

Early in the `__init__` body, before plugin/tool registration:

```python
if context_management is not None:
    preset_plugins, preset_tools = _resolve_context_management(context_management)

    # Deduplicate: if user already provided ContextOffloader, skip preset's
    if plugins:
        user_plugin_types = {type(p) for p in plugins}
        preset_plugins = [p for p in preset_plugins
                          if type(p) not in user_plugin_types]

    plugins = preset_plugins + (plugins or [])
    tools = preset_tools + (tools or [])
```

### 6.4 Composition rules

1. **Preset plugins register before user plugins.** User plugins take priority if there's a conflict (e.g., user provides their own `ContextOffloader` with custom storage — preset skips its own).

2. **Preset tools are prepended to user tools.** Additive — the user's tools are never removed.

3. **User `conversation_manager` is never overridden.** Even `"auto"` with future compression support won't replace a user-provided conversation manager. If the user set one, they own it.

4. **`"agentic"` is a superset of `"auto"`.** Everything in `"auto"` is also in `"agentic"`, plus agent-facing tools. Switching from `"auto"` to `"agentic"` is always safe.

### 6.5 Exports

**`src/strands/agent/__init__.py`:**
```python
from .context_management import ContextManagementConfig
```

**`src/strands/__init__.py`:**
```python
from .agent.context_management import ContextManagementConfig
```

---

## 7. Timeline

The two presets ship sequentially: `"auto"` first once its backing features are complete, then `"agentic"` once its additional tools and capabilities land.

### Phase 1: Ship `"auto"`

Complete the `"auto"` tier features, then release the `context_management` parameter with `"auto"` as the first supported value. `"agentic"` is not yet accepted — passing it raises a `ValueError` with a message that it's coming soon.

| Step | Task | Status |
|------|------|--------|
| 1a | #5 Externalization ([#1296](https://github.com/strands-agents/sdk-python/issues/1296)) | **Done** (PR #2162) |
| 1b | Message protection — position pinning ([PR #2196](https://github.com/strands-agents/sdk-python/pull/2196)) | In review |
| 1c | #6 Proactive Compression ([#555](https://github.com/strands-agents/sdk-python/issues/555)) | Not started |
| 1d | #7 In-loop management ([#298](https://github.com/strands-agents/sdk-python/issues/298)) | Blocked by #6 (likely free) |
| **1e** | **Ship `context_management="auto"`** | After 1a–1d |

At this point, `Agent(context_management="auto")` enables externalization (no retrieval) + proactive compression + in-loop management.

### Phase 2: Ship `"agentic"`

Complete the `"agentic"` tier features, then extend the parameter to accept `"agentic"`. Users already on `"auto"` are unaffected.

| Step | Task | Status |
|------|------|--------|
| 2a | manage_messages tool (tools [PR #389](https://github.com/strands-agents/tools/pull/389)) | Not started |
| 2b | #11 Context-Aware Delegation ([#1681](https://github.com/strands-agents/sdk-python/issues/1681)) | Not started |
| 2c | #12 Context Navigation ([#1682](https://github.com/strands-agents/sdk-python/issues/1682)) | Blocked by #11 |
| 2d | #13 Tiered Memory ([#1683](https://github.com/strands-agents/sdk-python/issues/1683)) | Blocked by #11 |
| **2e** | **Ship `context_management="agentic"`** | After 2a–2d |

At this point, `Agent(context_management="agentic")` enables everything in `"auto"` plus retrieval tools, message management, content aliasing, tool discovery, delegation, navigation, and tiered memory.

### Why ship sequentially?

- **`"auto"` has fewer dependencies and most features are already in progress.** Shipping it first gives users immediate value while `"agentic"` features mature.
- **`"agentic"` depends on `"auto"`.** `"agentic"` is a superset — it needs externalization and compression working before adding agent-facing tools on top.
- **Avoids shipping a half-populated `"agentic"`.** If we shipped `"agentic"` today, it would only have externalization + retrieval — barely distinguishable from manually adding `ContextOffloader`. Better to wait until the tier is meaningfully different.

---

## 8. Anticipated Questions

**Q: Why not make `"auto"` the default (instead of `None`)?**

The roadmap states "all features with meaningful cost impact are opt-in." Externalization changes what the agent sees. Even though it's a cost reducer, it modifies behavior. Defaulting to `None` ensures zero surprises for existing users.

**Q: What happens when proactive compression ships?**

`_PRESETS["auto"]` gains a `proactive_compression=True` field. Existing users with `context_management="auto"` get compression automatically on upgrade. This is the whole point of presets — users opt into a *strategy*, not a specific feature set.

**Q: What if the user passes `context_management="auto"` AND `plugins=[ContextOffloader(...)]`?**

The deduplication logic detects the user already provided a `ContextOffloader` and skips the preset's version. The user's configuration wins. This means users can start with `"auto"` and override one component without abandoning the preset entirely.

**Q: Why is `manage_messages` from strands-tools rather than built into the SDK?**

`manage_messages` manipulates `agent.messages` directly, which is a tool concern, not a framework concern. It belongs in the tools package alongside `shell`, `file_read`, etc. Making it a separate package also means the SDK has no hard dependency on strands-tools.

**Q: How does this interact with `conversation_manager`?**

They're orthogonal. `conversation_manager` controls *how messages are managed* (sliding window, summarization, null). Presets control *what additional capabilities are enabled* (externalization, tools). A user can combine `context_management="agentic"` with `conversation_manager=SummarizingConversationManager()`. When compression ships as part of the preset, it would set a conversation manager — but only if the user hasn't already set one.

**Q: Should `"agentic"` include everything in `"auto"` or be independent?**

Superset. An agent that can manage its own context should *also* benefit from framework-level cost reduction. There's no scenario where you'd want agent retrieval tools but *not* want oversized results externalized.

**Q: What about `ContextManagementConfig` — isn't it premature to define future fields?**

Future fields are commented out, not implemented. They serve as documentation of intent. When compression ships, the field becomes real. If the design changes, the comment is just deleted. The cost of a comment is near zero; the benefit is showing the intended evolution path.

**Q: Why not an enum instead of string literals?**

Enums add an import (`from strands import ContextManagement`) for zero practical benefit. The `Literal["auto", "agentic"]` type annotation gives IDE autocomplete and type checking. String literals are simpler and follow Python conventions (`logging.basicConfig(level="DEBUG")`).

---

<details>
<summary><b>Appendix A: Full Code Examples</b></summary>

### Minimal — automatic externalization

```python
from strands import Agent

agent = Agent(
    model="anthropic.claude-sonnet-4-6-v1",
    context_management="auto",
    tools=[shell, file_read],
)
result = agent("List all files in this project and summarize them")
# Oversized tool results are automatically externalized.
# Agent sees truncated previews. No retrieval tool available.
```

### Agent-managed — full autonomy

```python
from strands import Agent

agent = Agent(
    model="anthropic.claude-sonnet-4-6-v1",
    context_management="agentic",
    tools=[shell, file_read],
)
result = agent("Analyze the entire codebase and write a report")
# Oversized results externalized with retrieval tool available.
# Agent can call retrieve_externalized_content to read full output.
# Agent can call manage_messages to drop irrelevant history.
```

### Custom configuration — S3 storage, no message management

```python
from strands import Agent, ContextManagementConfig
from strands.vended_plugins.context_offloader import S3Storage

agent = Agent(
    context_management=ContextManagementConfig(
        offload_tool_results=True,
        include_retrieval_tool=True,
        include_manage_messages=False,
        storage=S3Storage(bucket="my-artifacts"),
    ),
    tools=[shell, file_read],
)
```

### Gradual migration — preset plus manual override

```python
from strands import Agent
from strands.vended_plugins.context_offloader import ContextOffloader, FileStorage

# User wants "agentic" but with FileStorage instead of InMemoryStorage.
# They provide their own ContextOffloader -> preset skips its version.
agent = Agent(
    context_management="agentic",
    plugins=[ContextOffloader(
        storage=FileStorage(base_dir="./artifacts"),
        include_retrieval_tool=True,
    )],
    tools=[shell, file_read],
)
# Result: user's FileStorage-based offloader + manage_messages from preset
```

</details>

---

<details>
<summary><b>Appendix B: Alternatives Considered</b></summary>

### Alt 1: Presets as separate Plugin classes

```python
Agent(plugins=[AutoContextManagement()])
```

**Why rejected:** Lower discoverability. Users have to know the class exists. The whole point of presets is to lower the barrier — a string literal on `Agent()` is lower than a plugin import.

**Why it still works:** Users who prefer this pattern can use `ContextManagementConfig` or wire plugins manually. The escape hatch remains.

### Alt 2: Factory classmethods

```python
Agent.with_auto_context(tools=[...])
```

**Why rejected:** Classmethods must expose the full `Agent.__init__` parameter set (20+ params), which is a maintenance burden. They also suggest "this is a different kind of Agent" rather than "this Agent has context management enabled."

### Alt 3: Three tiers (`"auto"`, `"agentic"`, `"full"`)

A third tier combining everything including delegation and tiered memory.

**Why rejected:** `"agentic"` already includes everything. Adding a third tier implies `"agentic"` is deliberately missing features, which is confusing. Better to keep two clean tiers and let `ContextManagementConfig` handle fine-grained control.

### Alt 4: Boolean flag (`context_management=True`)

```python
Agent(context_management=True)
```

**Why rejected:** `True` doesn't communicate *what kind* of management. As soon as you need two strategies, a boolean doesn't scale. Starting with string literals avoids a breaking change later.

</details>

---

<details>
<summary><b>Appendix C: Composition Edge Cases</b></summary>

### User provides both preset and conversation_manager

```python
Agent(
    context_management="auto",
    conversation_manager=SummarizingConversationManager(),
)
```

**Behavior:** User's conversation manager is used. When compression ships as part of `"auto"`, it would normally set a conversation manager — but the user's explicit one takes priority. This means the user gets externalization (from preset) + summarization (from their CM) but *not* the preset's compression CM.

### User provides overlapping plugins

```python
Agent(
    context_management="agentic",
    plugins=[ContextOffloader(storage=S3Storage(...), include_retrieval_tool=False)],
)
```

**Behavior:** User's `ContextOffloader` wins (dedup by type). The preset's manage_messages tool is still added. Note the user set `include_retrieval_tool=False` even though `"agentic"` normally enables it — user's choice is respected.

### strands-tools not installed

```python
Agent(context_management="agentic")  # strands-tools not in environment
```

**Behavior:** Warning logged. `ContextOffloader` with retrieval tool is still added (it's in the SDK). Only `manage_messages` is skipped since it requires the external package. Agent works fine — just without message management.

</details>

---

<details>
<summary><b>Appendix D: Evolution Over Time</b></summary>

How presets grow as roadmap tasks ship. Each row shows when a feature lands, what changes in the preset definitions, and what users experience.

| When | What ships | `"auto"` gains | `"agentic"` gains | User action required |
|------|-----------|-----------------|--------------------|-----------------------|
| **Now** | ContextOffloader (PR #2162) | Externalization (no retrieval) | Externalization (with retrieval) | None — initial release |
| **Soon** | manage_messages (tools PR #389) | — | manage_messages tool | `pip install strands-agents-tools` (if not already) |
| **P1** | Proactive Compression (#555) | Threshold-based compression | Threshold-based compression | None — preset updates automatically |
| **P1** | In-loop management (#298) | Mid-cycle compression | Mid-cycle compression | None — comes with #555 |
| **P3** | Context navigation (#1682) | — | History search tools | None |
| **P3** | Context-aware delegation (#1681) | — | Budget-aware sub-agent spawning | None |
| **P3** | Tiered memory (#1683) | — | Active/recall/archival paging | None |

**Key property:** Users who set `context_management="auto"` or `"agentic"` today get new capabilities on upgrade without changing their code. This is the primary value proposition of presets over manual wiring.

</details>

---

<details>
<summary><b>Appendix E: API Alternatives Considered</b></summary>

Three other API shapes were evaluated and rejected in favor of the string literal parameter (Section 5).

### Alt 1: Plugin (no new parameter)

```python
from strands.plugins import AutoContextManagement
agent = Agent(plugins=[AutoContextManagement()], tools=[...])
```

| Dimension | Assessment |
|-----------|------------|
| Discoverability | Low — user must know the plugin exists and where to import it |
| Simplicity | Moderate — requires import and instantiation |
| Type safety | High — full class with typed constructor |
| Customization | Natural — constructor kwargs |
| Precedent | How ContextOffloader works today |
| Coupling | Zero coupling to Agent — pure plugin |

**Why rejected:** Lower discoverability. Users have to know the class exists. The whole point of presets is to lower the barrier — a string literal on `Agent()` is lower than a plugin import. Users who prefer this pattern can still wire plugins manually.

### Alt 2: Factory classmethod

```python
agent = Agent.with_auto_context(tools=[...])
# or
agent = Agent.create(context_management="auto", tools=[...])
```

| Dimension | Assessment |
|-----------|------------|
| Discoverability | Moderate — classmethods show in IDE but aren't the "default" constructor |
| Simplicity | Moderate — new API surface, less obvious than constructor param |
| Type safety | High — can have distinct signatures per factory |
| Customization | Awkward — factory must expose all Agent params plus context params |
| Precedent | `datetime.now()`, `dict.fromkeys()` — but those serve different purposes |
| Coupling | Adds methods to Agent class |

**Why rejected:** Classmethods must expose the full `Agent.__init__` parameter set (20+ params), which is a maintenance burden. They also suggest "this is a different kind of Agent" rather than "this Agent has context management enabled."

### Alt 3: Standalone factory function

```python
from strands.agent import create_agent
agent = create_agent("auto", tools=[...])
```

| Dimension | Assessment |
|-----------|------------|
| Discoverability | Lowest — user must know function exists; not on Agent class |
| Simplicity | Moderate |
| Type safety | Moderate |
| Customization | Must duplicate Agent's full parameter set |
| Precedent | `config_to_agent()` in experimental — but that's JSON-config-oriented |
| Coupling | None to Agent class, but new public API |

**Why rejected:** Lowest discoverability of all options. Must duplicate Agent's full parameter set. The existing `config_to_agent()` experimental factory is JSON-config-oriented, not keyword-oriented — a different use case.

</details>

---

<details>
<summary><b>Appendix F: Future Work — Tool Context Management</b></summary>

Two roadmap tasks relate to managing tool *definitions* in context (as opposed to managing conversation history or tool *results*). They're tracked in the roadmap but excluded from the presets for now — they're tool management features, not context management features, and don't compose with the other preset capabilities.

**#8 — Semantic Dynamic Tool Registry** ([#1677](https://github.com/strands-agents/sdk-python/issues/1677))

Dynamically filter which tool definitions are sent to the model based on semantic relevance to the current message. When an agent has 100+ tools, sending all definitions on every request wastes tokens and can confuse the model. The registry would filter before the LLM call (no extra round-trip), and in an agentic mode the agent could also request specific tools to be loaded ("I need a database tool").

**#10 — Autonomous Tool Discovery Meta-tool** ([#1680](https://github.com/strands-agents/sdk-python/issues/1680))

A `load_relevant_tools` meta-tool the agent calls when it needs capabilities beyond its current toolset. Discovers tools from a pre-registered catalog. Each call is an additional tool-use turn.

**Why excluded from presets:** Both are independent of externalization, compression, pinning, and message management. They could be added to the `"agentic"` preset later if they ship, but they don't need to block either preset's release.

</details>
