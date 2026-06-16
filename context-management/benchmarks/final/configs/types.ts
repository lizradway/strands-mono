import type { Agent } from '@strands-agents/sdk'

export interface BenchmarkSuite {
  name: string
  run(opts: BenchmarkRunOpts): Promise<BenchmarkSuiteResult>
}

export interface BenchmarkRunOpts {
  config?: string
  agentFile?: string
  task?: string
  tasks?: string[]
  model?: string
  runs?: number
}

export interface BenchmarkConfig {
  name: string
  description: string
  createAgent(task: ContextBenchTask): Agent
}

export interface ContextBenchTask {
  id: string
  repo: string
  issue: number
  baseCommit: string
  prompt: string
  goldAnnotations: GoldAnnotation[]
}

export interface GoldAnnotation {
  file: string
  symbols?: string[]
  spans?: { startLine: number; endLine: number }[]
}

export interface EvaluationMetrics {
  fileCoverage: number
  filePrecision: number
  symbolCoverage: number
  symbolPrecision: number
  spanCoverage: number
  spanPrecision: number
  editLocRecall: number
  editLocPrecision: number
}

export interface BenchmarkResult {
  config: string
  task: string
  run?: number
  metrics: {
    inputTokens: number
    outputTokens: number
    cycleCount: number
    latencyMs: number
  }
  evaluation: EvaluationMetrics
  trajectory: string[]
  error?: string
}

export interface AggregatedResult {
  config: string
  task: string
  runs: number
  mean: EvaluationMetrics
  stddev: EvaluationMetrics
  meanMetrics: {
    inputTokens: number
    outputTokens: number
    cycleCount: number
    latencyMs: number
  }
}

export interface BenchmarkSuiteResult {
  suite: string
  timestamp: string
  gitSha: string
  branch: string
  results: BenchmarkResult[]
  aggregated?: AggregatedResult[]
}
