# Intern Project: Agent Cookbook

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK, published recipes package, internal team deployment  
**Prerequisites:** Familiarity with TypeScript, LLM APIs, experience using AI coding assistants

---

## Overview

Build a published recipes/cookbook layer for the Strands SDK — polished, documented workflow agents that show developers how to compose SDK primitives into real solutions. Deploy 3-4 recipes into the Strands team's own processes as dogfooding.

The SDK ships primitives (interventions, validation loops, structured output, concurrent execution, context management, memory, hooks). The Harness proposal adds opinionated types (`CodingAgent`, `ChatAgent`, `AutonomousAgent`) as execution modes. This project fills the gap between those layers: **recipes that show what you can build when you put them together.**

Think: LangChain's toolkit factories, Vercel AI SDK templates, Mastra recipes — but for Strands.

---

## What Gets Built

### Shared Toolkits (reusable tool bundles)

- **GitHub toolkit** — PR view/diff, issue list/view, comments
- **Codebase toolkit** — file read, grep, glob, git log, git diff
- **CI toolkit** — test runner, lint, build, CI status

### Recipes (6-8 workflow agents)

| Recipe | What it does | Deployment |
|--------|-------------|------------|
| **Code Review** | Reads PR diff, identifies bugs/security/perf issues, produces structured review | GitHub Action on PR |
| **Design Sparring** | Socratic review of design docs — probing questions, unstated assumptions, risk areas | CLI command |
| **Regression Detective** | Diagnoses CI failures, identifies root cause, attempts fix (validation loop), escalates if stuck | GitHub Action on CI fail |
| **Issue Triage** | Classifies, deduplicates, routes new issues; drafts responses for common questions | Scheduled daily |
| **Changelog Writer** | Generates release notes from commits/PRs since last tag | CLI pre-release |
| **Test Generation** | Generates test cases for a module, runs them, fixes failures until passing | CLI command |
| **Onboarding Buddy** | Codebase Q&A agent that remembers previous questions (uses MemoryManager) | Always-on / CLI |
| **Benchmark Guardian** | Nightly eval suite, alerts on regressions | Scheduled nightly |

Each recipe includes: README, implementation, system prompt, example config, tests.

### Cookbook Guide

A tutorial doc — "How to Build a Workflow Agent with Strands" — walking through execution mode selection, tool composition, prompt writing, structured output, deployment. References recipes as concrete examples.

### DX Report

Document friction encountered while building recipes. What composed cleanly, what required workarounds, what the SDK should improve. Actionable recommendations for the harness API.

---

## Success Criteria

1. **Published package** — 6-8 documented, runnable recipes in the SDK repository (or `@strands-agents/recipes`)
2. **Team deployment** — 3-4 recipes actively running in Strands team workflows
3. **Team adoption** — at least 2 recipes used regularly (weekly) by team members after initial deployment
4. **Output quality** — deployed recipes produce useful output ≥80% of the time (team-rated)
5. **Primitive coverage** — recipes collectively exercise all major SDK primitives (interventions, validation loops, structured output, concurrent execution, context management, memory)
6. **Cookbook published** — guide showing how to build custom workflow agents, referencing recipes as examples
7. **DX feedback** — documented friction points and API recommendations delivered to SDK team

---

## Timeline (High Level)

| Phase | Weeks | Focus |
|-------|-------|-------|
| Foundation | 1-3 | Build shared toolkits, ship first 4 recipes (Code Review, Changelog, Design Sparring, Issue Triage) |
| Full Suite + Deploy | 4-6 | Build remaining recipes, deploy 3-4 to team workflows, collect initial feedback |
| Optimize + Evaluate | 7-9 | Tune prompts based on real usage, benchmark across models, analyze adoption, write DX report |
| Polish + Publish | 10 | Final docs, cookbook guide, team adoption report, presentation |

---

## Why This Project

- **Immediately useful** — the team gets agents that help with real work (reviews, triage, changelogs)
- **Publicly valuable** — recipes become the "getting started" examples for the Strands community
- **Validates the architecture** — building 6-8 agents on the harness reveals whether the primitives actually compose well
- **Distinct from sprint work** — the core opinionated types (`CodingAgent`, etc.) are sprint-scoped. Recipes are workflow-specific compositions that won't be built otherwise
- **High breadth** — the intern touches every major SDK surface area (tools, hooks, interventions, memory, context, structured output) across diverse use cases
