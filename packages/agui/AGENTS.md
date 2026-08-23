# AG-UI Bridge

Package: `@iloveagents/foundry-voice-live-agui`

## Purpose

Bridge a Voice Live session to the [AG-UI](https://github.com/ag-ui-protocol/ag-ui) protocol: a
spoken turn becomes a standard AG-UI run (`RUN_STARTED` … `RUN_FINISHED`) that any AG-UI consumer
can render. Transport-agnostic (WebSocket and WebRTC), no agent-UI framework required, plus a
`doctor` that checks whether an AG-UI endpoint is fit to drive voice.

## Commands

```bash
pnpm --filter @iloveagents/foundry-voice-live-agui run build      # tsup (ESM+CJS, dts, CLI bin)
pnpm --filter @iloveagents/foundry-voice-live-agui run test       # vitest
pnpm --filter @iloveagents/foundry-voice-live-agui run typecheck  # tsc --noEmit
```

## Structure

```text
core/    Pure, React/rxjs/DOM-free — importable in bare Node
  mapper.ts        VoiceLiveAguiMapper: Voice Live server events → AG-UI events
  runPolicy.ts     RunPolicy: where an AG-UI run/step begins and ends (one turn cluster = one run)
  voiceState.ts    VoiceState reducer + toAguiState + JSON-patch deltas
  verify.ts        verifyRun/verifyStream: mirror of @ag-ui/client's verifyEvents (used by tests)
  ids.ts           map item_id → messageId, call_id → toolCallId
  customEvents.ts  voice.* CUSTOM event names + payload types
agent/   VoiceLiveAgent: a client-side AG-UI AbstractAgent (never HttpAgent)
react/   useVoiceLiveAgent + useVoiceLiveAgentBinding
doctor/  probeEndpoint + formatReport + the CLI (`foundry-voice-live-agui doctor <url>`)
```

## Key Concepts

- **Extends `AbstractAgent`, never `HttpAgent`.** CopilotKit special-cases `instanceof HttpAgent`;
  the agent is a plain AbstractAgent so it renders in CopilotKit or any AG-UI UI — or, as in the
  `/agui-voice` example, with your own React (read `agent.messages` / `agent.state.voice` /
  `agent.events$`).
- **Self-pumped, cluster-scoped runs.** A voice turn is server-initiated (nobody calls `runAgent`).
  The glue feeds server events into the agent; when the mapper opens a run, the glue calls
  `agent.pump()`, which calls `runAgent()`. A run is one **turn cluster** (opens on
  `speech_started` / a transcription delta / `response.created`; closes on a tool-less
  `response.done`); responses inside are `STEP_*`.
- **ReplaySubject per run.** A short turn can open and close before the pump's `runAgent()`
  subscribes; each run is a ReplaySubject so a late subscriber replays the whole run and its
  completion. Miss this and the first short answer of a session vanishes.
- **Force-close closes the step first.** Barge-in / cancel / error / idle close the open STEP before
  the terminal event — the AG-UI runtime rejects `RUN_FINISHED` while a step is open. `verify.ts`
  tracks step balance so a regression can't slip through.
- **Transport-agnostic.** The mapper consumes the same `onEvent` stream for WebSocket and WebRTC.
  WebRTC delivers function-call events on a separate channel, so a function-call event opens a run
  if `response.created` has not arrived yet, and `response.done` can precede its tool-call args (the
  run policy keeps the run open until the calls are answered — covered by `runPolicy.fuzz.test.ts`).
- **Tool results.** Voice Live never echoes `function_call_output`, so the React binding forwards a
  tool result into the agent (`tool_result` / `tool_error` host events) from both the wrapped
  `toolExecutor` and the wrapped `sendToolResult`, so the tool cluster closes.
- **doctor.** No official AG-UI conformance checker exists. `probeEndpoint` POSTs a minimal
  `RunAgentInput`, reads the raw SSE, verifies ordering (naming the offending event), checks
  server-side thread memory (a follow-up-only second run), and prints a `ready`/`usable`/`unfit`
  verdict; the CLI exits non-zero when unfit.

## House rules

- `core/` must stay React-, rxjs-, and DOM-free. rxjs lives only in `agent/`.
- Every mapper test pipes its output through `verifyStream` — the emitted stream must be legal AG-UI.
- `@ag-ui/client`, `rxjs`, `react`, and the Voice Live SDK are **peer** dependencies (singletons, so
  observables and `instanceof` interoperate). `@ag-ui/core` is a direct dependency.
- The CLI is a `bin` and gets no `.d.ts` (see `tsup.config.ts` `dts.entry`).
- Ship `.prettierignore` so `format:check` does not scan `dist/` (CI runs `pnpm -r run format:check`).
