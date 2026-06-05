# ContextBench Evaluation: Context Management Strategies

Systematic evaluation of the Strands SDK's context management strategies using [ContextBench](https://github.com/EuniAI/ContextBench) — 20 real GitHub issues with gold-annotated code locations.

## Winner

```typescript
new Agent({
  plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
  conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3 }),
})
```

<details>
<summary><b>Definitions</b></summary>

- **Task:** A real GitHub issue from ContextBench with a problem statement, a cloned repository at a specific commit, and gold annotations (the files/lines that need changing). The agent gets the problem statement, the repo, and a `bash` tool to explore freely.
- **Gold files:** The files in the repository that ContextBench has annotated as needing changes to resolve the issue. Ground truth.
- **Coverage (recall):** Fraction of gold files the agent found. 15 gold files, agent finds 12 = 80% coverage.
- **Control:** SDK default — `SlidingWindowConversationManager(ws=40)`, no offloader or plugins. What `new Agent()` gives you.
- **Config:** A specific combination of context management strategies. E.g., `off1500-p750-summ40` = ContextOffloader(maxResultTokens=1500, previewTokens=750) + SummarizingConversationManager(ratio=0.3).
- **Token savings:** `1 - (config_tokens / control_tokens)`. 54% savings = roughly half the tokens.
- **Offloading:** ContextOffloader plugin replaces large tool results with a truncated preview + a retrieval tool the agent can call to get the full content back.
- **Sliding window:** Drops the oldest messages entirely when conversation exceeds window size.
- **Summarizing:** Replaces the oldest messages with an LLM-generated summary that preserves key information in compressed form.
- **Proactive compression:** Triggers compression before the context window is full, at a configurable threshold (e.g., 0.7 = compress at 70% full). Without it, compression only happens reactively after overflow.
- **TAR:** Token-Accuracy Ratio: `coverage × (control_tokens / config_tokens)`. TAR > 1 = better accuracy per token than control. High variance makes this less reliable than raw coverage or savings.

</details>

## Key Results

### Sonnet 4.6 (5 single-file tasks, all configs saturated at 100% coverage)

No measurable quality difference on these 5 tasks — all configs found the gold file. The differentiation is purely in token cost:

| Config | Avg Tokens | Savings vs Control |
|--------|-----------|-------------------|
| control | 1.66M | — |
| **off1500-p750-summ40 (winner)** | **762K** | **54%** |

Note: Token savings may be skewed by `sphinx-doc__sphinx-9602` (4.7M tokens on control). Median savings across the 5 tasks is 46%.

### Opus 4.6 — Regular Tasks (15 tasks: 5 easy + 10 medium, 1-12 gold files)

| Config | Avg Tokens | Avg Coverage |
|--------|-----------|-------------|
| control | 1.40M | 90% |
| off1500-p750-slwin40 | 1.26M | 92% |
| off1500-p750-summ40 | 1.36M | 92% |

Marginal difference on regular tasks — Opus handles these without hitting context limits.

### Opus 4.6 — Hard Tasks (5 tasks, 15-37 gold files)

| Config | Avg Tokens | Avg Coverage | vs Control |
|--------|-----------|-------------|------------|
| control | 5.47M | 68% | — |
| off1500-p750-slwin40 | 5.02M | 77% | +9 pp |
| **off1500-p750-summ40** | 5.34M | **88%** | **+29% relative (68% → 88%)** |

Context management is critical on hard tasks. Control misses a third of relevant files. Summarizing + offloading recovers most of them.

## Known Limitations

- **Focused-task regression:** On `matplotlib-22719` (single file answer), offloader configs performed worse than control. The offloader truncated the gold file content, causing the agent to re-read or miss relevant spans. A `keepRecent` parameter (never offload the last N tool results) would likely fix this — a sweep over keepRecent values to find the knee in the tradeoff is a natural next step.
- **Statistical significance:** Confidence intervals are wide across all configs. None of the Opus results are statistically significant at p<0.05. The Sonnet winner (off1500-p750-summ40) was the only statistically significant result (95% CI [1.04, 10.97]).
- **Task count:** 20 tasks total. More tasks would tighten confidence intervals.

## Tasks

20 tasks from ContextBench Verified, balanced across difficulty:

| Task ID | Repo | Gold Files | Gold Spans | Difficulty |
|---------|------|-----------|-----------|------------|
| matplotlib__matplotlib-23314 | matplotlib/matplotlib | 1 | 5 | Easy |
| matplotlib__matplotlib-22719 | matplotlib/matplotlib | 1 | 4 | Easy |
| django__django-14539 | django/django | 1 | 2 | Easy |
| sphinx-doc__sphinx-9602 | sphinx-doc/sphinx | 1 | 5 | Easy (but costly — 4.7M tokens on control) |
| django__django-14089 | django/django | 1 | 3 | Easy |
| matplotlib__matplotlib-26342 | matplotlib/matplotlib | 2 | 6 | Medium |
| pydata__xarray-2905 | pydata/xarray | 2 | 4 | Medium |
| django__django-15022 | django/django | 3 | 8 | Medium |
| django__django-13809 | django/django | 3 | 7 | Medium |
| pydata__xarray-4075 | pydata/xarray | 2 | 5 | Medium |
| instance_ansible__ansible-4c5ce... | ansible/ansible | 12 | 38 | Medium-Hard |
| yt-dlp__yt-dlp-5933 | yt-dlp/yt-dlp | 4 | 10 | Medium |
| yt-dlp__yt-dlp-9862 | yt-dlp/yt-dlp | 4 | 9 | Medium |
| django__django-15695 | django/django | 4 | 11 | Medium |
| huggingface__transformers-27663 | huggingface/transformers | 4 | 12 | Medium |
| sveltejs__svelte-14629 | sveltejs/svelte | 15 | 291 | Hard |
| instance_navidrome__navidrome-d8e... | navidrome/navidrome | 16 | 39 | Hard |
| ponylang__ponyc-3962 | ponylang/ponyc | 17 | 24 | Hard |
| nushell__nushell-13357 | nushell/nushell | 19 | 44 | Hard |
| cli__cli-8157 | cli/cli | 37 | 72 | Hard |

**Phase 1 (Sonnet):** Ran the first 5 single-file tasks (all Easy) across 16 configs to select the winner.
**Phase 2 (Opus):** Ran the top 4 configs + control on 15 regular tasks (1-12 gold files), then additionally on 5 hard tasks (15-37 gold files). Total: 20 unique tasks.

## Files

```
contextbench-evaluation/
├── METHODOLOGY.md              # Full methodology, all configs, findings, pitches
├── README.md                   # This file
├── results-phase1/
│   └── phase1-progress.txt     # 16 configs × 5 tasks on Sonnet 4.6 (raw results)
└── results-phase2-opus/
    ├── phase2-progress.txt     # 4 configs × 15 regular tasks on Opus 4.6
    ├── results-opus-control.json
    ├── results-opus-off1500-p750-slwin40.json
    ├── results-opus-off1500-p750-slwin40-remaining.json
    ├── results-opus-off1500-p750-summ40.json
    ├── results-opus-off1500-p750-summ40-pc07.json
    ├── results-opus-off2500-p1500-summ40.json
    ├── results-opus-hard-control.json          # 5 hard tasks (15-37 gold files)
    ├── results-opus-hard-off1500-p750-slwin40.json
    └── results-opus-hard-off1500-p750-summ40.json
```

## How to Reproduce

```bash
# Install strandly CLI
cd sdk-typescript && npm install && npm run build -w strandly && npm link -w strandly

# Install Python deps
pip install pyarrow tree-sitter tree-sitter-language-pack

# Run the winning config on all 20 tasks
AWS_REGION=us-east-1 strandly benchmark --suite contextbench \
  --tasks "matplotlib__matplotlib-23314,matplotlib__matplotlib-22719,django__django-14539,sphinx-doc__sphinx-9602,django__django-14089,matplotlib__matplotlib-26342,pydata__xarray-2905,django__django-15022,django__django-13809,pydata__xarray-4075,instance_ansible__ansible-4c5ce5a1a9e79a845aff4978cfeb72a0d4ecf7d6-v1055803c3a812189a1133297f7f5468579283f86,yt-dlp__yt-dlp-5933,yt-dlp__yt-dlp-9862,django__django-15695,huggingface__transformers-27663,sveltejs__svelte-14629,instance_navidrome__navidrome-d8e794317f788198227e10fb667e10496b3eb99a,ponylang__ponyc-3962,nushell__nushell-13357,cli__cli-8157" \
  --config off1500-p750-summ40 \
  --model us.anthropic.claude-opus-4-6-v1 \
  --output results.json
```

## Methodology

See [METHODOLOGY.md](./METHODOLOGY.md) for full details including:
- All 16 configs tested and why
- Statistical analysis (TAR, confidence intervals)
- Why proactive compression hurts
- Why summarizing beats sliding window
- Why context management helps differently by model tier
- Cost breakdown (~$2,100 total)
