# @iloveagents/foundry-voice-live-agui

Bridge a Microsoft **Foundry Voice Live** session to the **[AG-UI](https://github.com/ag-ui-protocol/ag-ui) protocol** — so a spoken turn becomes a standard AG-UI run (`RUN_STARTED` → `TEXT_MESSAGE_*` → `TOOL_CALL_*` → `RUN_FINISHED`) that any AG-UI consumer can render.

It is transport-agnostic (WebSocket **and** WebRTC), needs no agent-UI framework to render, and ships a **doctor** that tells you whether an AG-UI endpoint is fit to drive a voice session.

```
core/    pure mapper + run policy + voice-state (no React, no rxjs, no DOM)
agent/   VoiceLiveAgent — a client-side AG-UI AbstractAgent driven by the session
react/   useVoiceLiveAgent + useVoiceLiveAgentBinding
doctor/  endpoint conformance + voice-readiness probe (also the CLI bin)
```

## Install

```bash
pnpm add @iloveagents/foundry-voice-live-agui @iloveagents/foundry-voice-live-react @ag-ui/client rxjs
```

`@ag-ui/client`, `rxjs`, `react`, and the Voice Live React SDK are peer dependencies (kept as singletons so rxjs observables and `instanceof` checks interoperate).

## Use it in React

`useVoiceLiveAgent` builds the agent; `useVoiceLiveAgentBinding` runs a Voice Live session and streams every server event into it as AG-UI events. The agent is a standard `AbstractAgent`, so you can render it with your own UI (below) or hand it to any AG-UI-compatible chat UI.

```tsx
import {
  useVoiceLiveAgent,
  useVoiceLiveAgentBinding,
} from '@iloveagents/foundry-voice-live-agui/react';

function Voice() {
  const agent = useVoiceLiveAgent({ threadId: 'demo' });
  const voice = useVoiceLiveAgentBinding(agent, {
    connection: { proxyUrl: 'wss://your-proxy/ws?model=gpt-realtime' },
    session: { instructions: 'Answer in one or two short sentences.' },
  });

  // Render agent.messages / agent.state.voice however you like, and subscribe to
  // agent.events$ for the raw AG-UI stream. voice.connect() / disconnect() / toggleMute()
  // are the usual Voice Live controls.
  return <button onClick={() => voice.connect()}>Start</button>;
}
```

Switching to WebRTC is one line — `connection: { ..., transport: 'webrtc' }`. The mapper produces the same AG-UI events either way, and it already handles WebRTC's out-of-order case where `response.done` can arrive before its tool-call arguments.

A full working example (transcript, live event stream, transport toggle, offline simulate) is in the repo at `examples/src/pages/AguiVoice.tsx`.

## Bring your own AG-UI backend

Every first-party AG-UI integration (LangGraph, CrewAI, Mastra, Pydantic AI, Microsoft Agent Framework, a hand-rolled handler, …) exposes the same contract: `POST RunAgentInput → SSE of AG-UI events`. Prove yours is voice-ready before wiring it up:

```bash
npx foundry-voice-live-agui doctor https://your-host/agui --bearer $TOKEN
```

It POSTs a minimal `RunAgentInput`, reads the raw SSE, verifies the stream against AG-UI's ordering rules (naming the exact offending event on failure), and prints a report: text streaming, tool events, state, interrupts, keepalives, first-token latency, thread continuity, and a **voice-readiness verdict** (`ready` / `usable` / `unfit`). Exit code is `0` when the endpoint is a valid AG-UI stream with assistant text, so it drops into CI and a proxy healthcheck unchanged.

```ts
import { probeEndpoint, formatReport } from '@iloveagents/foundry-voice-live-agui/doctor';

const report = await probeEndpoint({ url, headers });
console.log(formatReport(report));
```

## Entry points

| Import                                 | Contents                                                      |
| -------------------------------------- | ------------------------------------------------------------- |
| `@iloveagents/foundry-voice-live-agui` | core + `VoiceLiveAgent` (no React)                            |
| `.../core`                             | mapper, run policy, voice-state, id helpers (React/rxjs-free) |
| `.../react`                            | `useVoiceLiveAgent`, `useVoiceLiveAgentBinding`               |
| `.../doctor`                           | `probeEndpoint`, `formatReport`                               |

## License

MIT
