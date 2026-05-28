# Strandley Overview

## What This Does

`strandly benchmark` runs a Strands agent against [ContextBench](https://github.com/EuniAI/ContextBench) tasks — real GitHub issues with gold-annotated code locations — and measures how effectively the agent finds relevant code under different context management strategies.

The bare-bones version runs by default on OpenAI `gpt-4.1-mini` on an easier golden-path dataset to keep compute costs low enough for regression test CI. For new feature releases or canary builds, we'd run on the state-of-the-art model (e.g., Opus 4.7) against a thorough multi-golden-path dataset — far more expensive, but necessary for high-confidence results.

---

## What We Can Learn

- **Does context management save tokens?** Yes. `SlidingWindow ws=40 proactive` saves 26% vs no management with 100% file recall on ContextBench tasks.
- **Which compression strategy wins for coding agents?** Sliding window > Summarizing. Sliding window is cheaper (no extra LLM call) and equally accurate on file-navigation tasks.
- **Does the ContextOffloader plugin help for file-based tools?** No. It increases token usage by 20-130% because the agent can already re-read files cheaply — the retrieval tool adds cycles without value.
- **What are the optimal thresholds?** `windowSize=40`, `proactiveCompression=true`. These were validated by TAR (Token-Accuracy Ratio) analysis across 32 configurations.
- **Relative strategy ranking** — Token-only and accuracy-aware (TAR) rankings agree on this benchmark, confirming the chosen defaults don't trade quality for cost.

## What We Cannot Learn

### The benchmark is coding-only and file-based

ContextBench tests GitHub issue resolution where all tool results come from reading files. This creates a structural bias:

- **Offloading appears harmful** — but only because file content is re-fetchable for free. For agents calling APIs, running commands, or querying databases (where results are non-reproducible), the offloader is the only way to access prior results after compression. We can't measure that value here.
- **Sliding window appears sufficient** — but only because these tasks don't require remembering decisions from 20+ turns ago. In long planning sessions or multi-step debugging, sliding window would lose critical state that summarizing would preserve.
- **Short sessions only** — ContextBench tasks resolve in 4 turns / ~40 cycles. Context limits barely trigger. Longer sessions would stress the strategies differently.

### Missing coverage

| What We Can't Test | Why It Matters | What Would Test It |
|---|---|---|
| Non-reproducible tool results (APIs, DBs, commands) | The offloader's retrieval tool only helps when you can't re-call the source tool | AgentBench (THUDM) — database + OS environments |
| Long-horizon memory (20+ turns) | Summarizing should beat sliding window here, but we can't confirm | Letta Filesystem Suite — multi-hop entity chains |
| Multi-step planning | Agent must follow a plan built earlier; sliding window would drop it | TravelPlanner (ICML'24) |
| Non-coding domains | Research, data analysis, customer workflows have different patterns | No good open benchmark exists |

### Implication for defaults

Our recommended defaults are validated for **coding agents with file-system tools in sessions under ~20 turns**. They are likely not optimal for:

- Agents with non-reproducible tool outputs (the offloader + retrieval tool would help)
- Very long sessions where early context carries critical state (summarizing would help)
- Non-coding domains (unknown — no data)

---

## Appendix A: Path Forward

1. **Run all 6 configs on the hard task** (`huggingface/transformers-13693`) to reproduce the prior 66-config findings with the formalized harness.
2. **Add TAR (Token-Accuracy Ratio)** as a computed metric — this is the single best number for comparing strategies.
3. **Establish cadence** — quick smoke tests per-PR (django, 1 config, ~7 min, ~$0.30), deep evaluations weekly (transformers, all configs, ~1 hour, ~$5).
4. **Add SWE-bench Verified** as a second suite — tests whether context management preserves enough information to generate correct patches, not just find the right files.
5. **Add Letta Filesystem Suite** — multi-hop questions over linked data files. Tests memory retention (where summarizing should win). Runner built, not yet benchmarked.
6. **Add AgentBench** — database + OS tasks with non-reproducible outputs. Would validate the offloader's retrieval tool on its intended use case.
7. **Update configs** once preset context management strategies are finalized — the current configs are based on prior findings.

## Appendix B: Cost & Model Tradeoffs

### Cost Per Task

| Task | Gold Files | Complexity | Tokens (control) | Cycles | Time | Cost (gpt-4.1-mini) | Cost (Sonnet 4) | Cost (Opus 4.7) |
|------|-----------|-----------|-----------------|--------|------|---------------------|-----------------|-----------------|
| `django__django-15987` | 1 | Easy | ~1.0M | ~42 | ~7 min | ~$0.30 | ~$2 | ~$15 |
| `astropy__astropy-13398` | 9 | Hard | ~1.8M | ~35 | ~8 min | ~$0.70 | ~$5 | ~$25 |
| `huggingface/transformers-13693` | Multi | Hard | ~1.2M | ~80 | ~10 min | ~$0.50 | ~$4 | ~$20 |

### Cost for Default Configurations (6 configs)

| Task | gpt-4.1-mini | Claude Sonnet 4 | Claude Opus 4.7 |
|------|-------------|-----------------|-----------------|
| `django__django-15987` | ~$2 | ~$12 | ~$90 |
| `huggingface/transformers-13693` | ~$3 | ~$24 | ~$120 |
| Both tasks, all configs | ~$5 | ~$36 | ~$210 |

### Cost for Full Threshold Evaluation (~66 configs)

| Task | gpt-4.1-mini | Claude Sonnet 4 | Claude Opus 4.7 |
|------|-------------|-----------------|-----------------|
| `django__django-15987` | ~$20 | ~$130 | ~$1,000 |
| `huggingface/transformers-13693` | ~$35 | ~$260 | ~$1,300 |
| Both tasks, all configs | ~$55 | ~$390 | ~$2,300 |

### Which Model to Use

| Goal | Recommended Model | Rationale |
|------|-------------------|-----------|
| **Compare context management strategies** | `gpt-4.1-mini` | Cheap, fast, prior data exists. Weaker model is more sensitive to context limits — makes strategy differences more visible. |
| **Ceiling reference** | `claude-opus-4-7` | Shows best achievable score. Run once to calibrate expectations. |
| **CI smoke test** | `gpt-4.1-mini` | Fastest, cheapest. Validates nothing is broken. |
| **Production-representative** | `claude-sonnet-4-6` | Matches what most users deploy. |

### Why Not Always Use the Best Model?

The benchmark tests **SDK context management**, not model capability. A weaker model that needs 40+ cycles to explore a repo is *more useful* for benchmarking — it guarantees context limits are hit, which is the exact condition where strategy differences emerge. A stronger model may solve tasks in 5 cycles before any compression triggers, making all strategies look identical.

**Recommendation:** Use `gpt-4.1-mini` for all strategy comparisons. Run Opus once per quarter as a ceiling reference.
