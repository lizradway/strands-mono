# Context Management Benchmark — Final Results

## Structure

```
final/
├── README.md
├── data/                      # Raw data (deduplicated, verified)
│   ├── phase1-sonnet-5tasks.txt       # Sonnet 4.6: 16 configs × 5 tasks (80 results)
│   ├── phase2-opus-15tasks.txt        # Opus 4.6: 5 configs × 15 tasks (75 results)
│   ├── phase2-opus-hard-5tasks.txt    # Opus 4.6: 3 configs × 5 hard tasks (15 results)
│   ├── phase3-opus-pc085-rerun-20tasks.txt  # Opus 4.6: pc085 replication (20 results)
│   └── results-*.json                 # Per-config JSON output files
├── configs/                   # Benchmark source (TypeScript)
│   ├── configs.ts             # All config definitions
│   ├── types.ts, runner.ts, evaluator.ts, index.ts, reporter.ts, cloudwatch.ts
│   └── contextbench/          # ContextBench loader + trajectory extraction
├── scripts/
│   ├── analyze.py             # Statistical analysis (sign tests, TAR, CIs)
│   └── reproduce.sh           # Reproduce the key comparison
└── results/
    ├── opus-summary.txt       # Opus numbers + statistical tests
    ├── sonnet-summary.txt     # Sonnet numbers
    ├── hard-tasks-opus.txt    # Per-task breakdown on hard tasks
    ├── all-configs-tested.txt # Every config with parameters
    └── tasks.txt              # All 20 tasks with metadata + task string
```

## Analyze

```bash
python scripts/analyze.py
```

## Reproduce

```bash
# Requires: strandly CLI, AWS Bedrock access, pyarrow, tree-sitter-language-pack
./scripts/reproduce.sh
```

## Statistically Significant Findings

```
off1500-p750-summ40-pc085 vs control (Opus 4.6, 20 tasks):
  Sign test (tokens): 15/20 wins, p=0.021
  Sign test (coverage): 7/7 wins on differing tasks, p=0.008
  TAR trimmed mean: 5.2x, 95% CI [2.67, 7.72]
```

## Winning Config

```typescript
new Agent({
  plugins: [new ContextOffloader({ 
    storage: new InMemoryStorage(), 
    maxResultTokens: 1500, 
    previewTokens: 750 
  })],
  conversationManager: new SummarizingConversationManager({ 
    summaryRatio: 0.3,
    proactiveCompression: { compressionThreshold: 0.85 }
  }),
})
```
