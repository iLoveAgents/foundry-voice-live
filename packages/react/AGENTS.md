# React SDK

Package: `@iloveagents/foundry-voice-live-react` — the browser/React layer for Microsoft Foundry Voice Live API (`2026-07-15` GA).

## Exports

| Export | Type | Description |
| ------ | ---- | ----------- |
| `useVoiceLive` | Hook | Voice Live session (WebSocket or WebRTC transport, agents, tools, transcripts, auto-reconnect) |
| `useAudioCapture` | Hook | Microphone capture → PCM16 (WebSocket transport) |
| `VoiceLiveAvatar` | Component | Avatar rendering with WebGL chroma key |
| `sessionConfig()` / `with*()` | Helpers | Fluent + functional session configuration |
| `buildSessionConfig` / `buildAgentSessionConfig` / `convertToSessionUpdate` | Utils | camelCase config → wire format |
| `buildVoiceLiveUrl`, `buildGreetingEvents`, `createLogger`, constants | Utils | Pure helpers |
| `VoiceLiveServerEvent`, `VoiceLiveClientEvent`, … | Types | Typed wire-format events |
| `WebSocketTransport`, `WebRtcTransport`, `OutputAudioGraph`, `PcmPlayer`, `AvatarConnection`, `WebRtcMicrophone` | Core (advanced) | Framework-agnostic building blocks the hook is made of |

## Commands

```bash
just build-react      # Build package
just test-react       # Run tests
just watch-react      # Watch mode
```

## Structure

```text
core/           # Framework-agnostic (no React import):
  lifecycle.ts  #   Scope: the ONE staleness/teardown primitive (connection + session lifetimes)
  responseGate.ts#  ResponseGate: response.create serialization state machine
  transports/   #   types.ts (VoiceLiveTransport interface), websocketTransport.ts, webrtcTransport.ts
  audioOutput.ts#   OutputAudioGraph (context/gain/analyser) + PcmPlayer (AudioWorklet playback)
  playbackWorklet.ts, avatarConnection.ts, microphone.ts (WebRtcMicrophone), reconnect.ts, serverEvents.ts
hooks/          # useVoiceLive (React binding: state, protocol semantics, tools, greeting, reconnect),
                # useAudioCapture, testFakes (tests only)
components/     # VoiceLiveAvatar
utils/          # constants, sessionBuilder, configHelpers, connectionUrl, webrtcTransport (pure RTC helpers),
                # greeting, logger, chromaKey, audioHelpers (+ *.test.ts, protocolContract.test.ts)
types/          # voiceLive.ts (config/session types), events.ts (wire events), index.ts
presets/        # createVoiceLiveConfig
index.ts        # Public API
```

Tests: `core/*.test.ts` (transports, audio, avatar, mic, reconnect), `hooks/useVoiceLive*.test.tsx`
(websocket, webrtc, reconnect), `hooks/useAudioCapture.test.tsx`, `components/VoiceLiveAvatar.test.tsx`,
`utils/*.test.ts` incl. the protocol contract test — all with the fake browser APIs in `hooks/testFakes.ts`.

## Key Concepts

- **Transports** implement `core/transports/types.ts` (`connect`/`send`/`close`/`setMicrophoneTrack`,
  callbacks `onOpen`/`onEvent`/`onClose`/`onError`/`onReady`/`onRemoteStream`) and deliver *parsed*
  events. `WebSocketTransport`: PCM16 + events over one socket. `WebRtcTransport`: control WS on
  `/voice-live/realtime/calls`, `rtc.call.sdp.create` with the session embedded (no `session.update`),
  answer applied on `rtc.call.sdp.created`, negotiation timeout, readiness = media connected + data
  channel open (2 s fallback), `event_id` de-dup across channels, mic via `sender.replaceTrack`.
  The hook creates one transport per connection attempt; callbacks from stale transports/generations
  are ignored (`connectIdRef` + identity check).
- **Reconnect** (`reconnect` option, off by default): on an unexpected close (`isReconnectableClose`)
  the hook keeps the `OutputAudioGraph`, flushes playback, schedules `openConnection(..., 'reconnect')`
  with `computeBackoffDelay`, sets `connectionState: 'reconnecting'`, re-attaches the mic track
  (WebRTC) and does not resend the greeting (`greetingSentRef`). `connection.getToken` is awaited on
  every attempt.
- **Agent mode** is auto-detected from `agentName` (connection config or proxy URL params) or forced via
  `agentMode`; `buildAgentSessionConfig()` strips the agent-owned fields listed in `AGENT_OWNED_FIELDS`
  (`instructions`, `temperature`, `tools`, `toolChoice`, `maxResponseOutputTokens`, `reasoningEffort`,
  `parallelToolCalls`), sends no default voice (the agent's portal voice wins), and `updateSession()` is agent-aware.
- **Readiness/WebRTC quirks**: the control channel is only served on api-version `2026-01-01-preview`
  (`DEFAULT_WEBRTC_API_VERSION`); `isReady` waits for the data channel to open (some events arrive on both
  channels and are de-duplicated by `event_id`); the greeting is sent once `isReady`. Mic constraints for both
  transports come from `buildMicConstraints()` in `utils/audioHelpers.ts`.
- **Auth**: direct connections use the documented query params (`api-key`, or `Authorization=Bearer <token>`);
  proxy URLs are passed through untouched (`?token=` is lifted into a header by the proxy).
- **Wire format** lives in `utils/sessionBuilder.ts` (`convertToSessionUpdate`) and `utils/greeting.ts`;
  event names/shapes in `types/events.ts`. `utils/protocolContract.test.ts` verifies both against Microsoft's
  `@azure/ai-voicelive` (devDependency only; it declares `engines: node >=22`, hence Node 22 for dev/CI).
  Update the allow-list there when Microsoft's enums catch up.
- **Two lifetimes, one mechanism — `Scope` (`core/lifecycle.ts`).** Anything awaited
  (`getUserMedia`, avatar SDP, tool executors, worklet loading) can resolve after the work it
  belonged to has ended. Capture the scope *before* the await and check `scope.isActive` after —
  do **not** add another counter or boolean flag for this; that sprawl was the bug.
  - `connectionScopeRef` — `connect()` → `disconnect()`, survives reconnects (microphone, audio graph)
  - `sessionRef.current.scope` — one control channel / one server-side conversation, replaced per
    (re)connect attempt (response + tool-call ids, readiness). It is a child of the connection
    scope, so `disconnect()` ends both; use `scope.onAbort()` for cleanup instead of manual clears.
  Identity checks go against the record (`sessionRef.current !== session`), not against numbers.
- **`response.create` is serialized by `ResponseGate` (`core/responseGate.ts`)**, a three-state
  machine (`idle → requested → active`): the service rejects overlapping responses and
  `response.created` alone cannot tell you a request is in flight. Never send `response.create`
  outside the gate.
- **Automatic tool results are batched per response** (`toolBatchesRef`, keyed by `response_id`
  and scoped to the session record): outputs are sent with `triggerResponse: false`; the single
  `response.create` waits for **both** `response.done` *and* the last executor, and goes through
  `ResponseGate` like every other turn. A late result belongs to the live conversation only if
  `sessionRef.current === session && session.scope.isActive`.
- **Terminal failures must close the transport**, not just report `onError`: state `'open'` blocks
  both `connect()` and the reconnect policy. Close codes: `4001` reconnect setup, `4002` connect
  timeout, `4008` negotiation timeout, `4009` SDP answer, `4010` `rtc.call.error`, `4011` peer
  connection `failed`. (`'disconnected'` is *not* terminal — it can recover.)
- **Consumer callbacks go through `safeCall`**: a throwing `onEvent`/`onTranscript`/`onReconnecting`
  must never abort our own handling or strand the state machine.
- `validateConfig()` returns warnings (never throws); the hook logs them before connecting.
- Logging goes through `createLogger(logLevel)`; default `'warn'` — never `console.log` directly.
- `sessionConfig()` builder output works in both standard and agent modes.

## Design

- Layered: `core/` (framework-agnostic classes, unit-tested with fakes) → `hooks/useVoiceLive` (React
  state + protocol semantics) → `components/`. Put transport/media mechanics in `core/`, protocol
  semantics (what to do on `session.updated`, tool calls, greeting) in the hook.
- Zero runtime dependencies (peer deps: React only)
- Tree-shakeable ESM and CommonJS dual exports
- WebGL chroma key processing for avatar transparency
- Event-driven architecture matching the Voice Live protocol (typed events)

## Adding Features

1. Add types in `types/` (config in `voiceLive.ts`, wire events in `events.ts`)
2. Implement in `core/` (transport/media), `hooks/`, `components/`, or `utils/` (keep protocol shaping in pure utils)
3. Export from `index.ts`
4. Add tests — and extend `protocolContract.test.ts` when touching wire format or event names
5. Update README (+ CHANGELOG)

## Example

```tsx
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { connectionState, connect, disconnect, audioStream } = useVoiceLive({
    connection: { resourceName: 'my-resource', apiKey: 'dev-key', transport: 'webrtc' },
    session: { instructions: 'You are helpful.' },
    onTranscript: (role, text, isFinal) => console.log(role, text, isFinal),
    toolExecutor: async (name, args) => ({ ok: true }), // returned value is sent automatically
    logLevel: 'debug',
  });

  return (
    <>
      <button onClick={connectionState === 'connected' ? disconnect : connect}>{connectionState}</button>
      <audio ref={(el) => el && audioStream && (el.srcObject = audioStream)} autoPlay />
    </>
  );
}
```
