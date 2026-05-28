# Intern Project Brief: Agent Recipes & Cookbook

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK (strands-agents/sdk-typescript), published recipes package, internal team deployment  
**Prerequisites:** Familiarity with TypeScript, LLM APIs, experience using AI coding assistants  
**Difficulty:** Applied engineering, medium complexity, high breadth

---

## 1. Problem Statement

The Strands SDK ships powerful primitives — interventions for HITL, validation loops (Ralph loop), structured output, concurrent tool execution, context management, plugins, hooks. The Harness design proposal (Meral, 2026) adds opinionated agent types (`CodingAgent`, `ChatAgent`, `AutonomousAgent`) as composed defaults on top of those primitives.

But between "here are the primitives" and "here's a production agent" lies a gap that neither the SDK nor the opinionated types fill: **How do you compose these primitives into agents that solve real workflows?**

Other frameworks fill this gap with a recipes/cookbook layer:
- **LangChain** ships `create_sql_agent`, `create_csv_agent`, toolkit factories — narrow agents built from composable toolkits
- **Vercel AI SDK** publishes templates — full reference implementations for common patterns
- **Mastra** ships recipes — step-by-step compositions for specific use cases
- **CrewAI** publishes community agents — role-configured agents for specific domains

Strands needs this layer. The opinionated types define *execution modes* (how an agent runs). Recipes define *workflows* (what an agent does). The combination is what makes a framework feel complete.

This project builds a published recipes package (`@strands-agents/recipes` or `examples/recipes/`) containing polished, documented workflow agents — and deploys 3-4 of them into the Strands team's actual processes to validate they work in practice.

---

## 2. Background

### 2.1 The Harness Architecture

The Harness design proposal defines three opinionated agent types as execution modes:

| Type | Execution mode | Key defaults |
|------|---------------|-------------|
| `CodingAgent` | Interactive coding with human oversight | shell + editor, HITL on destructive ops, aggressive compression |
| `ChatAgent` | Conversational with tool confirmation | User-provided tools, HITL on all tool calls, conversation-focused context |
| `AutonomousAgent` | Unattended with bounds | No HITL, max turns/timeout, validation loop |

These types define *how* an agent runs. They're the base layer recipes compose on top of.

### 2.2 Where Recipes Fit

```
SDK Primitives (existing):
├── Interventions (HITL approval, escalation policies)
├── Validation loops (Ralph loop — run → check → fix → repeat)
├── Structured output
├── Concurrent tool execution
├── Context management strategies
├── Hooks and plugins
└── Tool registration

Opinionated Types (sprint team ships these):
├── CodingAgent    ← execution mode: interactive + sandbox
├── ChatAgent      ← execution mode: conversational + confirmation
└── AutonomousAgent ← execution mode: unattended + bounded

Recipes (this project):
├── code-review        ← workflow: analyze PRs, surface issues
├── design-sparring    ← workflow: Socratic review of design docs
├── regression-detective ← workflow: diagnose CI failures, suggest fixes
├── issue-triage       ← workflow: classify, dedupe, route issues
├── changelog-writer   ← workflow: generate release notes from diffs
└── ...
```

Recipes are:
- **Published** — in the SDK repo as `examples/recipes/` or a separate `@strands-agents/recipes` package
- **Documented** — each recipe has a README explaining what it does, how to configure it, how to extend it
- **Runnable** — copy-paste a recipe, point it at your repo, it works
- **Composable** — recipes extend opinionated types and can be further customized
- **Team-deployed** — at least 3-4 recipes are deployed into Strands team workflows as dogfooding

### 2.3 Prior Art: How Other Frameworks Ship Recipes

**LangChain Toolkits + Agent Factories:**
```python
from langchain.agents import create_sql_agent
from langchain_community.agent_toolkits import SQLDatabaseToolkit

toolkit = SQLDatabaseToolkit(db=db, llm=llm)
agent = create_sql_agent(llm, toolkit=toolkit)
```
Pattern: toolkit (reusable tool bundle) + factory (wires toolkit into agent with good defaults). The toolkit is the SDK contribution; the factory is the recipe.

**Vercel AI SDK Templates:**
Full project templates with README, runnable code, deployment instructions. Each demonstrates a specific pattern (chat with RAG, tool-calling agent, multi-step workflow).

**CrewAI Community:**
Role-configured agents published as reusable components. Each agent has a role, goal, backstory (system prompt), and tool set. Composable into multi-agent crews.

---

## 3. Project Goals

### Primary Goal
Build and publish a recipes package containing 6-8 polished workflow agents that demonstrate how to compose Strands primitives into real solutions. Deploy 3-4 of them into Strands team workflows as dogfooding.

### Success Criteria
1. Published recipes package with 6-8 documented, runnable workflow agents
2. 3-4 recipes deployed into actual team workflows (code review, design discussion, triage, etc.)
3. Each recipe demonstrates a distinct composition pattern (interventions, validation loops, structured output, concurrent execution, etc.)
4. Team adoption metrics — are people actually using the deployed agents? What's the feedback?
5. Developer experience report — friction encountered composing primitives, recommendations for the harness API
6. Documentation: cookbook-style guide showing how to build custom workflow agents

---

## 4. Technical Design

### 4.1 Recipe Structure

Each recipe follows a standard structure:

```
recipes/
├── code-review/
│   ├── README.md           # What it does, how to use, how to extend
│   ├── index.ts            # The agent implementation
│   ├── prompts.ts          # System prompt(s)
│   ├── tools.ts            # Custom/bundled tools (if any)
│   ├── config.example.yaml # Example configuration
│   └── tests/              # Integration tests
├── design-sparring/
│   └── ...
├── regression-detective/
│   └── ...
└── shared/
    ├── toolkits/           # Reusable tool bundles
    │   ├── github.ts       # PR, issue, discussion tools
    │   ├── codebase.ts     # grep, read, glob, AST tools
    │   └── ci.ts           # test runner, build, lint tools
    └── patterns/           # Composition utilities
        └── ...
```

### 4.2 Recipe Implementation Pattern

Each recipe extends an opinionated type (or base `Agent`) with workflow-specific configuration:

```typescript
import { Agent, CodingAgent, AutonomousAgent } from '@strands-agents/sdk'
import { githubToolkit } from '../shared/toolkits/github'

// Recipe extends the appropriate execution mode
export class CodeReviewAgent extends Agent {
  constructor(config: CodeReviewConfig = {}) {
    super({
      tools: [...githubToolkit, readFile, grepTool, ...(config.extraTools ?? [])],
      systemPrompt: config.systemPrompt ?? CODE_REVIEW_PROMPT,
      contextManager: config.contextManager ?? 'auto',
      ...config,
    })
  }

  // Domain-specific convenience methods
  async review(pr: string): Promise<ReviewResult> { ... }
  async summarize(pr: string): Promise<string> { ... }
}
```

### 4.3 The Recipes

#### Recipe 1: Code Review Agent

**Extends:** `Agent` (interactive, read-heavy)  
**Primitives demonstrated:** Tool composition, structured output, context management for large diffs  
**Team deployment:** Runs on every PR to strands-agents repos, posts structured review as a comment

What it does:
- Reads the PR diff and related files
- Identifies bugs, security issues, performance problems, style inconsistencies
- Checks test coverage for changed code
- Produces structured output: Summary, Issues, Coverage Gaps, Positive Notes, Verdict
- Can be configured to auto-approve or require human review based on confidence

```typescript
const reviewer = new CodeReviewAgent({ model })
const review = await reviewer.review("strands-agents/sdk-typescript#123")
// → { summary, issues: [...], coverageGaps: [...], verdict: 'approve' | 'request-changes' }
```

#### Recipe 2: Design Sparring Agent (Devil's Advocate)

**Extends:** `ChatAgent` (multi-turn, conversational)  
**Primitives demonstrated:** Structured working state (maintains "open questions" list), multi-turn interaction, HITL  
**Team deployment:** Team members run it on design docs before review, posts generated questions as PR comments

What it does:
- Reads a design document
- Generates probing questions one at a time (Socratic style)
- Maintains a running list: resolved questions, open questions, key assumptions
- Identifies unstated assumptions, missing alternatives, risk areas
- Produces final summary of concerns and open threads

```typescript
const sparring = new DesignSparringAgent({ model })
// Socratic mode — interactive
const session = await sparring.spar("designs/0010-context-strategy.md")
// Batch mode — generate all questions at once
const questions = await sparring.reviewBatch("designs/0010-context-strategy.md")
```

#### Recipe 3: Regression Detective

**Extends:** `AutonomousAgent` (unattended, validation loop)  
**Primitives demonstrated:** Validation loop (Ralph loop), escalation via interventions, concurrent tool execution  
**Team deployment:** Triggered when CI goes red on main. Diagnoses the failure, identifies likely cause, optionally attempts fix.

What it does:
- Reads failing test output
- Diffs against last green commit
- Identifies likely root cause (file, change, author)
- Attempts a fix (validation loop: fix → test → check → repeat)
- If fix succeeds: opens PR. If not: posts diagnosis to the team with what it tried.

```typescript
const detective = new RegressionDetective({
  model,
  maxAttempts: 3,                    // Ralph loop iterations
  escalation: 'post-to-slack',      // if can't fix, notify team
})
await detective.investigate({ repo: 'strands-agents/sdk-typescript', branch: 'main' })
```

#### Recipe 4: Issue Triage Agent

**Extends:** `AutonomousAgent` (unattended, batch processing)  
**Primitives demonstrated:** Concurrent tool execution (processes multiple issues in parallel), structured output, RAG over existing issues  
**Team deployment:** Runs daily on new untriaged issues. Labels, deduplicates, routes, and drafts responses for common questions.

What it does:
- Fetches new unlabeled issues
- For each: searches existing issues for duplicates, classifies (bug/feature/question), assigns priority
- If duplicate: links to existing issue, suggests closing
- If common question: drafts response from docs
- Produces daily triage report

```typescript
const triage = new IssueTriage({ model, repo: 'strands-agents/sdk-typescript' })
const report = await triage.processNew()
// → { triaged: 12, duplicates: 3, autoResponded: 4, needsHuman: 5 }
```

#### Recipe 5: Changelog / Release Notes Agent

**Extends:** `Agent` (interactive, synthesis-heavy)  
**Primitives demonstrated:** Context management for large commit histories, structured output, template-driven generation  
**Team deployment:** Run before each release. Generates changelog from commits + PRs since last tag.

What it does:
- Reads all commits/PRs since last release tag
- Categorizes changes (features, fixes, breaking, internal)
- Generates user-facing changelog entries (not just commit messages)
- Identifies breaking changes and generates migration notes
- Produces formatted markdown ready for CHANGELOG.md

```typescript
const changelog = new ChangelogAgent({ model })
const notes = await changelog.generate({ since: 'v1.2.0', until: 'HEAD' })
// → { breaking: [...], features: [...], fixes: [...], migration: "..." }
```

#### Recipe 6: Test Generation Agent

**Extends:** `AutonomousAgent` (validation loop — generate → run → fix)  
**Primitives demonstrated:** Validation loop, code generation + execution, sandbox  
**Team deployment:** Run on new modules/files that lack test coverage.

What it does:
- Analyzes a source file's public API surface
- Generates comprehensive test cases (happy path, edge cases, error conditions)
- Runs tests in sandbox
- Fixes failures (validation loop until tests pass)
- Produces PR-ready test file

```typescript
const testGen = new TestGenAgent({ model, framework: 'vitest' })
await testGen.generate('src/context-manager/compression.ts')
// → creates src/context-manager/__tests__/compression.test.ts (passing)
```

#### Recipe 7: Onboarding / Codebase Q&A Agent

**Extends:** `ChatAgent` (conversational, persistent memory)  
**Primitives demonstrated:** MemoryManager integration, multi-turn with long-term recall, context injection  
**Team deployment:** Available to new team members / interns. Answers "where is X" / "how does Y work" questions.

What it does:
- Understands the codebase through code reading tools
- Answers architectural questions with file references
- Remembers previous questions and builds up institutional knowledge
- Gets better over time (memory accumulates)

```typescript
const guide = new CodebaseGuideAgent({
  model,
  memoryManager: new MemoryManager({ stores: [projectKnowledge] }),
})
await guide.chat("How does the intervention system work?")
// → explanation with file:line references, stored for future recall
```

#### Recipe 8: Benchmark Guardian

**Extends:** `AutonomousAgent` (scheduled, threshold-based)  
**Primitives demonstrated:** Scheduled execution, structured metrics, conditional alerting  
**Team deployment:** Runs nightly. Compares SDK performance against baseline. Alerts on regression.

What it does:
- Runs evaluation suite against current main
- Compares metrics to stored baseline (accuracy, latency, token usage)
- If regression detected: opens issue with analysis (what changed, likely cause)
- Maintains performance history over time

```typescript
const guardian = new BenchmarkGuardian({
  model,
  baselinePath: './benchmarks/baseline.json',
  threshold: 0.05,  // alert on >5% regression
})
await guardian.run()
```

### 4.4 Shared Toolkits

Recipes share reusable tool bundles:

```typescript
// shared/toolkits/github.ts
export const githubToolkit = [
  ghPrView,     // read PR metadata
  ghPrDiff,     // get PR diff
  ghIssueList,  // list/search issues
  ghIssueView,  // read issue details
  ghComment,    // post comments (guarded by intervention)
]

// shared/toolkits/codebase.ts
export const codebaseToolkit = [
  readFile,     // read source files
  grepTool,     // search code
  globTool,     // find files by pattern
  gitLog,       // read commit history
  gitDiff,      // compare branches/commits
]

// shared/toolkits/ci.ts
export const ciToolkit = [
  runTests,     // execute test suite
  lintCheck,    // run linter
  buildCheck,   // run build
  getCIStatus,  // check CI pipeline status
]
```

Toolkits are the reusable primitive. Recipes compose toolkits + opinionated types + system prompts into solutions.

### 4.5 Team Deployment Architecture

Deployed recipes run as:
- **GitHub Actions** — triggered on PR events, issue creation, schedule (cron)
- **CLI commands** — team members invoke manually (e.g., `npx strands-recipe review PR_URL`)
- **Always-on service** — for chat-based agents (onboarding buddy)

```yaml
# .github/workflows/code-review.yml
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx @strands-agents/recipes review --pr ${{ github.event.pull_request.number }}
```

---

## 5. Evaluation Plan

### 5.1 Recipe Quality Metrics

Each recipe is evaluated on:

| Metric | What it measures | Target |
|--------|-----------------|--------|
| Task completion | Does the recipe accomplish its stated goal? | >90% on happy path |
| Output quality | Is the output useful and actionable? | Team rating ≥4/5 |
| Token efficiency | Tokens consumed per invocation | Document baseline, optimize |
| Reliability | How often does it fail/produce garbage? | <5% failure rate |
| Extensibility | Can users easily customize it? | All config points documented |

### 5.2 Team Adoption Metrics (Deployed Recipes)

For the 3-4 recipes deployed to team workflows:

- **Usage frequency** — how often is it invoked per week?
- **Output acceptance rate** — how often do team members accept the output vs. override/ignore it?
- **Time saved** — self-reported estimate from team members
- **Feedback quality** — qualitative: what's useful, what's annoying, what's missing?

Collected via weekly check-in during Phase 3-4.

### 5.3 Composition Pattern Validation

Track which SDK primitives each recipe uses:

| Recipe | Interventions | Validation Loop | Structured Output | Concurrent Execution | Context Mgmt | Memory |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|
| Code Review | - | - | x | - | x | - |
| Design Sparring | x | - | x | - | x | - |
| Regression Detective | x | x | x | - | x | - |
| Issue Triage | - | - | x | x | x | - |
| Changelog | - | - | x | - | x | - |
| Test Gen | - | x | - | - | x | - |
| Onboarding Buddy | - | - | - | - | x | x |
| Benchmark Guardian | - | x | x | - | - | - |

This matrix validates that recipes collectively exercise all SDK primitives. Gaps indicate either missing recipes or undocumented composition patterns.

### 5.4 Developer Experience Validation

While building recipes, document:
- Which primitive compositions felt natural vs. required workarounds
- Where documentation was insufficient
- What utilities/helpers would have saved time
- Whether extending opinionated types for workflow agents worked smoothly
- Pain points in testing/debugging agents

Produce a DX report with actionable recommendations for the SDK team.

---

## 6. Timeline

### Phase 1: Foundation (Weeks 1-3)

**Week 1: Orientation + Shared Infrastructure**
- Read the Harness design proposal, SDK plugin architecture, existing tool implementations
- Set up local dev environment
- Build shared toolkits (github, codebase, ci)
- Define recipe structure template (README, index, prompts, tests, config)
- Ship the first recipe skeleton (Code Review — simplest, most concrete)

**Week 2: First Two Recipes**
- Implement Code Review Agent (end-to-end working)
- Implement Changelog Agent (second concrete output-oriented recipe)
- Test both against real Strands repo PRs and releases
- Iterate on system prompts based on output quality

**Week 3: Next Two Recipes**
- Implement Design Sparring Agent (first multi-turn/conversational recipe)
- Implement Issue Triage Agent (first batch/concurrent recipe)
- Test against real design docs and issue backlogs
- First round of DX friction notes

### Phase 2: Full Suite + Deployment (Weeks 4-6)

**Week 4: Remaining Recipes**
- Implement Regression Detective (validation loop + escalation)
- Implement Test Generation Agent (validation loop + sandbox)
- Implement Onboarding Buddy (memory integration)
- Implement Benchmark Guardian (scheduled + threshold alerting)

**Week 5: Team Deployment**
- Deploy Code Review Agent as GitHub Action on strands-agents repos
- Deploy Issue Triage Agent as daily scheduled action
- Deploy Design Sparring Agent as CLI command for the team
- Set up deployment infrastructure (Actions workflows, CLI wrapper)
- Collect initial team feedback

**Week 6: Polish + Iterate**
- Fix issues surfaced by team usage
- Tune system prompts based on real output quality
- Improve structured outputs based on what team actually wants to see
- Document each recipe (READMEs, configuration options, extension points)

### Phase 3: Optimization + Evaluation (Weeks 7-9)

**Week 7: System Prompt Tuning**
- For each deployed recipe: test 2-3 prompt variants
- Measure output quality, token efficiency, reliability
- Select best prompts based on team feedback + metrics
- Document prompt engineering learnings

**Week 8: Benchmarking**
- Establish baseline metrics for each recipe (tokens, accuracy, reliability)
- Test across 2-3 models (do recipes need model-specific tuning?)
- Run recipes against controlled test sets for reproducible evaluation
- Produce comparison: raw Agent vs. opinionated type vs. recipe

**Week 9: Cross-Cutting Analysis**
- Analyze team adoption data (2-3 weeks of real usage)
- Identify patterns: which recipes get used most? Which outputs get accepted?
- DX report: friction points, missing utilities, composition gaps
- Finalize recipe configurations based on accumulated evidence

### Phase 4: Polish + Publish (Week 10)

**Week 10: Deliverables**
- Final polish on all recipes (code quality, tests, docs)
- Write cookbook guide: "How to Build a Workflow Agent with Strands"
- Package for publication (README, examples, configuration reference)
- Final team adoption report
- Present findings to team: what worked, what didn't, what the SDK should improve

---

## 7. Key Research Questions

1. **Which compositions are natural vs. forced?** Do SDK primitives compose cleanly into workflow agents, or do recipes require awkward workarounds? Where are the gaps?

2. **What's the right granularity for recipes?** Is `CodeReviewAgent` the right level, or should it be decomposed into smaller composable pieces (PR summarizer + issue detector + coverage checker)?

3. **Do team members actually adopt agent-produced outputs?** The recipes need to earn trust. What quality threshold makes a team member accept a review/triage/changelog vs. rewrite it?

4. **How model-dependent are recipes?** Can the same Code Review Agent prompt work across Claude, GPT, and Llama? Or do recipes need per-model tuning?

5. **What's the right deployment pattern?** GitHub Actions vs. CLI vs. always-on service? Which fits which workflow best?

6. **Where do recipes outperform general-purpose agents?** A team member could ask Claude Code to "review this PR." Does a purpose-built recipe produce meaningfully better output? If so, why — and can that insight improve the general agent too?

7. **How do recipes evolve?** Once deployed, how should recipes handle SDK upgrades, model changes, team preference shifts? Does the config graduation path (toConfig → freeze) work for recipes?

---

## 8. Resources

### Strands Designs
- Harness, Config, Defaults design proposal (Meral, 2026) — defines opinionated types
- [PR #831](https://github.com/strands-agents/docs/pull/831) (`designs/0010-context-strategy.md`) — context management presets
- [PR #844](https://github.com/strands-agents/docs/pull/844) (`designs/0011-knowledge-bases.md`) — MemoryManager primitive

### Prior Art: Recipe/Cookbook Layers
- [LangChain Agent Toolkits](https://python.langchain.com/docs/modules/agents/toolkits/) — toolkit + factory pattern
- [Vercel AI SDK Templates](https://sdk.vercel.ai/docs) — full reference implementations
- [Mastra Recipes](https://mastra.ai/docs) — step-by-step workflow compositions
- [CrewAI Examples](https://github.com/crewAIInc/crewAI-examples) — community agent configurations

### Key SDK Primitives to Compose
- **Interventions** — HITL approval, escalation policies
- **Validation loops** (Ralph loop) — run → check → fix → repeat
- **Structured output** — typed responses from agent invocations
- **Concurrent tool execution** — parallel tool calls for batch processing
- **Context management** — `contextManager: 'auto'` for compression/offloading
- **Memory** — `MemoryManager` for cross-session knowledge
- **Hooks/Plugins** — lifecycle event handlers for custom behaviors
- **Tool registration** — dynamic tool composition

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Team doesn't adopt deployed recipes | Medium | High | Start with Code Review (highest immediate value, lowest friction — passive output). Get feedback in week 5, pivot if needed. Don't force adoption. |
| Recipes are too brittle (break on model/SDK changes) | Medium | Medium | Keep recipes thin — mostly configuration + prompts, minimal custom logic. Pin model versions in deployed instances. |
| Output quality isn't good enough to trust | High | High | Set a clear quality bar: recipe output must be useful >80% of the time. If a recipe can't hit this, demote it to "experimental" rather than deploying. |
| Scope creep — 8 recipes is too many | Medium | Medium | Prioritize 4 core recipes (Code Review, Design Sparring, Regression Detective, Issue Triage). The other 4 are stretch goals. Ship fewer, polished recipes over many half-baked ones. |
| Harness types not ready to extend | Low | Medium | Recipes can extend base `Agent` directly. The composition pattern (subclass + configured defaults) works regardless of whether the official opinionated types are merged. |
| Deployment infrastructure is a distraction | Medium | Low | Use simple GitHub Actions for deployment. Don't build custom infrastructure. If Actions are insufficient, deploy via CLI scripts. |

---

## 10. What "Done" Looks Like

At the end of 10 weeks, the intern delivers:

1. **Published recipes package** — 6-8 documented, runnable workflow agents in the SDK repository
2. **Shared toolkits** — reusable tool bundles (github, codebase, ci) that recipes and community can compose
3. **3-4 team-deployed recipes** — running in Strands team workflows (GitHub Actions + CLI)
4. **Team adoption report** — usage data, acceptance rates, qualitative feedback from 3+ weeks of real use
5. **Cookbook guide** — "How to Build a Workflow Agent with Strands" showing how to compose primitives into custom recipes
6. **DX report** — friction points encountered, composition patterns that work/don't, actionable API recommendations
7. **A presentation** — 15-minute demo of deployed recipes in action + findings

---

## Appendix A: Recipe Comparison Matrix

| Recipe | Extends | Execution Pattern | Key Primitives | Output Type | Deployment |
|--------|---------|-------------------|----------------|-------------|------------|
| Code Review | Agent | Single invocation | Structured output, context mgmt | ReviewResult (structured) | GitHub Action (on PR) |
| Design Sparring | ChatAgent | Multi-turn interactive | HITL, working state | Questions + summary | CLI command |
| Regression Detective | AutonomousAgent | Validation loop + escalation | Ralph loop, interventions | Diagnosis + fix PR | GitHub Action (on CI fail) |
| Issue Triage | AutonomousAgent | Batch concurrent | Concurrent execution, structured output | Triage report | Scheduled (daily) |
| Changelog | Agent | Single invocation | Context mgmt (large history), structured output | Markdown changelog | CLI (pre-release) |
| Test Gen | AutonomousAgent | Validation loop | Ralph loop, sandbox | Test file (runnable) | CLI command |
| Onboarding Buddy | ChatAgent | Multi-session | MemoryManager, context injection | Conversational | Always-on / CLI |
| Benchmark Guardian | AutonomousAgent | Scheduled + threshold | Validation loop, structured output | Alert or all-clear | Scheduled (nightly) |

---

## Appendix B: Example Recipe README

```markdown
# Code Review Agent

Automated code review for pull requests. Surfaces bugs, security issues,
performance problems, and test coverage gaps.

## Quick Start

\```typescript
import { CodeReviewAgent } from '@strands-agents/recipes'

const reviewer = new CodeReviewAgent({ model })
const review = await reviewer.review('owner/repo#123')

console.log(review.summary)
console.log(review.issues)     // [{ severity, file, line, description, suggestion }]
console.log(review.verdict)    // 'approve' | 'request-changes'
\```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `model` | required | LLM model to use |
| `severity` | `'medium'` | Minimum severity to report (`low`, `medium`, `high`, `critical`) |
| `focus` | `['bugs', 'security', 'performance']` | Categories to check |
| `extraTools` | `[]` | Additional tools (e.g., linter integration) |
| `autoApproveThreshold` | `undefined` | If set, auto-approves PRs below this issue count |

## Deployment (GitHub Action)

\```yaml
- uses: strands-agents/recipes/actions/code-review@v1
  with:
    model-provider: bedrock
    model-id: anthropic.claude-sonnet-4-20250514
    severity: medium
\```

## Extending

\```typescript
import { CodeReviewAgent } from '@strands-agents/recipes'

class SecurityReviewAgent extends CodeReviewAgent {
  constructor(config) {
    super({
      ...config,
      systemPrompt: SECURITY_FOCUSED_PROMPT,
      focus: ['security', 'injection', 'auth'],
    })
  }
}
\```
```

---

## Appendix C: Cookbook Guide Outline

**"How to Build a Workflow Agent with Strands"**

1. Choose your execution mode (which opinionated type to extend)
2. Define your tools (compose from shared toolkits + custom)
3. Write your system prompt (guidelines from prompt research)
4. Add structured output (type your agent's responses)
5. Wire in the right primitives (validation loops, interventions, memory)
6. Test against real inputs (evaluation methodology)
7. Deploy (GitHub Actions, CLI, or service)
8. Iterate based on usage (prompt tuning, configuration refinement)

Each section references 2-3 recipes as concrete examples. The guide teaches the pattern; recipes are the reference implementations.
