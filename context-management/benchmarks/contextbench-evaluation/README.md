# ContextBench Evaluation: Context Management Strategies

Systematic evaluation of the Strands SDK's context management strategies using [ContextBench](https://github.com/EuniAI/ContextBench) — 20 real GitHub issues with gold-annotated code locations.

## Winner

```typescript
new Agent({
  plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
  conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3 }),
})
```

## Key Results

| Model | Task Difficulty | Control Coverage | Winner Coverage | Token Savings |
|-------|----------------|-----------------|----------------|---------------|
| Sonnet 4.6 | Mixed (5 tasks) | 100% | 100% | **54%** |
| Opus 4.6 | Easy (15 tasks) | 90% | 92% | +3% |
| Opus 4.6 | **Hard (15-37 gold files)** | **68%** | **88%** | +2% |

- On **Sonnet**: same quality, half the cost
- On **Opus**: same cost, finds 20% more relevant code on complex tasks

## Files

```
contextbench-evaluation/
├── METHODOLOGY.md              # Full methodology, all configs, findings, pitches
├── README.md                   # This file
├── results-phase1/
│   └── phase1-progress.txt     # 16 configs × 5 tasks on Sonnet 4.6 (raw results)
└── results-phase2-opus/
    ├── phase2-progress.txt     # 4 configs × 15 tasks on Opus 4.6 (raw results)
    ├── results-opus-control.json
    ├── results-opus-off1500-p750-slwin40.json
    ├── results-opus-off1500-p750-slwin40-remaining.json
    ├── results-opus-off1500-p750-summ40.json
    ├── results-opus-off1500-p750-summ40-pc07.json
    ├── results-opus-off2500-p1500-summ40.json
    ├── results-opus-hard-control.json
    ├── results-opus-hard-off1500-p750-slwin40.json
    └── results-opus-hard-off1500-p750-summ40.json
```

## How to Reproduce

```bash
# Install strandly CLI
cd sdk-typescript && npm install && npm run build -w strandly && npm link -w strandly

# Install Python deps
pip install pyarrow tree-sitter tree-sitter-language-pack

# Run the winning config on hard tasks
AWS_REGION=us-east-1 strandly benchmark --suite contextbench \
  --tasks "sveltejs__svelte-14629,instance_navidrome__navidrome-d8e794317f788198227e10fb667e10496b3eb99a,ponylang__ponyc-3962,nushell__nushell-13357,cli__cli-8157" \
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
