# Context-manager knob sweep on Harbor

Agent factories for Harbor's `strands-custom` harness: one class per arm in `agent.py`, each
Harbor's strandsharness agent with a different `context_manager=`. Runs on the default SDK
(`strands-agents` 1.61.1), so no `strands_version` is needed.

`agent_source`: `{"repo": "lizradway/strands-mono", "sha": "<sha>", "path": "context-management/benchmarks/harbor-knob-sweep", "module": "agent:<Class>"}`

| module | pipeline (before the emergency truncate every arm ends with) |
|---|---|
| `agent:AutoAgent` | `"auto"`: truncate(tool_results) >1500 → 750 preview; summarize(*) at util 0.85, keep 4 |
| `agent:AutoRepAgent` | same as auto, for the noise floor |
| `agent:U1Agent` | auto truncate; summarize(*) at util 0.08 (~80K), keep 4 |
| `agent:U2Agent` | auto truncate; summarize(*) at util 0.04 (~40K), keep 4 |
| `agent:U3Agent` | auto truncate; summarize(*) at util 0.04, keep 12 |
| `agent:U5Agent` | auto truncate; truncate(*) at util 0.04, keep 4 |
| `agent:T1Agent` | truncate(tool_results) >750 → 375 preview; auto summarize |
| `agent:T2Agent` | truncate(tool_results) >3000 → 750 preview; auto summarize |
| `agent:A1Agent` | auto truncate; drop(tool_result_errors) keep newest 2; auto summarize |
| `agent:A2Agent` | auto truncate; truncate(tool_results) >300 → 150 preview, keep newest 12; auto summarize |
| `agent:A3Agent` | auto truncate; truncate(assistant_text) >400 → 200 preview, keep newest 4; auto summarize |
| `agent:A4Agent` | auto truncate; truncate(tool_result_errors) >200 → 100 preview, keep newest 2; auto summarize |
| `agent:A5Agent` | summarize(tool_results) >4000 first; then auto truncate; auto summarize |
| `agent:A6Agent` | auto truncate; drop(tool_results) keep newest 30; auto summarize |

Every arm runs without `web_fetch` and is instructed not to look up the upstream fix (commits
from this one on; `c857ed7` has both). The shell keeps network access for build dependencies.

Utilization assumes Sonnet 4.6's 1M window; at that size auto's 0.85 summarize never fires on ContextBench.
