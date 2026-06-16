import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AggregatedResult, BenchmarkConfig, BenchmarkResult, BenchmarkRunOpts, BenchmarkSuite, BenchmarkSuiteResult, EvaluationMetrics } from './types.js'
import { getConfigs } from './configs.js'
import { loadTask, ensureDependencies } from './contextbench/loader.js'
import { runBenchmark } from './runner.js'
import { writeResults, generateMarkdown } from './reporter.js'
import { emitMetrics } from './cloudwatch.js'

const ROOT = resolve(import.meta.dirname, '../../..')

const DEFAULT_TASK = 'django__django-15987'

async function loadCustomConfig(agentFile: string): Promise<BenchmarkConfig> {
  const absPath = resolve(agentFile)
  const module = (await import(pathToFileURL(absPath).href)) as { default?: BenchmarkConfig; config?: BenchmarkConfig }
  const config = module.default ?? module.config
  if (!config || typeof config.createAgent !== 'function') {
    throw new Error(
      `Agent file must export a BenchmarkConfig (with name, description, createAgent). Got: ${Object.keys(module).join(', ')}`
    )
  }
  return config
}

const contextbench: BenchmarkSuite = {
  name: 'contextbench',
  async run(opts: BenchmarkRunOpts): Promise<BenchmarkSuiteResult> {
    ensureDependencies()

    const taskIds = opts.tasks ?? [opts.task ?? DEFAULT_TASK]
    const numRuns = opts.runs ?? 1

    const configs = getConfigs(opts.model)
    let selectedConfigs: BenchmarkConfig[]

    if (opts.agentFile) {
      const custom = await loadCustomConfig(opts.agentFile)
      console.log(`Using custom agent: ${custom.name}`)
      selectedConfigs = [custom]
    } else if (opts.config) {
      selectedConfigs = configs.filter((c) => c.name === opts.config)
    } else {
      selectedConfigs = configs
    }

    if (selectedConfigs.length === 0) {
      const available = configs.map((c) => c.name).join(', ')
      throw new Error(`Unknown config "${opts.config}". Available: ${available}`)
    }

    console.log(`Tasks: ${taskIds.length} | Configs: ${selectedConfigs.length} | Runs per combo: ${numRuns}`)
    console.log(`Total agent invocations: ${taskIds.length * selectedConfigs.length * numRuns}`)

    const results: BenchmarkResult[] = []

    for (const taskId of taskIds) {
      console.log(`\nLoading task: ${taskId}`)
      const task = loadTask(taskId)
      console.log(`  Repo: ${task.repo}, commit: ${task.baseCommit.slice(0, 12)}`)

      for (const config of selectedConfigs) {
        for (let run = 1; run <= numRuns; run++) {
          const runLabel = numRuns > 1 ? ` (run ${run}/${numRuns})` : ''
          console.log(`\nRunning config: ${config.name}${runLabel}`)
          const result = await runBenchmark(config, task)
          result.run = run
          results.push(result)

          if (result.error) {
            console.log(`  ✗ ${config.name}: ERROR — ${result.error}`)
            if (result.error.includes('Too many tokens') || result.error.includes('throttl')) {
              console.log(`  Waiting 60s for rate limit cooldown...`)
              await new Promise((r) => setTimeout(r, 60_000))
            }
          } else {
            console.log(
              `  ✓ ${config.name}: coverage=${(result.evaluation.fileCoverage * 100).toFixed(0)}% ` +
                `precision=${(result.evaluation.filePrecision * 100).toFixed(1)}% ` +
                `tokens=${(result.metrics.inputTokens / 1000).toFixed(0)}K ` +
                `cycles=${result.metrics.cycleCount}`
            )
          }
        }
      }
    }

    const gitSha = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim()

    const aggregated = numRuns > 1 ? aggregate(results) : undefined

    return {
      suite: 'contextbench',
      timestamp: new Date().toISOString(),
      gitSha,
      branch,
      results,
      aggregated,
    }
  },
}

function aggregate(results: BenchmarkResult[]): AggregatedResult[] {
  const groups = new Map<string, BenchmarkResult[]>()
  for (const r of results) {
    if (r.error) continue
    const key = `${r.config}::${r.task}`
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }

  const aggregated: AggregatedResult[] = []
  for (const [, group] of groups) {
    if (group.length === 0) continue
    const first = group[0]!

    const evalKeys: (keyof EvaluationMetrics)[] = [
      'fileCoverage', 'filePrecision', 'symbolCoverage', 'symbolPrecision',
      'spanCoverage', 'spanPrecision', 'editLocRecall', 'editLocPrecision',
    ]

    const mean: EvaluationMetrics = {} as EvaluationMetrics
    const stddev: EvaluationMetrics = {} as EvaluationMetrics
    for (const key of evalKeys) {
      const values = group.map((r) => r.evaluation[key])
      mean[key] = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((sum, v) => sum + (v - mean[key]) ** 2, 0) / values.length
      stddev[key] = Math.sqrt(variance)
    }

    const meanTokens = group.reduce((s, r) => s + r.metrics.inputTokens, 0) / group.length
    const meanOutput = group.reduce((s, r) => s + r.metrics.outputTokens, 0) / group.length
    const meanCycles = group.reduce((s, r) => s + r.metrics.cycleCount, 0) / group.length
    const meanLatency = group.reduce((s, r) => s + r.metrics.latencyMs, 0) / group.length

    aggregated.push({
      config: first.config,
      task: first.task,
      runs: group.length,
      mean,
      stddev,
      meanMetrics: {
        inputTokens: Math.round(meanTokens),
        outputTokens: Math.round(meanOutput),
        cycleCount: Math.round(meanCycles),
        latencyMs: Math.round(meanLatency),
      },
    })
  }

  return aggregated
}

const suites: Record<string, BenchmarkSuite> = { contextbench }

export interface BenchmarkOpts {
  suite: string
  config?: string
  agentFile?: string
  task?: string
  tasks?: string[]
  runs?: number
  model?: string
  minCoverage?: number
  output?: string
  outputMd?: string
  cloudwatch?: boolean
}

export async function benchmark(opts: BenchmarkOpts): Promise<void> {
  const suite = suites[opts.suite]
  if (!suite) {
    const available = Object.keys(suites).join(', ')
    console.error(`Unknown benchmark suite: "${opts.suite}". Available: ${available}`)
    process.exit(1)
  }

  console.log(`\nRunning benchmark suite: ${suite.name}\n`)

  const result = await suite.run({
    config: opts.config,
    agentFile: opts.agentFile,
    task: opts.task,
    tasks: opts.tasks,
    runs: opts.runs,
    model: opts.model,
  })

  writeResults(result, { output: opts.output, outputMd: opts.outputMd })

  if (!opts.output && !opts.outputMd) {
    console.log('\n' + generateMarkdown(result))
  }

  if (opts.cloudwatch) {
    await emitMetrics(result)
  }

  const failed = result.results.filter((r) => r.error)
  if (failed.length > 0) {
    console.error(`\n${failed.length} benchmark(s) errored.`)
    process.exit(1)
  }

  if (opts.minCoverage != null) {
    const belowThreshold = result.results.filter(
      (r) => !r.error && r.evaluation.fileCoverage < opts.minCoverage!
    )
    if (belowThreshold.length > 0) {
      console.error(
        `\nFAILED: ${belowThreshold.length} config(s) below minimum coverage of ${(opts.minCoverage * 100).toFixed(0)}%:`
      )
      for (const r of belowThreshold) {
        console.error(`  ${r.config}: ${(r.evaluation.fileCoverage * 100).toFixed(1)}%`)
      }
      process.exit(1)
    }
    console.log(`\nAll configs above minimum coverage threshold (${(opts.minCoverage * 100).toFixed(0)}%)`)
  }

  process.exit(0)
}
