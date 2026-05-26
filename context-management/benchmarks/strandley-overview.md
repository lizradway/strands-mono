# Strandley Overview

## What This Does

`strandly benchmark` runs a Strands agent against [ContextBench](https://github.com/EuniAI/ContextBench) tasks — real GitHub issues with gold-annotated code locations — and measures how effectively the agent finds relevant code under different context management strategies.

## What We Can Learn

- **Does context management help?** Prior evaluation (66 configs on `huggingface/transformers-13693`) showed ContextOffloader + SlidingWindow achieves 2.4x better accuracy-per-token than no management, with 65% token savings and 100% span coverage retained.
- **Which strategy wins?** Offloader + SlidingWindow > SlidingWindow alone > Summarizing > Offloading alone.
- **Where do we stand?** On hard tasks (9 gold files), the control config only finds 11-22% of relevant files. That gap is where context management improvements show measurable gains.

## What We Cannot Learn (Limitations)

- **Single-run reliability** — LLM non-determinism means the same config produces 11% one run and 22% the next. Single runs don't prove anything; trends over multiple runs do.
- **Easy task differentiation** — The default task (`django__django-15987`, 1 gold file) doesn't stress context management. The agent finds it before hitting limits. Use `huggingface/transformers-13693` for meaningful strategy comparisons.
- **Complete trajectory capture** — We parse bash commands to infer which files the agent read. Piped commands, `find -exec`, and indirect reads are missed. Coverage scores are likely understated.
- **End-to-end correctness** — ContextBench measures code *location*, not whether the agent can generate a correct *fix*. SWE-bench would be needed for that.

## Path Forward

1. **Run all 6 configs on the hard task** (`huggingface/transformers-13693`) to reproduce the prior 66-config findings with the formalized harness.
2. **Add TAR (Token-Accuracy Ratio)** as a computed metric — this is the single best number for comparing strategies.
3. **Establish cadence** — quick smoke tests per-PR (django, 1 config, ~7 min, ~$0.30), deep evaluations weekly (transformers, all configs, ~1 hour, ~$5).
4. **Add SWE-bench Verified** as a second suite — tests whether context management preserves enough information to generate correct patches, not just find the right files.
5. **Add RULER** as a third suite — synthetic needle-in-haystack tasks that directly test context retention under compression, cheap and fast to run.
6. **Update configs** once preset context management strategies are finalized — the current 6 configs are placeholders based on prior findings.

---

## Appendix: Cost & Model Tradeoffs

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

Tests all combinations of offloading thresholds, compression ratios, window sizes, and proactive compression settings — the same matrix used in the prior notebook evaluation.

| Task | gpt-4.1-mini | Claude Sonnet 4 | Claude Opus 4.7 |
|------|-------------|-----------------|-----------------|
| `django__django-15987` | ~$20 | ~$130 | ~$1,000 |
| `huggingface/transformers-13693` | ~$35 | ~$260 | ~$1,300 |
| Both tasks, all configs | ~$55 | ~$390 | ~$2,300 |

This is why the prior evaluation used `gpt-4.1-mini` — $35 for the full 66-config sweep vs $2,300 on Opus. The signal is the same (relative strategy differences hold across models), but at 60x less cost.

### Which Model to Use

| Goal | Recommended Model | Rationale |
|------|-------------------|-----------|
| **Compare context management strategies** | `gpt-4.1-mini` | Cheap, fast, prior data exists for comparison. Weaker model is more sensitive to context limits — makes strategy differences more visible. |
| **Ceiling reference** | `claude-opus-4-7` | Shows the best achievable score when the model is strong enough to overcome poor context management. Run once to calibrate expectations. |
| **CI smoke test** | `gpt-4.1-mini` | Fastest, cheapest. Validates nothing is broken. |
| **Production-representative** | `claude-sonnet-4-6` | Matches what most users actually deploy. Results reflect real-world performance. |

### Why Not Always Use the Best Model?

The benchmark tests **SDK context management**, not model capability. Using a stronger model:
- Costs 30-60x more per run
- May find files in fewer cycles, reducing the signal from context management (if the model solves it in 5 cycles, context limits never trigger)
- Makes the benchmark measure "how good is the model" instead of "how good is the SDK strategy"

A weaker model that needs 40+ cycles to explore a repo is *more useful* for benchmarking — it guarantees context limits are hit, which is the exact condition where strategy differences emerge.

**Recommendation:** Use `gpt-4.1-mini` for all strategy comparisons. Run the best model (Opus) once per quarter as a ceiling reference.
