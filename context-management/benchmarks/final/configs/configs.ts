import { Agent, BedrockModel, SlidingWindowConversationManager, SummarizingConversationManager } from '@strands-agents/sdk'
import { bash } from '@strands-agents/sdk/vended-tools/bash'
import { ContextOffloader, InMemoryStorage } from '@strands-agents/sdk/vended-plugins/context-offloader'
import type { BenchmarkConfig, ContextBenchTask } from './types.js'

const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-6'

// Top 10 configs from the prior 66-config evaluation on huggingface/transformers-13693.
// Ranked by TAR (Token-Accuracy Ratio). See DESIGN.md for full context.
export function getConfigs(modelId?: string): BenchmarkConfig[] {
  const model = modelId ?? DEFAULT_MODEL

  return [
    {
      name: 'control',
      description: 'No context management (baseline)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off2500-p1500-slwin40',
      description: 'Prior #1: Offloader mrt=2500 p=1500 + SlidingWindow ws=40 (TAR 2.37)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 2500, previewTokens: 1500 })],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 40 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off1500-p750-noretrieval-slwin40',
      description: 'Prior #2: Offloader mrt=1500 p=750 no retrieval + SlidingWindow ws=40 (TAR 2.34)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750, includeRetrievalTool: false })],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 40 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off2000-p750-slwin40-pc06',
      description: 'Prior #3: Offloader mrt=2000 p=750 + SlidingWindow ws=40 proactive=0.6 (TAR 2.23)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 2000, previewTokens: 750 })],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 40, proactiveCompression: { compressionThreshold: 0.6 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off2500-p1000-slwin40',
      description: 'Offloader mrt=2500 p=1000 + SlidingWindow ws=40',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 2500, previewTokens: 1000 })],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 40 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off2500-p1500-slwin30',
      description: 'Offloader mrt=2500 p=1500 + SlidingWindow ws=30 (smaller window)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 2500, previewTokens: 1500 })],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 30 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off2500-p1500-slwin50',
      description: 'Offloader mrt=2500 p=1500 + SlidingWindow ws=50 (larger window)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 2500, previewTokens: 1500 })],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 50 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off1500-p750-slwin40',
      description: 'Offloader mrt=1500 p=750 (with retrieval) + SlidingWindow ws=40',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 40 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'slwin40-proactive',
      description: 'SlidingWindow ws=40 + proactive (no offloader)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 40, proactiveCompression: true }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'summarizing-03',
      description: 'Summarizing ratio=0.3 + proactive (no offloader)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, proactiveCompression: true }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    // --- Batch 2: Summarizing equivalents + proactive compression variants ---
    {
      name: 'off1500-p750-summ40',
      description: 'Best offloader (1500/750) + Summarizing ratio=0.3 (direct comparison to #1 winner)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off2500-p1500-summ40',
      description: 'Offloader mrt=2500 p=1500 + Summarizing ratio=0.3',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 2500, previewTokens: 1500 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off2000-p750-summ40-pc06',
      description: 'Offloader mrt=2000 p=750 + Summarizing ratio=0.3 proactive=0.6',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 2000, previewTokens: 750 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, proactiveCompression: { compressionThreshold: 0.6 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off1500-p750-slwin40-pc07',
      description: 'Best offloader + SlidingWindow ws=40 proactive=0.7',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 40, proactiveCompression: { compressionThreshold: 0.7 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off1500-p750-summ40-pc07',
      description: 'Best offloader + Summarizing ratio=0.3 proactive=0.7',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, proactiveCompression: { compressionThreshold: 0.7 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off1500-p750-summ40-pc085',
      description: 'Best offloader + Summarizing ratio=0.3 proactive=0.85',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, proactiveCompression: { compressionThreshold: 0.85 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off1500-p750-slwin40-pc085',
      description: 'Best offloader + SlidingWindow ws=40 proactive=0.85',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
          conversationManager: new SlidingWindowConversationManager({ windowSize: 40, proactiveCompression: { compressionThreshold: 0.85 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off1500-p750-summ40-pc085',
      description: 'Best offloader + Summarizing ratio=0.3 proactive=0.85',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, proactiveCompression: { compressionThreshold: 0.85 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off1500-p750-summ40-pc09',
      description: 'Best offloader + Summarizing ratio=0.3 proactive=0.9',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, proactiveCompression: { compressionThreshold: 0.9 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off1500-p750-summ40-pc095',
      description: 'Best offloader + Summarizing ratio=0.3 proactive=0.95',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1500, previewTokens: 750 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, proactiveCompression: { compressionThreshold: 0.95 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    // --- Higher offloading thresholds (testing 4K/1K and 8K/2K) ---
    {
      name: 'off4000-p1000-summ40-pc085',
      description: 'Offloader mrt=4000 p=1000 + Summarizing ratio=0.3 proactive=0.85',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 4000, previewTokens: 1000 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, proactiveCompression: { compressionThreshold: 0.85 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off8000-p2000-summ40-pc085',
      description: 'Offloader mrt=8000 p=2000 + Summarizing ratio=0.3 proactive=0.85 (conservative)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 8000, previewTokens: 2000 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3, proactiveCompression: { compressionThreshold: 0.85 } }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off4000-p1000-summ40',
      description: 'Offloader mrt=4000 p=1000 + Summarizing ratio=0.3 (no proactive)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 4000, previewTokens: 1000 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'off8000-p2000-summ40',
      description: 'Offloader mrt=8000 p=2000 + Summarizing ratio=0.3 (no proactive, conservative)',
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 8000, previewTokens: 2000 })],
          conversationManager: new SummarizingConversationManager({ summaryRatio: 0.3 }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
  ]
}
