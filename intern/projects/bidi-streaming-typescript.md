# Intern Project Brief: Bidirectional Streaming for TypeScript SDK

**Duration:** 10 weeks (~2.5 months)  
**Scope:** TypeScript SDK (strands-agents/sdk-typescript)  
**Prerequisites:** Familiarity with TypeScript, async programming (Promises, AsyncIterators), WebSockets, basic audio/media concepts  
**Difficulty:** Systems engineering, high complexity, high impact

---

## 1. Problem Statement

The Strands Python SDK ships an experimental bidirectional streaming module (`strands.experimental.bidi`) that enables real-time, persistent-connection agents — voice assistants, live transcription, interactive audio applications. It supports three model providers (Amazon Nova Sonic, OpenAI Realtime, Google Gemini Live) with concurrent tool execution, automatic interruption handling, and flexible I/O (microphone, text, WebSocket).

The TypeScript SDK has **no equivalent**. There is a single open feature request ([sdk-typescript#869](https://github.com/strands-agents/sdk-typescript/issues/869)) with no implementation, no timeline, and no assignee. Community members are already asking when it will land.

This matters because:
- TypeScript is the natural language for web-based real-time applications (WebSocket servers, browser audio, WebRTC)
- Voice/audio agents are a fast-growing use case — every major provider now ships a realtime API
- The Python implementation exists as a proven reference architecture, making a TypeScript port well-scoped
- The Python team is actively graduating bidi from experimental ([sdk-python#1722](https://github.com/strands-agents/sdk-python/issues/1722)) — shipping TypeScript in parallel means both SDKs reach GA together

---

## 2. Background

### 2.1 What is Bidirectional Streaming?

Unlike the standard `Agent` (request-response pattern), a `BidiAgent` maintains a persistent connection that enables:

- **Two-way event streaming** — events flow app → model (`send()`) AND model → app (`receive()`) simultaneously
- **Real-time audio** — microphone input and speaker output with PCM/WAV/Opus at 16-48kHz
- **Concurrent tool execution** — tools run in background without blocking the conversation
- **Automatic interruption** — when users start speaking, the model stops generating and audio buffers clear
- **Connection lifecycle management** — timeout handling, automatic reconnection, graceful shutdown

| | Standard Agent | BidiAgent |
|--|----------------|-----------|
| Connection | Per-request | Persistent |
| Communication | Request → Response | Continuous bidirectional |
| Latency | Round-trip per turn | Sub-second streaming |
| Audio | Not supported | Native |
| Tool execution | Sequential | Concurrent (non-blocking) |
| Interruptions | Not applicable | Automatic |

### 2.2 Python SDK Architecture (Reference)

The Python implementation lives in `strands.experimental.bidi` with this structure:

```
strands/experimental/bidi/
├── agent/
│   ├── agent.py          # BidiAgent class
│   └── loop.py           # Event loop (tool detection, dispatch)
├── models/
│   ├── nova_sonic.py     # Amazon Nova Sonic provider
│   ├── openai_realtime.py # OpenAI Realtime API provider
│   └── gemini_live.py    # Google Gemini Live provider
├── io/
│   ├── audio.py          # BidiAudioIO (mic + speaker via PyAudio)
│   └── text.py           # BidiTextIO (terminal)
└── types/
    ├── events.py         # All event types
    └── io.py             # BidiInput/BidiOutput protocols
```

**Core API:**
```python
model = BidiNovaSonicModel()
agent = BidiAgent(model=model, tools=[calculator])
audio_io = BidiAudioIO()

await agent.run(
    inputs=[audio_io.input()],
    outputs=[audio_io.output()]
)
```

**Key abstractions:**
- `BidiAgent` — orchestrates the connection, event loop, and tool execution
- `BidiModel` — provider-specific connection (WebSocket/SDK) with `start()`, `send()`, `receive()`, `stop()`
- `BidiInput` — async callable that produces input events (audio chunks, text, images)
- `BidiOutput` — async callable that consumes output events (audio playback, transcript display)
- Event types — strongly typed events for audio, transcripts, tool use, lifecycle, errors

**Lifecycle:** Created → Started (connection open) → Running (send/receive active) → Stopped (cleanup)

**Connection management:** Automatic restart on timeout (Nova Sonic: 8 min, OpenAI: 60 min). Conversation history replayed on reconnect. Sending blocked during restart.

### 2.3 Current State

- **Python SDK**: Working experimental implementation. Active effort to graduate from experimental (7 issues filed May 27, 2026 covering WebRTC, WebSocket, video, multi-agent, telemetry, evaluations).
- **TypeScript SDK**: Nothing. Single feature request (#869). No prior art in the codebase.
- **Python learnings to apply**: The Python team has iterated on interruption handling, connection restart semantics, tool concurrency, and I/O abstraction design. The TypeScript port can incorporate these learnings from day one rather than re-discovering them.

---

## 3. Project Goals

### Primary Goal
Port the bidirectional streaming architecture from the Python SDK to TypeScript, producing a working `BidiAgent` with at least two model providers and flexible I/O support.

### Success Criteria
1. Working `BidiAgent` class with `send()`, `receive()`, and `run()` APIs
2. At least two model providers implemented (Nova Sonic + OpenAI Realtime)
3. I/O abstraction with at least two implementations (WebSocket + text terminal)
4. Concurrent tool execution without blocking the event stream
5. Automatic interruption handling
6. Connection lifecycle management (timeout, restart, graceful shutdown)
7. Published as `@strands-agents/sdk` experimental module (matching Python's graduation path)
8. Documentation + at least one end-to-end example (voice assistant or WebSocket chat)

---

## 4. Technical Design

### 4.1 Module Structure

```
src/experimental/bidi/
├── agent/
│   ├── bidi-agent.ts       # BidiAgent class
│   └── event-loop.ts       # Event processing + tool dispatch
├── models/
│   ├── bidi-model.ts       # BidiModel interface
│   ├── nova-sonic.ts       # Amazon Nova Sonic via AWS SDK
│   └── openai-realtime.ts  # OpenAI Realtime via WebSocket
├── io/
│   ├── types.ts            # BidiInput/BidiOutput interfaces
│   ├── websocket-io.ts     # WebSocket I/O (server + client)
│   └── text-io.ts          # Terminal text I/O (readline)
├── types/
│   ├── events.ts           # All event type definitions
│   └── config.ts           # Configuration interfaces
└── index.ts                # Public API exports
```

### 4.2 Core Interfaces

#### BidiAgent

```typescript
import { Tool } from '@strands-agents/sdk'

export class BidiAgent {
  constructor(config: BidiAgentConfig)

  // Lifecycle
  async start(options?: StartOptions): Promise<void>
  async stop(): Promise<void>

  // Communication
  async send(input: string | BidiInputEvent): Promise<void>
  async *receive(): AsyncGenerator<BidiOutputEvent>

  // Convenience (combines start + I/O wiring + stop)
  async run(options: RunOptions): Promise<void>
}

interface BidiAgentConfig {
  model: BidiModel
  tools?: Tool[]
  systemPrompt?: string
  messages?: Message[]        // conversation history for reconnect
  agentId?: string
  name?: string
  description?: string
}

interface RunOptions {
  inputs: BidiInput[]
  outputs: BidiOutput[]
}
```

#### BidiModel (Provider Interface)

```typescript
export interface BidiModel {
  start(config: BidiModelStartConfig): Promise<void>
  send(event: BidiInputEvent): Promise<void>
  receive(): AsyncGenerator<BidiOutputEvent>
  stop(): Promise<void>
}

interface BidiModelStartConfig {
  systemPrompt: string
  tools: ToolDefinition[]
  messages: Message[]
  providerConfig?: Record<string, unknown>
}
```

#### I/O Interfaces

```typescript
export interface BidiInput {
  start?(agent: BidiAgent): Promise<void>
  (): Promise<BidiInputEvent>    // async callable — produces events
  stop?(): Promise<void>
}

export interface BidiOutput {
  start?(agent: BidiAgent): Promise<void>
  (event: BidiOutputEvent): Promise<void>  // async callable — consumes events
  stop?(): Promise<void>
}
```

### 4.3 Event Types

```typescript
// --- Input Events ---
type BidiInputEvent =
  | BidiTextInputEvent
  | BidiAudioInputEvent
  | BidiImageInputEvent

interface BidiTextInputEvent {
  type: 'bidi_text_input'
  text: string
  role?: 'user' | 'system'
}

interface BidiAudioInputEvent {
  type: 'bidi_audio_input'
  audio: string              // base64 encoded
  format: 'pcm' | 'wav' | 'opus' | 'mp3'
  sampleRate: number         // 16000, 24000, 48000
  channels: number           // 1 or 2
}

interface BidiImageInputEvent {
  type: 'bidi_image_input'
  image: string              // base64 encoded
  mimeType: string           // 'image/jpeg', 'image/png'
}

// --- Output Events ---
type BidiOutputEvent =
  | BidiConnectionStartEvent
  | BidiConnectionRestartEvent
  | BidiConnectionCloseEvent
  | BidiResponseStartEvent
  | BidiResponseCompleteEvent
  | BidiAudioStreamEvent
  | BidiTranscriptStreamEvent
  | BidiInterruptionEvent
  | BidiToolUseStreamEvent
  | BidiUsageEvent
  | BidiErrorEvent

interface BidiAudioStreamEvent {
  type: 'bidi_audio_stream'
  audio: string              // base64 encoded chunk
  format: 'pcm' | 'wav' | 'opus' | 'mp3'
  sampleRate: number
  channels: number
}

interface BidiTranscriptStreamEvent {
  type: 'bidi_transcript_stream'
  delta: string              // incremental text
  text: string               // accumulated text so far
  role: 'user' | 'assistant'
  isFinal: boolean
  currentTranscript: string
}

interface BidiInterruptionEvent {
  type: 'bidi_interruption'
  reason: 'user_speech' | 'error'
}

interface BidiResponseCompleteEvent {
  type: 'bidi_response_complete'
  responseId: string
  stopReason: 'complete' | 'interrupted' | 'tool_use' | 'error'
}

interface BidiToolUseStreamEvent {
  type: 'tool_use_stream'
  currentToolUse: {
    toolUseId: string
    name: string
    input: Record<string, unknown>
  }
}

interface BidiUsageEvent {
  type: 'bidi_usage'
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

interface BidiErrorEvent {
  type: 'bidi_error'
  message: string
  code?: string
  details?: unknown
  error?: Error
}

// Connection lifecycle
interface BidiConnectionStartEvent {
  type: 'bidi_connection_start'
  connectionId: string
  model: string
}

interface BidiConnectionRestartEvent {
  type: 'bidi_connection_restart'
  timeoutError?: Error
}

interface BidiConnectionCloseEvent {
  type: 'bidi_connection_close'
  connectionId: string
  reason: 'client_disconnect' | 'timeout' | 'error' | 'complete' | 'user_request'
}
```

### 4.4 Agent Event Loop

The event loop is the core of `BidiAgent`. It:

1. Receives events from the model connection
2. Detects tool use events
3. Dispatches tool execution concurrently (non-blocking)
4. Sends tool results back to the model
5. Yields all events to the consumer via `receive()`

```typescript
// Simplified event loop logic
async *eventLoop(): AsyncGenerator<BidiOutputEvent> {
  for await (const event of this.model.receive()) {
    // Yield event to consumer
    yield event

    // Handle tool use
    if (event.type === 'tool_use_stream') {
      // Execute tool concurrently — don't await, don't block
      this.executeToolInBackground(event.currentToolUse)
    }

    // Check for stop signal
    if (this.shouldStop()) break
  }
}

private async executeToolInBackground(toolUse: ToolUse): Promise<void> {
  const result = await this.toolRegistry.execute(toolUse.name, toolUse.input)
  // Send result back to model
  await this.model.send({
    type: 'tool_result',
    toolUseId: toolUse.toolUseId,
    result: result
  })
}
```

### 4.5 Connection Lifecycle & Restart

```typescript
class BidiAgent {
  private connectionState: 'created' | 'starting' | 'running' | 'restarting' | 'stopped'
  private sendBlocked: boolean = false

  async start(): Promise<void> {
    this.connectionState = 'starting'
    await this.model.start({
      systemPrompt: this.config.systemPrompt,
      tools: this.toolDefinitions,
      messages: this.messages,
    })
    this.connectionState = 'running'
    this.spawnReceiverTask()
  }

  private async handleTimeout(): Promise<void> {
    this.connectionState = 'restarting'
    this.sendBlocked = true
    this.emit({ type: 'bidi_connection_restart', timeoutError: this.lastError })

    // Restart with conversation history
    await this.model.stop()
    await this.model.start({
      systemPrompt: this.config.systemPrompt,
      tools: this.toolDefinitions,
      messages: this.messages,  // replay history
    })

    this.sendBlocked = false
    this.connectionState = 'running'
    this.spawnReceiverTask()
  }
}
```

### 4.6 Model Providers

#### Nova Sonic (via AWS SDK)

Uses the AWS Bedrock streaming SDK (`@aws-sdk/client-bedrock-runtime` with bidirectional event streams).

```typescript
export class BidiNovaSonicModel implements BidiModel {
  private client: BedrockRuntimeClient
  private stream: AsyncIterable<BidiStreamEvent>

  constructor(config?: NovaSonicConfig) {
    this.client = new BedrockRuntimeClient({
      region: config?.region ?? 'us-east-1',
    })
  }

  async start(config: BidiModelStartConfig): Promise<void> {
    // Open bidirectional stream via InvokeModelWithBidirectionalStream
    // Send system prompt, tool definitions, conversation history
    // Spawn receiver for incoming events
  }

  async send(event: BidiInputEvent): Promise<void> {
    // Convert to Nova Sonic wire format, write to stream
  }

  async *receive(): AsyncGenerator<BidiOutputEvent> {
    // Read from stream, normalize to BidiOutputEvent types
  }

  async stop(): Promise<void> {
    // Close stream, cleanup
  }
}
```

Timeout: 8 minutes (auto-restart required).

#### OpenAI Realtime (via WebSocket)

Uses WebSocket connection to OpenAI's Realtime API.

```typescript
export class BidiOpenAIRealtimeModel implements BidiModel {
  private ws: WebSocket
  private apiKey: string

  constructor(config?: OpenAIRealtimeConfig) {
    this.apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY
  }

  async start(config: BidiModelStartConfig): Promise<void> {
    // Connect to wss://api.openai.com/v1/realtime
    // Send session.create with tools, instructions
    // Send conversation history
  }

  async send(event: BidiInputEvent): Promise<void> {
    // Convert to OpenAI wire format (input_audio_buffer.append, etc.)
  }

  async *receive(): AsyncGenerator<BidiOutputEvent> {
    // Receive OpenAI events, normalize to BidiOutputEvent
  }
}
```

Timeout: 60 minutes.

### 4.7 I/O Implementations

#### WebSocket I/O (Primary — web applications)

The most important I/O for TypeScript. Enables browser-based voice/text agents.

```typescript
import { WebSocket } from 'ws'

export function createWebSocketInput(ws: WebSocket): BidiInput {
  return async () => {
    const data = await new Promise<string>((resolve) => {
      ws.once('message', (msg) => resolve(msg.toString()))
    })
    return JSON.parse(data) as BidiInputEvent
  }
}

export function createWebSocketOutput(ws: WebSocket): BidiOutput {
  return async (event: BidiOutputEvent) => {
    ws.send(JSON.stringify(event))
  }
}
```

#### Text I/O (Development/debugging)

```typescript
import * as readline from 'readline'

export function createTextInput(prompt = '> '): BidiInput {
  const rl = readline.createInterface({ input: process.stdin })
  return async () => {
    const text = await new Promise<string>((resolve) => {
      rl.question(prompt, resolve)
    })
    return { type: 'bidi_text_input', text, role: 'user' }
  }
}

export function createTextOutput(): BidiOutput {
  return async (event: BidiOutputEvent) => {
    if (event.type === 'bidi_transcript_stream' && event.isFinal) {
      console.log(`Assistant: ${event.text}`)
    }
  }
}
```

### 4.8 TypeScript-Specific Design Decisions

| Decision | Python approach | TypeScript approach | Rationale |
|----------|---------------|--------------------|-----------| 
| Async primitives | `asyncio` tasks, `asyncio.Queue` | `AsyncGenerator`, `Promise`, event emitters | Idiomatic to each runtime |
| I/O abstraction | Class with `__call__` | Function (callable) or object with `call()` | Functions are more natural in TS |
| Audio I/O | PyAudio (cross-platform native) | **Not included in v1** — WebSocket I/O instead | Node.js audio libraries are fragile; browser handles audio natively. Web Audio API for browser-side playback. |
| Event typing | Dataclasses with `type` field | Discriminated unions (`type` literal) | Native TypeScript pattern for exhaustive matching |
| Connection management | `asyncio.Task` + `asyncio.Event` | `AbortController` + `Promise` | Native Node.js patterns |

**Key difference from Python: No native audio I/O in v1.** Python uses PyAudio for local mic/speaker access. In TypeScript/Node.js, audio libraries are fragile and platform-dependent. Instead, the TypeScript SDK focuses on **WebSocket I/O** — the browser handles audio capture/playback natively via Web Audio API, and communicates with the Strands agent over WebSocket. This is the more common deployment pattern for TypeScript anyway (server-side agent, browser-side audio).

---

## 5. Evaluation Plan

### 5.1 Functional Validation

| Test | What it validates | Pass criteria |
|------|-------------------|---------------|
| Text conversation | Basic send/receive cycle | Agent responds to text input |
| Multi-turn | Conversation history preserved | Agent references earlier turns |
| Tool execution | Concurrent tool dispatch | Tool runs without blocking event stream |
| Multiple tools | Concurrent multiple tools | Two tools execute simultaneously |
| Interruption | Mid-response interruption | Agent stops generating, accepts new input |
| Timeout restart | Connection recovery | Agent restarts, replays history, continues |
| Graceful shutdown | Clean lifecycle | No hanging promises, no resource leaks |
| WebSocket I/O | Browser-to-agent communication | Events flow both directions over WS |
| Provider: Nova Sonic | AWS Bedrock integration | Audio events stream correctly |
| Provider: OpenAI | OpenAI Realtime integration | Audio events stream correctly |

### 5.2 Performance Metrics

| Metric | Target | How measured |
|--------|--------|-------------|
| Time-to-first-audio | <500ms after user stops speaking | Timestamp delta in event stream |
| Event throughput | >100 events/second | Sustained streaming benchmark |
| Tool execution overhead | <50ms added latency | Compare with/without tools |
| Memory stability | No leaks over 1hr session | Heap snapshot comparison |
| Reconnect time | <2s from timeout to ready | Timestamp delta on restart events |

### 5.3 Parity Checklist (vs. Python SDK)

| Feature | Python | TypeScript (target) |
|---------|--------|-------------------|
| BidiAgent core | Yes | Yes |
| Nova Sonic provider | Yes | Yes |
| OpenAI Realtime provider | Yes | Yes |
| Gemini Live provider | Yes | Stretch goal |
| Audio I/O (native) | Yes (PyAudio) | No (browser-side via WebSocket) |
| Text I/O | Yes | Yes |
| WebSocket I/O | Community example | First-class |
| Tool concurrency | Yes | Yes |
| Interruptions | Yes | Yes |
| Connection restart | Yes | Yes |
| Hooks | Yes | Yes |
| Multi-agent | No (planned) | No (future) |

---

## 6. Timeline

### Phase 1: Foundation (Weeks 1-3)

**Week 1: Orientation + Core Types**
- Read Python bidi implementation in detail (agent, loop, models, io, events)
- Study the TypeScript SDK's existing architecture (Agent class, tool registration, hooks, streaming)
- Define all TypeScript event types (discriminated unions)
- Define `BidiModel`, `BidiInput`, `BidiOutput` interfaces
- Scaffold module structure

**Week 2: BidiAgent Core**
- Implement `BidiAgent` class (constructor, lifecycle state machine)
- Implement event loop (receive from model, yield to consumer, detect tool use)
- Implement concurrent tool dispatch (non-blocking background execution)
- Implement `send()` / `receive()` / `run()` APIs
- Unit tests with mock model

**Week 3: Connection Lifecycle**
- Implement connection state management (created → started → running → stopped)
- Implement timeout detection and automatic restart
- Implement send-blocking during restart
- Implement conversation history replay on reconnect
- Implement graceful shutdown (`stop()`, `AbortController` integration)
- Integration tests with mock model

### Phase 2: Providers + I/O (Weeks 4-6)

**Week 4: Nova Sonic Provider**
- Implement `BidiNovaSonicModel` using `@aws-sdk/client-bedrock-runtime`
- Handle Nova Sonic's bidirectional event stream protocol
- Map Nova Sonic events to `BidiOutputEvent` types
- Handle 8-minute timeout and restart
- End-to-end test: text conversation via Nova Sonic

**Week 5: OpenAI Realtime Provider**
- Implement `BidiOpenAIRealtimeModel` using WebSocket
- Handle OpenAI Realtime API protocol (session.create, input_audio_buffer, etc.)
- Map OpenAI events to `BidiOutputEvent` types
- Handle 60-minute timeout
- End-to-end test: text conversation via OpenAI Realtime

**Week 6: I/O Implementations**
- Implement WebSocket I/O (primary — for web applications)
- Implement Text I/O (for development/debugging)
- Build example: FastAPI-style HTTP server with WebSocket upgrade
- Build example: Express/Fastify server with WebSocket bidi agent
- End-to-end test: browser client ↔ WebSocket ↔ BidiAgent ↔ model

### Phase 3: Features + Hardening (Weeks 7-9)

**Week 7: Interruptions + Audio**
- Implement interruption handling (detect `BidiInterruptionEvent`, clear buffers)
- Implement audio event passthrough (base64 chunks between model and WebSocket client)
- Test with real audio: browser captures mic → WebSocket → agent → model → audio response → WebSocket → browser plays
- Handle echo, buffering, and timing edge cases

**Week 8: Integration + Hooks**
- Integrate with SDK hook system (lifecycle events, tool events)
- Add usage tracking (`BidiUsageEvent` surfacing)
- Test with complex tool scenarios (multiple concurrent tools, long-running tools)
- Performance testing: sustained streaming, memory leak detection
- Error handling: network failures, model errors, malformed events

**Week 9: Documentation + Examples**
- Write API documentation for all public interfaces
- Build complete example: voice assistant (browser + server)
- Build complete example: WebSocket text chat
- Write migration guide: "Standard Agent vs BidiAgent — when to use which"
- Write provider guide: Nova Sonic vs OpenAI Realtime comparison

### Phase 4: Polish (Week 10)

**Week 10: Ship It**
- Final code review and cleanup
- Comprehensive test suite (unit + integration + e2e)
- Publish as experimental module in SDK
- Open PR, address feedback
- Present to team: demo of working voice assistant

---

## 7. Key Research Questions

1. **What's the right async primitive?** Node.js doesn't have Python's `asyncio.Queue`. Options: `AsyncGenerator` with backpressure, `EventEmitter` with typed events, or a custom async queue. Which gives the best DX while handling backpressure correctly?

2. **How should audio flow in TypeScript?** Python uses PyAudio for native mic/speaker. The TypeScript path is WebSocket → browser Web Audio API. But what about server-side audio (e.g., telephony integrations, Twilio)? Should there be a `NodeAudioIO` using something like `node-portaudio`, or is WebSocket always the right abstraction?

3. **How do interruptions work across the WebSocket boundary?** When the model detects user speech and fires `BidiInterruptionEvent`, the server needs to notify the browser to stop playback immediately. WebSocket latency matters here. Is there a protocol design that minimizes perceived interruption lag?

4. **Should `BidiAgent` extend `Agent`?** In Python, `BidiAgent` is a separate class. Should the TypeScript version extend the base `Agent` (inheriting tool registration, hooks, etc.) or be a peer class that shares interfaces? Extending provides code reuse; separating avoids coupling to the request-response lifecycle.

5. **How does connection restart interact with tool execution?** If a tool is mid-execution when timeout occurs and the connection restarts, what happens to the tool result? Does it get sent after reconnect? Dropped? This needs careful state management.

6. **What's the testing strategy for real-time streaming?** Unit testing async generators and WebSocket interactions is notoriously tricky. What test infrastructure makes this reliable and fast? Mock WebSocket servers? Recorded event playback?

---

## 8. Resources

### Strands Documentation
- [Bidirectional Streaming — Agent](https://strandsagents.com/docs/user-guide/concepts/bidirectional-streaming/agent/)
- [Bidirectional Streaming — Events](https://strandsagents.com/docs/user-guide/concepts/bidirectional-streaming/events/)
- [Bidirectional Streaming — I/O](https://strandsagents.com/docs/user-guide/concepts/bidirectional-streaming/io/)
- [Bidirectional Streaming — Quickstart](https://strandsagents.com/docs/user-guide/concepts/bidirectional-streaming/quickstart/)

### GitHub Issues
- [sdk-typescript#869](https://github.com/strands-agents/sdk-typescript/issues/869) — Feature request for bidi streaming in TS
- [sdk-python#1722](https://github.com/strands-agents/sdk-python/issues/1722) — Epic: Move bidi out of experimental
- [sdk-python#1727](https://github.com/strands-agents/sdk-python/issues/1727) — WebSocketIO for bidi
- [sdk-python#1724](https://github.com/strands-agents/sdk-python/issues/1724) — WebRTC support
- [sdk-python#1728](https://github.com/strands-agents/sdk-python/issues/1728) — Multi-agent bidi

### Reference Implementations
- Python SDK: `src/strands/experimental/bidi/` — complete reference architecture
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) — WebSocket protocol docs
- [Amazon Nova Sonic](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-nova-sonic.html) — Bedrock bidi stream docs
- [Google Gemini Live](https://ai.google.dev/gemini-api/docs/live) — Gemini streaming API

### Related TypeScript SDK Issues
- [sdk-typescript#1031](https://github.com/strands-agents/sdk-typescript/issues/1031) — SSE streaming helpers
- [sdk-typescript#1030](https://github.com/strands-agents/sdk-typescript/issues/1030) — Stream helper utilities
- [sdk-typescript#347](https://github.com/strands-agents/sdk-typescript/issues/347) — AG-UI protocol integration

---

## 9. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Nova Sonic SDK doesn't expose bidi streams cleanly in JS | Medium | High | Check AWS SDK v3 for JS bidi stream support early (week 1). If blocked, start with OpenAI Realtime (pure WebSocket, no SDK dependency). |
| Async complexity leads to race conditions | High | Medium | Use `AbortController` for cancellation. Write extensive concurrent tests. Study Python implementation's race condition fixes. |
| Audio latency issues over WebSocket | Medium | Medium | Focus on protocol design that minimizes buffering. Test with real audio early (week 7). Document acceptable latency bounds. |
| Python API is still changing (experimental) | Medium | Low | Design TypeScript API independently using Python as inspiration, not a direct port. Both can converge at GA. |
| Browser audio handling is complex | Low | Low | Out of scope for SDK — provide a reference client-side example but don't own browser code. The SDK owns server-side. |
| Scope creep into WebRTC, video, multi-agent | Medium | Medium | Explicitly out of scope for v1. These are tracked as future work in the Python SDK (issues #1723, #1724, #1728). |

---

## 10. What "Done" Looks Like

At the end of 10 weeks, the intern delivers:

1. **Working `BidiAgent` module** — published as experimental in `@strands-agents/sdk` with full TypeScript types
2. **Two model providers** — Nova Sonic + OpenAI Realtime, both passing integration tests
3. **WebSocket + Text I/O** — first-class WebSocket support for web applications, text I/O for development
4. **Concurrent tool execution** — tools run without blocking the event stream
5. **Connection lifecycle** — timeout handling, automatic restart, graceful shutdown
6. **Interruption support** — model and client-side interruption handling
7. **End-to-end examples** — voice assistant (browser + server) and WebSocket text chat
8. **Documentation** — API docs, quickstart guide, provider comparison
9. **Test suite** — unit + integration + e2e covering all major scenarios
10. **A presentation** — live demo of a voice assistant built with the TypeScript bidi module

---

## Appendix A: Example — WebSocket Voice Assistant

```typescript
// server.ts
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { BidiAgent, BidiNovaSonicModel, createWebSocketInput, createWebSocketOutput } from '@strands-agents/sdk/experimental/bidi'

const wss = new WebSocketServer({ port: 8080 })

wss.on('connection', async (ws: WebSocket) => {
  const model = new BidiNovaSonicModel({
    providerConfig: {
      audio: { inputRate: 16000, outputRate: 16000, voice: 'matthew' }
    }
  })

  const agent = new BidiAgent({
    model,
    tools: [calculator, weather],
    systemPrompt: 'You are a helpful voice assistant. Keep responses concise.',
  })

  await agent.run({
    inputs: [createWebSocketInput(ws)],
    outputs: [createWebSocketOutput(ws)],
  })
})
```

```html
<!-- client.html (simplified) -->
<script>
const ws = new WebSocket('ws://localhost:8080')
const audioCtx = new AudioContext({ sampleRate: 16000 })

// Capture microphone
const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
const source = audioCtx.createMediaStreamSource(stream)
const processor = audioCtx.createScriptProcessor(512, 1, 1)

processor.onaudioprocess = (e) => {
  const pcm = e.inputBuffer.getChannelData(0)
  const base64 = arrayBufferToBase64(float32ToPCM16(pcm))
  ws.send(JSON.stringify({
    type: 'bidi_audio_input',
    audio: base64,
    format: 'pcm',
    sampleRate: 16000,
    channels: 1
  }))
}
source.connect(processor)
processor.connect(audioCtx.destination)

// Play audio responses
ws.onmessage = (msg) => {
  const event = JSON.parse(msg.data)
  if (event.type === 'bidi_audio_stream') {
    playAudioChunk(base64ToArrayBuffer(event.audio))
  }
  if (event.type === 'bidi_interruption') {
    stopPlayback()  // immediately clear audio queue
  }
}
</script>
```

---

## Appendix B: Provider Protocol Comparison

| Aspect | Nova Sonic | OpenAI Realtime |
|--------|-----------|----------------|
| Transport | AWS SDK bidi stream | WebSocket |
| Auth | AWS SigV4 (IAM credentials) | API key in header |
| Audio input format | PCM 16-bit, 16kHz | PCM 16-bit, 24kHz |
| Audio output format | PCM 16-bit, 16kHz or 24kHz | PCM 16-bit, 24kHz |
| Session timeout | 8 minutes | 60 minutes |
| Voice options | matthew, ruth | alloy, echo, fable, onyx, nova, shimmer |
| Tool calling | Supported | Supported |
| Interruption | Native (barge-in detection) | Native (server VAD) |
| Pricing model | Per-second audio | Per-token (audio tokens) |
| Max concurrent tools | Unlimited | Unlimited |
