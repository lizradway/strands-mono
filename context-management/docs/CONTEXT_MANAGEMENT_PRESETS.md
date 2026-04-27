# Design: Context Management Presets

- [1. Problem Statement](#1-problem-statement)
- [2. Motivation & Use Case Justification](#2-motivation--use-case-justification)
- [3. Design Philosophy: Two Tiers](#3-design-philosophy-two-tiers)
- [4. Roadmap Task Mapping](#4-roadmap-task-mapping)
- [5. API Design](#5-api-design)
- [6. Recommended Design](#6-recommended-design)
- [7. Implementation Plan](#7-implementation-plan)
- [8. Timeline](#8-timeline)
- [9. Anticipated Questions](#9-anticipated-questions)
- Appendix A: Full Code Examples
- Appendix B: Alternatives Considered
- Appendix C: Composition Edge Cases
- Appendix D: Evolution Over Time
- Appendix E: API Alternatives Considered

---

## 1. Problem Statement

The [context management roadmap](./ROADMAP.md) defines 13 tasks across 3 tracks (conversation, tool, delegation). As these features ship, users face two problems:

**Discovery problem.** A user who just wants "handle context for me" has to know about `ContextOffloader`, `InMemoryStorage`, `include_retrieval_tool`, `SummarizingConversationManager`, `manage_messages`, and how they compose. The SDK surfaces building blocks, not solutions.

**Composition problem.** Features that work well together (externalization + retrieval, compression + message management) require manual wiring. Users must understand which plugins to combine, which tools to add, and which conversation manager to use. Getting this wrong means features silently don't fire.

Today, wiring up externalization alone:

```python
from strands import Agent
from strands.vended_plugins.context_offloader import ContextOffloader, InMemoryStorage

agent = Agent(
    plugins=[ContextOffloader(
        storage=InMemoryStorage(),
        include_retrieval_tool=True,
        token_threshold=10_000,
    )],
    tools=[...],
)
```

This is fine for one feature. But as the roadmap ships — compression, dynamic tool registry, message management, delegation — the boilerplate compounds. Each feature is a separate plugin, tool, or conversation manager that the user must discover, import, configure, and compose correctly.

**The preset system solves both problems with a single parameter.**

---

## 2. Motivation & Use Case Justification

### Who is this for?

**Primary audience: Application developers who want context management to "just work."** They don't want to learn the internals of `AfterToolCallEvent` hooks or `Storage` protocols. They want to say "manage my context" and move on.

**Secondary audience: Advanced users who start with a preset and customize.** They use `"auto"` to get started, then graduate to `ContextManagementConfig` when they need S3 storage or custom thresholds.

### Why not just document the manual wiring?

Three reasons:

1. **Feature count is growing.** The roadmap has 13 tasks. Even if each is individually simple, the combinatorial space of "which ones should I enable together?" is not obvious. Presets encode our recommended combinations.

2. **Defaults change as features ship.** When proactive compression lands, it should be part of `"auto"`. With a preset, existing users get it automatically. Without presets, every user must update their wiring code.

3. **Aligns with Design Principle #1 ("Paved Paths Over Escape Hatches").** The roadmap explicitly states: "The 80% use case should just work out of the box." A preset *is* the paved path. The individual plugins are the escape hatches.

### Prior art in the SDK

The `config_to_agent()` experimental factory (`src/strands/experimental/agent_config.py`) already establishes the pattern of simplified agent construction. Presets extend this idea from "configure model + tools from JSON" to "configure context management from a keyword."

---

## 3. Design Philosophy: Two Tiers

The roadmap's 13 tasks naturally divide into two categories based on *who decides*:

### `"auto"` — The framework decides

Context management happens transparently. The agent doesn't know it's happening. No extra tools are added. The user enables it and forgets about it.

**Characteristics:**
- Zero additional LLM tool-use turns
- No agent-visible changes (no new tools, no retrieval prompts)
- Pure cost reduction or failure prevention
- Hooks and conversation managers do the work silently

**Use case:** Production deployments where you want cost savings and overflow prevention without changing agent behavior. Chatbots, customer service agents, any agent where predictability matters more than autonomy.

### `"agentic"` — The agent decides

The agent is given tools to manage its own context. It can retrieve externalized content, manipulate its message history, discover new tools, and navigate past conversations. The framework provides capabilities; the agent decides when to use them.

**Characteristics:**
- Additional tool-use turns (agent calls management tools)
- Agent-visible changes (new tools appear in its toolset)
- Trades autonomy for additional LLM calls
- Aligns with Design Principle #2 ("Autonomy Over Configuration")

**Use case:** Research agents, coding assistants, long-running autonomous agents — any agent that benefits from self-awareness about its context state.

### Why two and not three?

A third tier (e.g., `"full"` or `"advanced"`) was considered but rejected. The distinction between "framework handles it" and "agent handles it" is clean and covers the design space. Users who want a mix (e.g., auto compression + agentic retrieval) use `ContextManagementConfig`. See [Appendix B](#appendix-b-alternatives-considered) for alternatives considered.

---

## 4. Roadmap Task Mapping

Every task in the [context management roadmap](./ROADMAP.md) fits into exactly one of three categories relative to presets: **infrastructure** (consumed internally by both tiers), **`"auto"`** (framework-transparent, no agent involvement), or **`"agentic"`** (agent-facing tools and awareness). This section explains each task, its tier, and the reasoning behind the placement.

### Infrastructure tasks (#1–#4) — already in progress

Tasks #1–#4 (token tracking, message metadata, token estimation, context limit) are foundational plumbing consumed internally by both tiers. They're detailed in the [roadmap](./ROADMAP.md) and not repeated here, but worth noting what they unlock beyond presets:

- **User-side observability.** Token tracking (#1) and context limit (#4) together let users build their own dashboards, alerts, or custom compression triggers without relying on presets at all. `agent.event_loop_metrics.last_known_context_tokens / agent.model.context_limit` gives a live usage percentage.
- **Custom hooks.** Token estimation (#3) lets users write `BeforeModelCallEvent` hooks that make cost-aware decisions — e.g., "if this request will exceed $0.50, ask for confirmation before sending."
- **Message provenance.** Message metadata (#2) enables features outside context management entirely — audit trails, debugging tools, conversation replay UIs that show which messages were summarized and from what.

### `"auto"` tier tasks

These fire without the agent knowing. Implemented as hooks and conversation managers — zero additional tool-use turns.

**#5 — Large Tool Result Externalization** ([#1296](https://github.com/strands-agents/sdk-python/issues/1296))
- **What it is:** `ContextOffloader` plugin intercepts oversized tool results via `AfterToolCallEvent`, persists the full content to pluggable storage (`InMemoryStorage`, `FileStorage`, `S3Storage`), and replaces the in-context result with a truncated preview. **Available now** (PR #2162 merged).
- **Tier:** `"auto"` (with `include_retrieval_tool=False`)
- **Why auto:** Externalization is a pure cost reducer that requires zero agent involvement. The agent sees a preview — good enough to reason about the result. No new tools, no extra LLM turns. This is the canonical "framework handles it" feature.

**#6 — Proactive Context Compression** ([#555](https://github.com/strands-agents/sdk-python/issues/555))
- **What it is:** A `BeforeModelCallEvent` hook that monitors context size (via #1/#3/#4) and triggers LLM-based summarization when context exceeds a threshold (e.g., 80% of limit). Older messages are replaced with a compact summary. The agent continues as if nothing happened. **Not yet shipped.**
- **Tier:** `"auto"`
- **Why auto:** Compression is invisible to the agent — old messages become a summary, but the agent doesn't see a "compression happened" notification or get tools to control it. It's a framework-level policy, not an agent capability. The agent didn't ask for compression; the framework decided it was necessary.

**#7 — In-event-loop Cycle Context Management** ([#298](https://github.com/strands-agents/sdk-python/issues/298))
- **What it is:** The same compression mechanism as #6, but triggered mid-cycle — between tool calls within a single agent invocation. Prevents a single long execution cycle (e.g., agent calls 20 tools sequentially) from blowing context. **Not yet shipped** — likely free once #6 lands, since `BeforeModelCallEvent` already fires between tool calls.
- **Tier:** `"auto"`
- **Why auto:** Same reasoning as #6 — this is framework-level intervention during execution, not an agent-facing capability. The agent doesn't know or care that context was compressed between its 15th and 16th tool call.

### `"agentic"` tier tasks

These give the agent tools and awareness. `"agentic"` includes everything in `"auto"` plus these agent-facing capabilities — each one adds tools the agent can call, meaning additional LLM tool-use turns.

**#5 — Large Tool Result Externalization & Aliasing** ([#1296](https://github.com/strands-agents/sdk-python/issues/1296), [#1678](https://github.com/strands-agents/sdk-python/issues/1678)) *(upgraded)*
- **What it is:** Same `ContextOffloader` as `"auto"`, but with `include_retrieval_tool=True`. The agent gets a `retrieve_externalized_content` tool with pagination (offset/limit) to read back full content on demand. **Available now.** Content aliasing (#1678) was originally scoped as a separate task for non-tool content (documents, images), but in practice nearly all large content enters through tool results. The retrieval tool on `ContextOffloader` already covers this — #1678 is folded into #5 rather than tracked separately.
- **Tier:** `"agentic"` (upgraded from `"auto"`)
- **Why agentic:** The retrieval tool is an agent-facing capability. The agent *chooses* when to read the full content and how much to pull in. This is autonomy — the framework externalized the content, but the agent decides what to do about it.

**#8 — Semantic Dynamic Tool Registry** ([#1677](https://github.com/strands-agents/sdk-python/issues/1677))
- **What it is:** Dynamically filter which tool definitions are sent to the model based on semantic relevance to the current message. Lives in the SDK's tool registry — filtering happens before the LLM call, no extra round-trip. **Not yet shipped.**
- **Tier:** `"agentic"` only
- **Why not auto:** While the filtering itself is framework-level, in `"agentic"` mode the agent can also *request* specific tools to be loaded — "I need a database tool." This agent-initiated loading is what makes it agentic. A future version could add the passive filtering component to `"auto"`, but the active loading part is inherently agent-driven.

**#10 — Autonomous Tool Discovery Meta-tool** ([#1680](https://github.com/strands-agents/sdk-python/issues/1680))
- **What it is:** A `load_relevant_tools` meta-tool the agent calls when it needs capabilities beyond its current toolset. Discovers tools from a pre-registered catalog. Each call is an additional tool-use turn. **Not yet shipped.**
- **Tier:** `"agentic"` only
- **Why not auto:** This is the agent saying "I need more tools" — pure autonomy. There's no framework heuristic that can decide what tools the agent needs mid-task; only the agent knows.

**manage_messages** (tools [PR #389](https://github.com/strands-agents/tools/pull/389))
- **What it is:** A `manage_messages` tool from `strands-tools` giving the agent turn-aware message history manipulation: list messages, get stats, drop specific turns, compact ranges, clear history, export/import. **Not yet shipped** — optional dependency on `strands-agents-tools`.
- **Tier:** `"agentic"` only
- **Why not auto:** Message manipulation is an agent decision — "I don't need turns 5-15 anymore, drop them." The framework can't know which messages the agent considers irrelevant to its current task. This is the complement to compression: compression is the framework's policy, message management is the agent's choice.

**#11 — Context-Aware Delegation** ([#1681](https://github.com/strands-agents/sdk-python/issues/1681))
- **What it is:** Extends existing `use_agent`/`AgentAsTool` with context awareness. The agent reasons about remaining context budget and decides when to delegate sub-tasks to child agents rather than doing them inline. Controls what context the child inherits. **Not yet shipped.**
- **Tier:** `"agentic"` only
- **Why not auto:** Delegation is the agent's decision: "this sub-task will generate heavy output, I should delegate it." The framework can't determine task boundaries or decide what context a child needs. This is agent-level planning, not framework policy.

**#12 — Context Navigation Meta-tools** ([#1682](https://github.com/strands-agents/sdk-python/issues/1682))
- **What it is:** Tools to search conversation history, retrieve past interactions, and navigate stored context. The agent actively queries its own history rather than relying on what's in the current window. **Not yet shipped.**
- **Tier:** `"agentic"` only
- **Why not auto:** Navigation is agent-initiated — "what did we discuss about authentication 30 turns ago?" There's no framework heuristic for when an agent needs to look backward; the agent must decide based on its current task.

**#13 — Tiered Memory (MemGPT-inspired)** ([#1683](https://github.com/strands-agents/sdk-python/issues/1683))
- **What it is:** OS-like virtual memory with three tiers: active context (RAM), recall memory (recent history/swap), archival memory (long-term/disk). The agent pages content between tiers based on relevance. Capstone feature — depends on nearly everything else. **Not yet shipped.**
- **Tier:** `"agentic"` only
- **Why not auto:** Tiered memory is the ultimate expression of agent autonomy — the agent decides what to keep in active context, what to page out, and what to recall. This is MemGPT's core insight: let the agent manage its own memory rather than imposing framework policies. No framework heuristic can match an agent's understanding of what's relevant to its current task.

### Summary matrix

| Task | `"auto"` | `"agentic"` | Tier rationale |
|------|----------|-------------|----------------|
| #5 Externalization & aliasing | **yes** (no retrieval) | **yes** (with retrieval) | Auto: transparent cost reduction. Agentic: adds retrieval tool. |
| #6 Compression | **yes** | **yes** | Framework policy — agent doesn't know it happened |
| #7 In-loop management | **yes** | **yes** | Extension of #6 — same framework-level trigger |
| #8 Dynamic tool registry | no | **yes** | Agent requests tool loading — can't be automated |
| #10 Tool discovery | no | **yes** | Agent says "I need more tools" |
| #11 Context-aware delegation | no | **yes** | Agent decides task boundaries and child context |
| #12 Context navigation | no | **yes** | Agent queries its own history |
| #13 Tiered memory | no | **yes** | Agent manages its own memory pages |
| manage_messages | no | **yes** | Agent decides which messages to keep/drop |

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
        include_retrieval_tool=False,
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

## 7. Implementation Plan

### Files to create

| File | Contents |
|------|----------|
| `src/strands/agent/context_management.py` | `ContextManagementConfig`, `_resolve_context_management()`, `_PRESETS`, `_try_add_manage_messages()` |

### Files to modify

| File | Change |
|------|--------|
| `src/strands/agent/agent.py` (~line 130) | Add `context_management` parameter to `__init__`, call `_resolve_context_management()` early in body |
| `src/strands/agent/__init__.py` | Export `ContextManagementConfig` |
| `src/strands/__init__.py` | Export `ContextManagementConfig` |

### Tests to write

| Test | What it validates |
|------|-------------------|
| `test_resolve_auto` | `"auto"` resolves to ContextOffloader with `include_retrieval_tool=False`, no extra tools |
| `test_resolve_agentic` | `"agentic"` resolves to ContextOffloader with `include_retrieval_tool=True` + manage_messages (if installed) |
| `test_resolve_none` | `None` returns empty plugins and tools (no change to existing behavior) |
| `test_resolve_config` | Custom `ContextManagementConfig` maps correctly |
| `test_custom_storage` | `ContextManagementConfig(storage=FileStorage(...))` passes through to ContextOffloader |
| `test_dedup_user_offloader` | User provides ContextOffloader in plugins list — preset skips its own |
| `test_user_tools_preserved` | User tools are not removed or reordered beyond prepending |
| `test_user_conversation_manager_untouched` | `conversation_manager=` kwarg is not overridden by any preset |
| `test_manage_messages_missing` | If strands-tools not installed — warning logged, agent still works |
| `test_agentic_superset_of_auto` | All features in "auto" are also present in "agentic" |
| `test_agent_init_with_preset` | `Agent(context_management="auto")` initializes without error |
| `test_invalid_preset` | `Agent(context_management="invalid")` raises ValueError |

### Dependencies

- `ContextOffloader` must be importable from `strands.vended_plugins.context_offloader` (PR #2162 — merged)
- `manage_messages` from `strands_tools` is optional — lazy import with graceful fallback
- No dependency on proactive compression — presets gain it when it ships

---

## 8. Timeline

The two presets ship sequentially: `"auto"` first once its backing features are complete, then `"agentic"` once its additional tools and capabilities land.

### Phase 1: Ship `"auto"`

Complete the `"auto"` tier features, then release the `context_management` parameter with `"auto"` as the first supported value. `"agentic"` is not yet accepted — passing it raises a `ValueError` with a message that it's coming soon.

| Step | Task | Status |
|------|------|--------|
| 1a | #5 Externalization ([#1296](https://github.com/strands-agents/sdk-python/issues/1296)) | **Done** (PR #2162) |
| 1b | #6 Proactive Compression ([#555](https://github.com/strands-agents/sdk-python/issues/555)) | Not started |
| 1c | #7 In-loop management ([#298](https://github.com/strands-agents/sdk-python/issues/298)) | Blocked by #6 (likely free) |
| **1d** | **Ship `context_management="auto"`** | After 1a–1c |

At this point, `Agent(context_management="auto")` enables externalization (no retrieval) + proactive compression + in-loop management.

### Phase 2: Ship `"agentic"`

Complete the `"agentic"` tier features, then extend the parameter to accept `"agentic"`. Users already on `"auto"` are unaffected.

| Step | Task | Status |
|------|------|--------|
| 2a | manage_messages tool (tools [PR #389](https://github.com/strands-agents/tools/pull/389)) | Not started |
| 2b | #8 Dynamic Tool Registry ([#1677](https://github.com/strands-agents/sdk-python/issues/1677)) | Not started |
| 2c | #10 Tool Discovery Meta-tool ([#1680](https://github.com/strands-agents/sdk-python/issues/1680)) | Blocked by #8 |
| 2d | #11 Context-Aware Delegation ([#1681](https://github.com/strands-agents/sdk-python/issues/1681)) | Not started |
| 2e | #12 Context Navigation ([#1682](https://github.com/strands-agents/sdk-python/issues/1682)) | Blocked by #11 |
| 2f | #13 Tiered Memory ([#1683](https://github.com/strands-agents/sdk-python/issues/1683)) | Blocked by #11 |
| **2g** | **Ship `context_management="agentic"`** | After 2a–2f |

At this point, `Agent(context_management="agentic")` enables everything in `"auto"` plus retrieval tools, message management, content aliasing, tool discovery, delegation, navigation, and tiered memory.

### Why ship sequentially?

- **`"auto"` has fewer dependencies and most features are already in progress.** Shipping it first gives users immediate value while `"agentic"` features mature.
- **`"agentic"` depends on `"auto"`.** `"agentic"` is a superset — it needs externalization and compression working before adding agent-facing tools on top.
- **Avoids shipping a half-populated `"agentic"`.** If we shipped `"agentic"` today, it would only have externalization + retrieval — barely distinguishable from manually adding `ContextOffloader`. Better to wait until the tier is meaningfully different.

---

## 9. Anticipated Questions

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
| **P2** | Dynamic tool registry (#1677) | — | Framework-filtered tool definitions | None |
| **P3** | Tool discovery (#1680) | — | `load_relevant_tools` meta-tool | None |
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
