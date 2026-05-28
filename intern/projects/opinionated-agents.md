# Intern Project Brief: Opinionated Agent Harnesses

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK (strands-agents/sdk-typescript), with practical agent implementations  
**Prerequisites:** Familiarity with TypeScript, LLM APIs, experience using AI coding assistants  
**Difficulty:** Applied engineering, medium complexity, high breadth

---

## 1. Problem Statement

The Strands SDK today ships extension points — hooks, plugins, conversation managers, tool dispatch — but requires developers to compose them manually into a useful agent. A production-ready coding agent needs 5+ components wired together before it does anything interesting. The Harness design proposal (Meral, 2026) introduces **opinionated agent types** — pre-configured `Agent` subclasses with evolving, domain-specific defaults — as the solution.

But defining good defaults requires building and testing real agents. The defaults for `CodingAgent`, `ChatAgent`, and `AutonomousAgent` need to be informed by empirical evidence: what system prompts produce the best results? What context management strategy works for each domain? What intervention thresholds feel right? What tools are essential vs. nice-to-have?

This project combines two complementary tracks:

1. **Build the built-in harness agents** — implement `CodingAgent`, `ChatAgent`, and `AutonomousAgent` with benchmarked defaults
2. **Build practical team-process agents** — apply the harness architecture to real workflows (code review, design discussion, documentation) to stress-test the abstraction and produce useful artifacts

The first track validates the SDK architecture. The second track validates the developer experience and produces agents the team actually uses.

---

## 2. Background

### 2.1 The Harness Architecture

The Harness design proposal defines opinionated agent types as subclasses of `Agent` with pre-configured defaults:

```typescript
// Base Agent — explicit, frozen, production-safe
const agent = new Agent({ model, tools: [shell, editor], interventions: [...] })

// Opinionated type — batteries included, evolving defaults
const agent = new CodingAgent({ model })
agent("Fix the failing test in test_auth.py")
```

Key principles:
- **User-provided values always win** — override anything
- **Extras pattern** — `extraTools` adds on top of defaults, `tools` replaces entirely
- **No intermediate tier** — each type is self-contained, no deep inheritance chains
- **Config graduation** — `agent.toConfig()` pins behavior for production

Three initial types proposed:

| Type | Domain | Key defaults |
|------|--------|-------------|
| `CodingAgent` | Write, edit, debug code | shell + editor tools, sandbox, HITL on destructive ops, aggressive compression |
| `ChatAgent` | Conversational interaction | User-provided tools, HITL on all tool calls, conversation-focused context |
| `AutonomousAgent` | Unattended execution | No HITL, strict bounds (max turns, timeout), aggressive compression |

### 2.2 The Defaults Challenge

The proposal explicitly calls out: *"Define concrete defaults for each opinionated type — backed by benchmarks."* This is the core work of this project. Good defaults require:

- **System prompt engineering** — what instructions make a coding agent reliable?
- **Tool selection** — which tools are essential for each domain?
- **Context strategy tuning** — what compression threshold and strategy works best?
- **Intervention calibration** — which operations need human approval?
- **Execution bounds** — what are safe defaults for max turns and timeouts?

These answers come from building and evaluating real agents, not from intuition.

### 2.3 Team-Process Agents as Validation

The Strands team itself has workflows that agents could assist with:
- **Code review** — surface patterns, check for common issues, summarize PRs
- **Design discussion** — given a proposal, generate questions, identify gaps, suggest alternatives
- **Documentation** — generate API docs, update READMEs, write migration guides
- **Test generation** — given a module, generate comprehensive test cases
- **Incident response** — triage alerts, gather context, suggest next steps

Building these agents exercises the harness API from a consumer's perspective. If the `extras` pattern feels awkward, or the override semantics are confusing, or the defaults don't compose well — building real agents reveals it immediately.

---

## 3. Project Goals

### Primary Goal
Implement the three built-in opinionated agent types with empirically-validated defaults, and build 2-3 practical team-process agents that demonstrate the harness architecture in real workflows.

### Success Criteria
1. Working implementations of `CodingAgent`, `ChatAgent`, and `AutonomousAgent`
2. Benchmarked defaults for each (system prompts, tools, context strategy, interventions)
3. 2-3 practical agents the team can actually use (code review, design discussion, or similar)
4. Developer experience report — what works, what's awkward, what needs to change in the harness design
5. Documentation: getting-started guide leading with opinionated types

---

## 4. Technical Design

### 4.1 Harness Implementation Pattern

Each opinionated type follows the same pattern:

```typescript
import { Agent, AgentConfig } from '@strands-agents/sdk'

export class CodingAgent extends Agent {
  static readonly DEFAULT_TOOLS = [shell, editor, fileRead, fileWrite]
  static readonly DEFAULT_SYSTEM_PROMPT = `...`
  static readonly DEFAULT_CONTEXT_STRATEGY = 'auto' // aggressive compression

  constructor(config: CodingAgentConfig) {
    const resolved: AgentConfig = {
      tools: config.tools ?? [...CodingAgent.DEFAULT_TOOLS, ...(config.extraTools ?? [])],
      systemPrompt: config.systemPrompt ?? CodingAgent.DEFAULT_SYSTEM_PROMPT,
      contextManager: config.contextManager ?? CodingAgent.DEFAULT_CONTEXT_STRATEGY,
      interventions: config.interventions ?? [destructiveOpApproval],
      ...config,
    }
    super(resolved)
  }
}

interface CodingAgentConfig extends Partial<AgentConfig> {
  extraTools?: Tool[]
}
```

### 4.2 Track 1: Built-in Harness Agents

#### CodingAgent

**Hypothesis:** A coding agent needs aggressive context management (tool results are massive), a system prompt that enforces read-before-write discipline, and HITL only on destructive operations.

**Defaults to benchmark:**
- System prompt variants: minimal vs. structured guidelines vs. few-shot examples
- Compression threshold: 0.6 vs. 0.7 vs. 0.8 (coding produces large tool results quickly)
- Tool set: minimal (shell + editor) vs. extended (+ git, + test runner, + linter)
- HITL scope: all shell commands vs. only destructive (rm, git push, etc.)

**Evaluation tasks:**
- Fix a failing test (simple, well-scoped)
- Multi-file refactoring (context pressure, needs compression)
- Implement a new feature from spec (longer, needs planning)
- Debug a production issue from logs (research + fix)

#### ChatAgent

**Hypothesis:** A conversational agent needs conversation-focused context (keep dialogue, evict tool results), HITL on all tool calls (the human should confirm actions), and a system prompt that encourages clarification.

**Defaults to benchmark:**
- Context strategy: conversation-focused (evict tool results first) vs. balanced
- HITL: all tools vs. configurable allowlist
- System prompt: minimal vs. persona-driven vs. task-specific

**Evaluation tasks:**
- 20-turn customer support conversation with tool use
- Research task requiring multiple searches and synthesis
- Planning conversation that references earlier decisions

#### AutonomousAgent

**Hypothesis:** An unattended agent needs strict execution bounds (max turns, timeout), aggressive compression, no HITL, and a validation loop pattern for iterative tasks.

**Defaults to benchmark:**
- Max turns: 10 vs. 25 vs. 50 (tradeoff between capability and runaway cost)
- Timeout: 5min vs. 15min vs. 30min
- Compression: most aggressive (0.5 threshold) vs. moderate (0.7)
- Validation loop: test-fix-rerun pattern effectiveness

**Evaluation tasks:**
- CI/CD pipeline: run tests, fix failures, re-run until green
- Batch processing: process 20 items with error handling
- Scheduled task: generate daily report from data sources

### 4.3 Track 2: Team-Process Agents

These agents are built *using* the harness architecture — they validate the API while producing real utility.

#### Code Review Agent

Built as a custom opinionated type extending `Agent`. Given a PR diff, it:
- Identifies potential issues (bugs, security, performance, style)
- Checks for test coverage gaps
- Summarizes what changed and why
- Flags anything that needs human review vs. auto-approvable

```typescript
class CodeReviewAgent extends Agent {
  constructor(config: CodeReviewConfig) {
    super({
      tools: [ghPrDiff, ghPrView, grepTool, readFile],
      systemPrompt: CODE_REVIEW_PROMPT,
      contextManager: 'auto',
      ...config,
    })
  }

  async review(prUrl: string): Promise<ReviewResult> {
    return this.invoke(`Review this PR: ${prUrl}`)
  }
}
```

#### Design Discussion Agent

Given a design document, it:
- Generates probing questions (gaps, ambiguities, unstated assumptions)
- Identifies risks and tradeoffs not explicitly addressed
- Suggests alternatives for each major decision
- Produces a structured review suitable for async discussion

```typescript
class DesignReviewAgent extends Agent {
  constructor(config: DesignReviewConfig) {
    super({
      tools: [readFile, webSearch],
      systemPrompt: DESIGN_REVIEW_PROMPT,
      contextManager: 'auto',
      ...config,
    })
  }

  async reviewDesign(docPath: string): Promise<DesignReview> {
    return this.invoke(`Review this design doc: ${docPath}`)
  }
}
```

#### Test Generation Agent

Given a source file or module, it:
- Analyzes the public API surface
- Generates comprehensive test cases (happy path, edge cases, error conditions)
- Produces runnable test code in the project's testing framework
- Runs tests to verify they pass

```typescript
class TestGenAgent extends AutonomousAgent {
  constructor(config: TestGenConfig) {
    super({
      extraTools: [testRunner, linter],
      systemPrompt: TEST_GEN_PROMPT,
      maxTurns: 30, // iterative: generate → run → fix
      ...config,
    })
  }
}
```

### 4.4 System Prompt Research

Each agent type needs a system prompt that's been tested against alternatives. The research approach:

1. **Write 3-4 variants** per agent type (minimal, structured, few-shot, persona-based)
2. **Run each variant** against the evaluation tasks
3. **Measure** task completion rate, token efficiency, user satisfaction (for team agents)
4. **Select the winner** as the default, document why

System prompt dimensions to explore:
- **Length**: How minimal can it be while remaining effective?
- **Structure**: Rules vs. examples vs. both?
- **Tone**: Assertive ("Always do X") vs. advisory ("Consider doing X")?
- **Self-reference**: Should the agent know it's a "CodingAgent"? Does identity help?
- **Tool guidance**: Explicit instructions per tool vs. rely on tool descriptions?

---

## 5. Evaluation Plan

### 5.1 Harness Agent Benchmarks

**Task completion rate** — does the agent accomplish the goal?

| Agent | Task suite | Baseline (raw Agent) | Target (opinionated) |
|-------|-----------|---------------------|---------------------|
| CodingAgent | SWE-bench subset (20 tasks) | Establish baseline | >20% improvement |
| ChatAgent | Multi-turn Q&A (10 conversations) | Establish baseline | Higher coherence on late-turn callbacks |
| AutonomousAgent | CI-fix loop (10 repos) | Establish baseline | >80% fix rate within bounds |

**Token efficiency** — tokens consumed per successful task completion.

**Context utilization** — how well does the compression strategy preserve useful information?

**Intervention ergonomics** — for HITL agents, how often does the human approve vs. modify vs. reject? (Indicates whether the defaults are too aggressive or too permissive.)

### 5.2 Team-Process Agent Evaluation

These are evaluated by actual team usage:

- **Code Review Agent**: Run on 10 real PRs. Compare findings to human reviewer comments. Measure: precision (are flagged issues real?), recall (did it miss things humans caught?), usefulness rating from reviewers.
- **Design Discussion Agent**: Run on 3 real design docs. Present generated questions to the author. Measure: how many questions are novel/useful vs. obvious/already addressed?
- **Test Generation Agent**: Run on 5 modules. Measure: test coverage delta, pass rate, code quality of generated tests.

### 5.3 Developer Experience Evaluation

Track friction points while building team-process agents:
- Where did the `extras` pattern feel natural vs. awkward?
- Were default overrides intuitive?
- Did composition work (extending AutonomousAgent for TestGenAgent)?
- What was missing from the harness API?
- What would have made building these agents easier?

Produce a DX report with concrete API change recommendations.

---

## 6. Timeline

### Phase 1: Foundation (Weeks 1-3)

**Week 1: Orientation + Architecture**
- Read the Harness design proposal, context strategy design (PR #831), existing SDK plugin architecture
- Set up local dev environment, understand tool registration and hook system
- Implement the base harness pattern (extras, overrides, default resolution)
- Ship a minimal `CodingAgent` skeleton with placeholder defaults

**Week 2: CodingAgent v1**
- Implement `CodingAgent` with initial defaults (system prompt, tools, context strategy)
- Build evaluation task suite (4 coding tasks of varying complexity)
- Run initial benchmarks — establish baseline vs. raw Agent
- Iterate on system prompt based on failure analysis

**Week 3: ChatAgent + AutonomousAgent v1**
- Implement `ChatAgent` with initial defaults
- Implement `AutonomousAgent` with initial defaults + validation loop pattern
- Build evaluation tasks for each
- Run initial benchmarks

### Phase 2: Team-Process Agents (Weeks 4-6)

**Week 4: Code Review Agent**
- Design the code review agent (tools, prompt, output format)
- Implement as a custom opinionated type extending `Agent`
- Test on 5 real PRs from the Strands repos
- Iterate on prompt and output quality

**Week 5: Design Discussion Agent + Test Gen Agent**
- Implement design discussion agent
- Implement test generation agent (extends `AutonomousAgent` — validation loop)
- Test each on real team artifacts
- Document DX friction encountered

**Week 6: Integration + DX Report**
- Polish team-process agents based on feedback
- Write developer experience report (what worked, what didn't, API recommendations)
- Feed DX findings back into harness architecture refinements
- Ensure all agents work with `toConfig()` / `fromConfig()` graduation path

### Phase 3: Benchmarking + Optimization (Weeks 7-9)

**Week 7: System Prompt Research**
- Write 3-4 system prompt variants for each built-in type
- Run each variant against the full evaluation suite
- Analyze: which prompting strategies work for which agent types?
- Select winners as defaults

**Week 8: Defaults Tuning**
- Run ablation studies on context strategy, tool sets, intervention thresholds
- Compare across 2-3 models (does CodingAgent need different defaults for Claude vs GPT?)
- Tune execution bounds for AutonomousAgent (max turns, timeout)
- Finalize defaults backed by data

**Week 9: Cross-Cutting Concerns**
- Test model portability (do defaults work across providers?)
- Test config graduation (toConfig → fromConfig roundtrip preserves behavior?)
- Test composability (extending built-in types for custom agents)
- Run final benchmark suite with optimized defaults

### Phase 4: Polish (Week 10)

**Week 10: Deliverables**
- Write getting-started guide leading with opinionated types
- Document each agent type's defaults and rationale
- Package team-process agents as examples/recipes
- Final benchmark report
- Present findings to team

---

## 7. Key Research Questions

1. **How much do defaults matter?** What's the delta between a well-configured CodingAgent and a raw Agent with the same tools? If the delta is small, the harness is sugar. If it's large, the harness is load-bearing.

2. **Are defaults model-specific?** Does a `CodingAgent` need different system prompts, compression thresholds, or tool sets for Claude vs. GPT vs. Llama? Or do universal defaults work across providers?

3. **What's the right intervention threshold?** For `CodingAgent`, is "approve destructive shell commands" the right level? Or should it be more/less granular? Does the threshold vary by task type?

4. **Does the extras pattern scale?** When building team-process agents, does `extraTools` + `extraPlugins` cover real composition needs? Or are there patterns that require replacing defaults in non-obvious ways?

5. **What makes a system prompt "good" for each domain?** Is brevity better (fewer tokens, less instruction-following failure) or is structure better (more reliable behavior at higher token cost)?

6. **Should agents have identity?** Does a `CodingAgent` perform better if its system prompt says "You are a coding agent" vs. generic instructions? Does self-concept improve tool use or just waste tokens?

7. **How does the validation loop pattern generalize?** The `AutonomousAgent` validation loop (run → check → fix → repeat) is proposed for CI/CD. Does it work for other domains? What are the failure modes (infinite loops, quality degradation per iteration)?

---

## 8. Resources

### Strands Designs
- Harness, Config, Defaults design proposal (Meral, 2026) — defines the architecture
- [PR #831](https://github.com/strands-agents/docs/pull/831) (`designs/0010-context-strategy.md`) — context management presets
- [PR #844](https://github.com/strands-agents/docs/pull/844) (`designs/0011-knowledge-bases.md`) — MemoryManager primitive

### Reference Implementations
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — opinionated coding agent (system prompt, tool use patterns)
- [OpenAI Codex](https://openai.com/index/codex/) — sandboxed autonomous coding agent
- [Devin](https://devin.ai) — autonomous software engineer (execution bounds, planning)
- [CrewAI Agents](https://github.com/crewAIInc/crewAI) — role-based agent configuration
- [Mastra Agents](https://mastra.ai) — typed agent configuration with dynamic instructions

### Key Interfaces to Build Against
- `Agent` class — base class to extend
- `AgentConfig` — full configuration interface
- Plugin system — hooks, lifecycle events
- Tool registration — how tools are declared and dispatched
- Context management — `contextManager` parameter and strategies
- Intervention system — approval hooks, HITL patterns

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Harness base architecture not ready in SDK | Medium | High | Build against the pattern (subclass + setdefault) even if the official base isn't merged yet. The pattern is trivial — the value is in the defaults, not the mechanism. |
| Defaults that work for one model fail on another | High | Medium | Test across 2-3 models. If model-specific defaults are needed, document per-model recommendations. May inform a `model` parameter on the opinionated type that adjusts defaults. |
| Team-process agents aren't useful enough to get real usage | Medium | Low | Start with code review (highest immediate value, most concrete output). Get feedback early and pivot if needed. |
| System prompt research is unbounded | Medium | Medium | Cap at 4 variants per type. Use structured evaluation (task completion, not vibes). Set a decision deadline and ship the best-so-far. |
| Evaluation tasks don't represent real usage | Medium | Medium | Supplement synthetic benchmarks with real team tasks. The team-process agents track provides organic validation. |
| Scope creep into config/deployment (§6 of harness proposal) | Medium | Low | Config graduation (toConfig/fromConfig) is out of scope for this project. Focus on the agent types and defaults. Validate that the pattern supports config export but don't implement the full config system. |

---

## 10. What "Done" Looks Like

At the end of 10 weeks, the intern delivers:

1. **Three built-in agent types** — `CodingAgent`, `ChatAgent`, `AutonomousAgent` with benchmarked, validated defaults
2. **2-3 team-process agents** — code review, design discussion, test generation (or similar) that the team can use
3. **Benchmark results** — quantified improvement over raw Agent for each type across task categories
4. **System prompt research** — tested variants, winner selection, rationale documented
5. **Developer experience report** — friction points, API recommendations, composition patterns that work/don't
6. **Getting-started guide** — tutorial-style documentation leading with opinionated types
7. **A presentation** — 15-minute demo showing agents in action + findings

---

## Appendix A: Example — Building a Team Agent

### Code Review Agent (full implementation sketch)

```typescript
import { Agent } from '@strands-agents/sdk'

const CODE_REVIEW_PROMPT = `You are a code review agent. Given a pull request, you:

1. Read the diff carefully
2. Identify potential issues: bugs, security vulnerabilities, performance problems, style inconsistencies
3. Check whether tests cover the changes
4. Note positive aspects (good patterns, clean abstractions)
5. Produce a structured review

Be specific — cite line numbers. Be constructive — suggest fixes, not just problems.
Don't nitpick formatting unless it affects readability.
Focus on correctness and maintainability over style preferences.`

export class CodeReviewAgent extends Agent {
  constructor(config: Partial<AgentConfig> & { extraTools?: Tool[] } = {}) {
    super({
      tools: [ghPrDiff, ghPrView, readFile, grepTool, ...(config.extraTools ?? [])],
      systemPrompt: config.systemPrompt ?? CODE_REVIEW_PROMPT,
      contextManager: config.contextManager ?? 'auto',
      ...config,
    })
  }

  async review(pr: string): Promise<string> {
    const result = await this.invoke(
      `Review this pull request. Provide a structured review with sections for: ` +
      `Summary, Issues Found, Test Coverage, Positive Notes, and Verdict (approve/request changes). ` +
      `PR: ${pr}`
    )
    return result.output
  }
}

// Usage
const reviewer = new CodeReviewAgent({ model })
const review = await reviewer.review("https://github.com/strands-agents/sdk-typescript/pull/123")
```

### How This Validates the Harness Architecture

Building this agent exercises:
- **Subclass pattern** — does extending Agent feel natural?
- **Tool composition** — `extraTools` alongside agent-specific defaults
- **System prompt override** — does `config.systemPrompt ?? DEFAULT` work intuitively?
- **Context strategy** — does `'auto'` handle large PR diffs well?
- **Domain method** — adding `.review()` convenience on top of `.invoke()`

Friction discovered here directly informs the harness design.

---

## Appendix B: Evaluation Rubric for System Prompts

Each system prompt variant is scored on:

| Dimension | 1 (Poor) | 3 (Adequate) | 5 (Excellent) |
|-----------|----------|--------------|---------------|
| Task completion | Fails most tasks | Completes with errors | Completes reliably |
| Tool use efficiency | Unnecessary calls, wrong tools | Correct but suboptimal | Minimal calls, right tools |
| Context awareness | Ignores earlier context | References when prompted | Proactively uses relevant context |
| Error recovery | Gives up on first failure | Retries naively | Diagnoses and adapts strategy |
| Output quality | Verbose, unstructured | Adequate formatting | Clean, actionable, well-structured |
| Token efficiency | >2x optimal token count | ~1.5x optimal | Near-optimal |

A variant must score ≥3 on all dimensions and ≥4 on task completion to be considered as a default.

---

## Appendix C: The Validation Loop Pattern (AutonomousAgent)

The `AutonomousAgent` supports iterative execution where output is validated after each invocation:

```typescript
const agent = new AutonomousAgent({
  model,
  tools: [shell, editor, testRunner],
  validation: {
    check: async (result) => {
      const testOutput = await runTests()
      return { pass: testOutput.exitCode === 0, feedback: testOutput.stderr }
    },
    maxRetries: 3,
  },
})

// Agent runs → validation checks → if failed, agent re-runs with feedback → repeat
await agent.invoke("Fix the failing tests in src/auth/")
```

This pattern is implemented via the `afterAgentInvocation` hook:
1. Agent completes invocation
2. Hook runs validation function on output
3. If validation fails, hook resumes agent with feedback message
4. Repeat until pass or maxRetries exhausted

Research questions for this pattern:
- Does quality degrade on each retry (agent gets confused by its own failed attempts)?
- Is 3 retries the right default, or should it be task-dependent?
- Should the agent see its previous failed attempts, or start fresh each time?
- How does this interact with context management (retries accumulate context fast)?
