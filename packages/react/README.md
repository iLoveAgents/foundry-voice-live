<p align="center">
  <a href="https://iloveagents.ai">
    <img src="https://raw.githubusercontent.com/iLoveAgents/foundry-voice-live/main/.github/images/iloveagents-foundry-voice-banner.png" alt="Foundry Voice Live" width="800" />
  </a>
</p>

# Foundry Voice Live React SDK

[![CI](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml/badge.svg)](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-react.svg)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-react)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**React hooks and components for [Microsoft Foundry Voice Live API](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live).** Build real-time voice AI apps with a production-grade browser audio pipeline, WebRTC or WebSocket transport, Foundry agents, MCP tools, interim responses, Azure video avatars, Live2D / 3D avatars, audio visualizers, function calling and full TypeScript types — with **zero runtime dependencies**.

Targets Voice Live API **`2026-07-15` (GA)**. The wire format is contract-tested against Microsoft's official `@azure/ai-voicelive` SDK on every build.

## Install

```bash
npm install @iloveagents/foundry-voice-live-react
```

## Which setup do I need?

| You want… | Transport | Auth | Start here |
| --- | --- | --- | --- |
| Voice in the browser, lowest latency, no avatar | `transport: 'webrtc'` (preview) | proxy (any) or direct token/key | [WebRTC Transport](#webrtc-transport-preview) |
| Voice + Azure video avatar, visemes, word timestamps, custom playback | `websocket` (default) | proxy (any) or direct token/key | [With Avatar](#with-avatar) |
| Foundry agent built in the portal | either | proxy + `DefaultAzureCredential`, or per-user Entra token | [Foundry Agent Service](#foundry-agent-service) |
| Production deployment | either | **proxy** — keys/identity stay server-side | [Production](#production) |
| Local hacking with an API key | either | `connection.apiKey` (dev only) | [Voice Only](#voice-only) |
| Flaky networks / mobile | either | any | `reconnect: true` — see [Auto-Reconnect](#auto-reconnect) |

## Quick Start

> **Region Availability:** `gpt-realtime` and `azure-realtime` are only available in a few regions (e.g. **East US 2**, **Sweden Central**). See the [Voice Live overview](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live#supported-models-and-regions) for current availability.

### Voice Only

```tsx
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { connect, disconnect, connectionState, audioStream } = useVoiceLive({
    connection: {
      resourceName: 'your-foundry-resource',  // Microsoft Foundry resource name
      apiKey: 'your-foundry-api-key',         // For dev only - see "Production" below
    },
    session: {
      instructions: 'You are a helpful assistant.',
    },
  });

  return (
    <>
      <p>Status: {connectionState}</p>
      <button onClick={connect} disabled={connectionState === 'connected'}>Start</button>
      <button onClick={disconnect} disabled={connectionState !== 'connected'}>Stop</button>
      <audio ref={el => { if (el && audioStream) el.srcObject = audioStream; }} autoPlay />
    </>
  );
}
```

Microphone starts automatically when the session is ready. Attach `audioStream` to an `<audio autoPlay>` element (or the `VoiceLiveAvatar` component) to hear the assistant.

### With Avatar

```tsx
import { useVoiceLive, VoiceLiveAvatar } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { videoStream, audioStream, connect, disconnect } = useVoiceLive({
    connection: {
      resourceName: 'your-foundry-resource',
      apiKey: 'your-foundry-api-key',
    },
    session: {
      instructions: 'You are a helpful assistant.',
      voice: { name: 'en-US-AvaMultilingualNeural', type: 'azure-standard' },
      avatar: { character: 'lisa', style: 'casual-sitting' },
    },
  });

  return (
    <>
      <VoiceLiveAvatar videoStream={videoStream} audioStream={audioStream} />
      <button onClick={connect}>Start</button>
      <button onClick={disconnect}>Stop</button>
    </>
  );
}
```

### WebRTC Transport (Preview)

Microsoft recommends WebRTC for browser and mobile clients: audio travels over RTP (UDP) instead of base64-over-WebSocket, which tolerates packet loss and lowers latency. Set `transport: 'webrtc'` — everything else stays the same:

```tsx
const { connect, audioStream, isMuted, toggleMute } = useVoiceLive({
  connection: {
    resourceName: 'your-foundry-resource',
    apiKey: 'your-foundry-api-key',
    transport: 'webrtc',
  },
  session: { instructions: 'You are a helpful assistant.' },
});
// <audio autoPlay srcObject={audioStream}> as before — audioStream is the remote RTP track
```

How it works: the SDK opens a WebSocket control channel to `/voice-live/realtime/calls`, negotiates an `RTCPeerConnection` (`rtc.call.sdp.create` → `rtc.call.sdp.created`), and receives non-audio events (VAD, transcripts, response lifecycle, `output_audio_buffer.started/stopped`) on the `voice-live-events` data channel. `isReady` flips once **both** the media connection and the data channel are up (so a proactive greeting's events are never lost). A few events are delivered on both channels; the SDK de-duplicates them by `event_id`, so `onEvent` sees each once. `onEvent`, `onTranscript`, `sessionState`, `toolExecutor`, `sendText`, … work identically over both transports; tool-call events arrive on the control channel.

Verified live (August 2026) through the proxy with `DefaultAzureCredential`: negotiation completes in ~300 ms, a text turn and a pre-generated greeting play over RTP with transcripts on the data channel; the direct control channel was verified with both an Entra token and an API key.

Limitations (preview):

- Voice only — **avatar is not supported** (`connect()` throws for `session.avatar` + `webrtc`).
- Requires api-version `2026-01-01-preview`; the SDK defaults WebRTC to it (`DEFAULT_WEBRTC_API_VERSION`). Live-verified August 2026: `/calls` is not served on `2026-04-10` (404) or `2026-06-01-preview` (401) — override `connection.apiVersion` once Microsoft ships WebRTC on a newer version.
- Uses global standard deployments (auto-routed to the nearest region).
- Needs UDP. On locked-down networks pass TURN servers via `connection.rtcConfiguration` or fall back to `transport: 'websocket'`.
- No `response.audio.delta` events → visemes / word timestamps and `getAudioPlaybackTime()` are unavailable.
- Auth works exactly like the WebSocket transport (API key, Entra token as `Authorization=Bearer …` query parameter, or proxy) — verified live with both.
- Through the proxy: the SDK appends `transport=webrtc` to `proxyUrl` (proxy ≥ 0.5.0 routes the control channel to `/calls`).

## Production

**Never expose API keys in client-side code.** Use a proxy server to secure your credentials, or short-lived Entra ID tokens.

### 1. Start the Proxy

```bash
# Docker (recommended)
docker run -p 8080:8080 \
  -e FOUNDRY_RESOURCE_NAME=your-foundry-resource \
  -e FOUNDRY_API_KEY="your-api-key" \
  -e ALLOWED_ORIGINS="*" \
  ghcr.io/iloveagents/foundry-voice-live-proxy:latest
```

Or with npx:

```bash
FOUNDRY_RESOURCE_NAME=your-foundry-resource \
FOUNDRY_API_KEY="your-api-key" \
ALLOWED_ORIGINS="*" \
npx @iloveagents/foundry-voice-live-proxy-node
```

> **Note:** `ALLOWED_ORIGINS="*"` is for local development only. In production, set this to your app's origin (e.g., `https://myapp.example.com`). Omit `FOUNDRY_API_KEY` to use keyless auth (`DefaultAzureCredential`, e.g. `az login` or a managed identity).

### 2. Connect from Your App

```tsx
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { connect, disconnect, connectionState, audioStream } = useVoiceLive({
    connection: {
      proxyUrl: 'ws://localhost:8080/ws',  // Proxy handles auth
    },
    session: {
      instructions: 'You are a helpful assistant.',
    },
  });

  return (
    <>
      <p>Status: {connectionState}</p>
      <button onClick={connect}>Start</button>
      <button onClick={disconnect}>Stop</button>
      <audio ref={el => { if (el && audioStream) el.srcObject = audioStream; }} autoPlay />
    </>
  );
}
```

### Foundry Agent Service

Connect to a [Foundry agent](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart) — the agent owns instructions, model, tools and temperature; the client configures audio, voice, transcription, interim responses and avatar:

```tsx
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { connect, disconnect, audioStream } = useVoiceLive({
    connection: {
      proxyUrl: 'ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject',
    },
    session: sessionConfig()
      .voice('en-US-AvaMultilingualNeural')
      .semanticVAD({ interruptResponse: true, autoTruncate: true })
      .interimResponse({ type: 'llm_interim_response', triggers: ['tool', 'latency'] })
      .echoCancellation()
      .noiseReduction()
      .build(),
  });

  return (
    <>
      <button onClick={connect}>Start</button>
      <button onClick={disconnect}>Stop</button>
      <audio ref={el => { if (el && audioStream) el.srcObject = audioStream; }} autoPlay />
    </>
  );
}
```

The proxy authenticates with `DefaultAzureCredential` (or a browser `token` passed in the URL). Agents require Entra ID — API keys are not supported for agent sessions.

In agent mode the SDK strips the agent-owned session fields (`AGENT_OWNED_FIELDS`: `instructions`, `temperature`, `tools`, `toolChoice`, `maxResponseOutputTokens`, `reasoningEffort`, `parallelToolCalls`) from `session.update`, sends no default voice so the agent's portal voice is used unless you set one, and warns when you pass any of the stripped fields — logged, and delivered to `onWarning` with `code: CLIENT_CONFIG_WARNING_CODE` (`'client_config'`), which is how you tell an SDK-side compatibility warning from a `warning` event sent by the service.

Optional URL / connection parameters: `conversationId` (resume a conversation), `agentVersion` (pin a version), `agentAuthenticationIdentityClientId` (user-assigned managed identity), `foundryResourceOverride` (cross-resource agents).

For direct connections (no proxy) pass `agentName`, `projectName` and an Entra `token` on the connection config.

### Authentication Options

| Option | How | Use for |
| --- | --- | --- |
| **Proxy + API key** | `proxyUrl`; the backend holds `FOUNDRY_API_KEY` | Production, simplest |
| **Proxy + Entra token** | `proxyUrl + '?token=' + msalToken` (proxy moves it into an `Authorization` header) | Per-user auth |
| **Proxy + DefaultAzureCredential** | `proxyUrl`, no key/token | Keyless (managed identity, `az login`) |
| **Direct Entra token** | `connection.token` — sent as the documented `Authorization=Bearer <token>` query parameter | Dev, or when tokens in URLs are acceptable |
| **Direct API key** | `connection.apiKey` (query param) | Local development only |

See the [proxy package docs](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node) and [proxy examples](https://github.com/iLoveAgents/foundry-voice-live/tree/main/examples/src/pages).

## Configuration Helpers

### Session Builder (Recommended)

Use the fluent `sessionConfig()` builder for clean, chainable configuration:

```tsx
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';

const config = sessionConfig()
  .instructions('You are a helpful assistant.')
  .hdVoice('en-US-Ava:DragonHDLatestNeural', { temperature: 0.8, preferLocales: ['en-GB'] })
  .avatar('lisa', 'casual-sitting', { codec: 'h264' })
  .semanticVAD({ multilingual: true, interruptResponse: true, autoTruncate: true })
  .echoCancellation()
  .noiseReduction()
  .build();

const { videoStream, audioStream } = useVoiceLive({
  connection: { resourceName: 'your-foundry-resource', apiKey: 'your-key' },
  session: config,
});
```

### Builder Methods

| Method | Description |
| ------ | ----------- |
| `.instructions(text)` | Set system prompt (ignored in agent mode) |
| `.voice(name \| VoiceConfig)` | Set voice by name or full config |
| `.hdVoice(name, options?)` | Azure HD voice with `temperature`, `rate`, `pitch`, `volume`, `style`, `preferLocales`, `locale`, … |
| `.customVoice(name)` | Custom neural voice |
| `.personalVoice(name, model, options?)` | Azure personal voice (`DragonHDOmniLatestNeural`, `MAI-Voice-1`, …) |
| `.azureRealtimeVoice(name)` | Azure Realtime native voice (`ava`, `andrew`, `diya`, …) — model `azure-realtime` only |
| `.avatar(character, style, options?)` | Configure avatar |
| `.transparentBackground()` | Enable chroma key background |
| `.backgroundImage(url)` | Set avatar background image |
| `.avatarCrop(crop)` | Crop the avatar video (portrait mode) |
| `.semanticVAD(options?)` | Turn detection (`multilingual`, `interruptResponse`, `autoTruncate`, `appendedTextAfterTruncation`, …) |
| `.endOfUtterance(options?)` | End-of-utterance detection (`semantic_detection_v1*` or `smart_end_of_turn_detection`) |
| `.noTurnDetection()` | Manual turn mode (use `commitInputAudio()`) |
| `.echoCancellation(options?)` | Server echo cancellation (`referenceSource: 'client'` is sent on the wire, but stereo reference capture is not implemented yet) |
| `.noiseReduction(type?)` | Noise reduction (`'deep'` or `'nearField'`) |
| `.sampleRate(rate)` | Input sample rate (16000 / 24000) |
| `.transcription(options?)` | Input transcription (`azure-speech`, `whisper-1`, `gpt-4o-transcribe`, `mai-transcribe`, …) |
| `.viseme()` | Viseme output (lip-sync) |
| `.wordTimestamps()` | Word timestamps |
| `.tools(tools)` | Set function tools (replaces) |
| `.toolChoice(choice)` | Tool choice mode |
| `.mcpServer(server)` | Add a remote MCP server (appends) |
| `.foundryAgentTool(agent)` | Add a Foundry agent as a tool (appends) |
| `.parallelToolCalls(enabled)` | Allow/forbid parallel tool calls |
| `.reasoningEffort(effort)` | Reasoning effort for reasoning models |
| `.metadata(map)` | Session metadata (shows up in Foundry logs) |
| `.interimResponse(config)` | Filler messages while tools run / latency is high |
| `.greeting(config)` | Assistant speaks first |
| `.build()` | Build the final config |

Most builder methods also exist as standalone `withX()` helpers (`withMcpServer`, `withInterimResponse`, `withGreeting`, `withAzureRealtimeVoice`, `withSemanticVAD`, …) for functional composition via `compose()`.

### Transcription with Phrase Lists

Improve speech recognition accuracy for specific terms:

```tsx
const config = sessionConfig()
  .transcription({
    model: 'azure-speech',
    language: 'en',
    phraseList: ['Neo QLED TV', 'TUF Gaming', 'AutoQuote Explorer'],
  })
  .build();
```

> **Note:** `phraseList` and `customSpeech` require `model: 'azure-speech'`. `gpt-realtime` models use `whisper-1` / `gpt-4o-transcribe*` / `mai-transcribe`; all other models and agents use `azure-speech` / `mai-transcribe`.

## Function Calling

Define tools the AI can call. Return the result from `toolExecutor` (sync or async) and the SDK sends the `function_call_output` and triggers the next response for you:

```tsx
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

const { connect } = useVoiceLive({
  connection: { resourceName: 'your-foundry-resource', apiKey: 'your-key' },
  session: {
    instructions: 'You can check the weather.',
    tools: [{
      type: 'function',
      name: 'get_weather',
      description: 'Get weather for a location',
      parameters: { type: 'object', properties: { location: { type: 'string' } }, required: ['location'] },
    }],
    toolChoice: 'auto',
  },
  toolExecutor: async (name, args) => {
    const { location } = JSON.parse(args);
    if (name === 'get_weather') {
      const weather = await fetchWeather(location);
      return { temperature: weather.temp, location }; // sent automatically
    }
  },
});
```

Return values: a returned value is sent as `function_call_output`; returning `undefined`
means **no automatic output for that call** — if you intend to send one yourself later, keep the
executor's promise pending until you have (that is what makes the follow-up wait for it), or send
it with `sendToolResult()` and ask for the answer with `createResponse()`. A `sendToolResult()` you
call yourself is counted into the response's batch, so it shares the same single follow-up instead
of racing a second one. With parallel tool calls every output of a response is sent first and then **one** `response.create` follows (after `response.done`, so no answer is produced from a partial result set). If your executor rejects, `{ error: message }` is sent as the output — the model can then apologise or retry instead of the conversation stalling forever. Results that arrive after the session ended or reconnected are discarded.

## Interim Responses ("thinking out loud")

Bridge tool-call latency with short spoken filler messages — either LLM-generated or picked from your own texts:

```tsx
session: sessionConfig()
  .interimResponse({
    type: 'llm_interim_response',       // or 'static_interim_response' with texts: [...]
    triggers: ['tool', 'latency'],       // OR logic; default ['latency']
    latencyThresholdInMs: 1500,          // default 2000
    instructions: 'Briefly say you are looking it up.', // llm only; model defaults to gpt-4.1-mini
  })
  .build()
```

Supported in Foundry agent mode and with cascaded text models (`gpt-4.1`, `gpt-5`, …) + Azure voices. Native audio models (`gpt-realtime`, `gpt-realtime-mini`, `azure-realtime`) don't support interim responses — the SDK warns at connect time.

Measured live (August 2026, `gpt-4.1`, client-side function tool that takes 6 s): `static_interim_response` spoke its filler in every run; `llm_interim_response` produced a filler in 1 of 11 runs regardless of `model`/`instructions`/`latency` settings. Use static texts for client-side tools; LLM-generated fillers are aimed at server-side waits (MCP servers, Foundry agent tools).

## Proactive Greeting

Let the assistant speak first as soon as the session is ready:

```tsx
session: sessionConfig()
  .voice({ name: 'en-US-AvaMultilingualNeural', type: 'azure-standard' })
  .greeting({ type: 'pregenerated', text: 'Hi! How can I help you today?' }) // exact text, spoken by Azure TTS
  // or .greeting({ type: 'llm', text: 'Greet the user warmly and briefly.' }) // model generates it
  .build()
```

Pre-generated greetings are synthesized by Azure TTS, so they need an **Azure voice** — with an OpenAI voice (e.g. the default `alloy` on `gpt-realtime`) the message is added to the conversation as text only (verified live). Use `type: 'llm'` with OpenAI voices; the SDK warns about the combination at connect time.

## MCP Servers

Let Voice Live discover and execute tools on a remote [MCP](https://modelcontextprotocol.io/) server (server-side, no client code per tool):

```tsx
const { approveMcpCall } = useVoiceLive({
  connection: { proxyUrl: 'ws://localhost:8080/ws' },
  session: sessionConfig()
    .mcpServer({
      serverLabel: 'mslearn',
      serverUrl: 'https://learn.microsoft.com/api/mcp',
      requireApproval: 'always',   // 'never' | 'always' | { always: [...], never: [...] }
    })
    .build(),
  onMcpApprovalRequest: ({ approvalRequestId, serverLabel, name }) => {
    if (confirm(`Allow ${serverLabel}/${name}?`)) approveMcpCall(approvalRequestId, true);
    else approveMcpCall(approvalRequestId, false);
  },
});
```

`mcp_list_tools.*` and `response.mcp_call*` events are available through `onEvent`.

## Azure Realtime Voices

The `azure-realtime` model (GA) ships native voices with ~100 ms lower latency than `gpt-realtime`:

```tsx
useVoiceLive({
  connection: { resourceName: 'your-foundry-resource', apiKey: 'your-key', model: 'azure-realtime' },
  session: sessionConfig().azureRealtimeVoice('ava').build(),
});
```

## Text Input & Manual Turns

```tsx
const { sendText, commitInputAudio, cancelResponse } = useVoiceLive({ ... });

sendText('What is the weather in Berlin?');   // user text message + response.create
cancelResponse();                             // stop the assistant mid-sentence
// with .noTurnDetection(): stream audio, then
commitInputAudio();                           // end the user turn manually
```

## Auto-Reconnect

Opt in with `reconnect: true` (exponential backoff 500 ms → 8 s, 5 attempts, ± 20 % jitter) or tune it:

```tsx
const { connectionState, reconnectAttempt } = useVoiceLive({
  connection: {
    proxyUrl: 'wss://api.example.com/ws?agentName=Support&projectName=cs&conversationId=' + conversationId,
    // Fresh token per (re)connect — takes precedence over `token`
    getToken: () => msal.acquireTokenSilent({ scopes: ['https://ai.azure.com/.default'] }).then((r) => r.accessToken),
  },
  reconnect: { maxAttempts: 8, initialDelayMs: 300, maxDelayMs: 5000 },
  onReconnecting: (attempt, delayMs) => console.log(`reconnect #${attempt} in ${delayMs} ms`),
  onReconnected: () => console.log('back'),
});
// connectionState: 'reconnecting' while attempts run; reconnectAttempt = 1, 2, …
```

Triggered by any unclean close, plus a clean `1001 Going Away` (which only the *service* sends to us): a network drop (`1006`), a service restart, a connect that times out (`connectTimeoutMs`, default 15 s), and every terminal WebRTC failure — SDP answer rejected (`4009`), `rtc.call.error` (`4010`) and a peer connection that goes `failed`, e.g. switching from Wi‑Fi to cellular mid-call (`4011`). Never after `disconnect()`, after a clean `1000`, or after a close that rejects the request itself (`1003`, `1008`, `1010`) — the proxy closes with `1008` for invalid connection parameters, and reconnecting would be rejected identically.

While reconnecting, microphone audio is dropped rather than queued — speech during the gap is lost by design instead of being replayed into a session that has not been configured yet.

What happens on such a close: the transport is rebuilt, the WebRTC microphone track / WebSocket capture keep running and are re-attached, the `AudioContext` created on the user's gesture is kept, the proactive greeting is **not** re-sent. Standard-mode sessions start fresh (the service keeps no history across sockets); Foundry agents continue the conversation when `conversationId` is set. Clean closes and exhausted attempts end in `'disconnected'` / `'error'`.

## Event Handling

`onEvent` receives every server event in raw wire format, fully typed (`VoiceLiveServerEvent` — the union narrows on `event.type`):

```tsx
const { connect } = useVoiceLive({
  connection: { resourceName: 'your-foundry-resource', apiKey: 'your-key' },
  onTranscript: (role, text, isFinal) => console.log(role, text, isFinal), // user + assistant, incl. partials
  onWarning: (warning) => console.warn(warning.message),
  onEvent: (event) => {
    switch (event.type) {
      case 'session.created':
        console.log('Session', event.session.id);
        break;
      case 'response.audio_transcript.delta':
        console.log('AI:', event.delta);
        break;
      case 'response.animation_viseme.delta':
        animate(event.viseme_id, event.audio_offset_ms);
        break;
      case 'error':
        console.error(event.error.message);
        break;
    }
  },
});
```

## Logging

The hook is quiet by default (warnings and errors only). Set `logLevel: 'debug'` while developing to trace every event.

## API

### `useVoiceLive(config)`

Config (all optional except `connection`): `session`, `autoConnect`, `autoStartMic` (default `true`), `audioSampleRate` (24000), `audioConstraints`, `logLevel` (`'warn'`), `reconnect` (`false`), `connectTimeoutMs` (15000), `onEvent`, `onTranscript`, `toolExecutor`, `onWarning`, `onMcpApprovalRequest`, `onSessionUpdated`, `onReconnecting`, `onReconnected`. `connection` accepts `resourceName`/`apiKey`/`token`/`getToken`/`model`/`apiVersion`/`transport`/`rtcConfiguration`, or `proxyUrl` (+ `agentMode`), or `agentName`/`projectName`/`conversationId`/`agentVersion`/`agentAuthenticationIdentityClientId`/`foundryResourceOverride`.

Returns:

```typescript
{
  connectionState: 'disconnected' | 'connecting' | 'reconnecting' | 'connected' | 'error';
  reconnectAttempt: number;           // 1-based while reconnecting, else 0
  sessionState: 'idle' | 'listening' | 'thinking' | 'speaking';
  transport: 'websocket' | 'webrtc';
  videoStream: MediaStream | null;    // Avatar video
  audioStream: MediaStream | null;    // Assistant audio — attach to <audio autoPlay>
  audioContext: AudioContext | null;
  audioAnalyser: AnalyserNode | null; // For visualization
  sessionExpiresAt: number | null;    // epoch ms
  isReady: boolean;
  isMicActive: boolean;
  isMuted: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  startMic: () => Promise<void>;
  stopMic: () => void;
  toggleMute: () => void;
  sendEvent: (event: VoiceLiveClientEvent | VoiceLiveEvent) => void;
  updateSession: (config: Partial<VoiceLiveSessionConfig>) => void;
  sendText: (text: string, options?: { triggerResponse?: boolean }) => void;
  sendToolResult: (callId: string, output: string | object, options?: { triggerResponse?: boolean }) => void;
  cancelResponse: () => void;
  clearInputAudio: () => void;
  commitInputAudio: () => void;
  createResponse: () => void;      // ask for a response now (serialized with every other turn)
  approveMcpCall: (approvalRequestId: string, approve: boolean) => void;
  getAudioPlaybackTime: () => number | null; // viseme sync (websocket transport)
}
```

### `VoiceLiveAvatar`

```tsx
<VoiceLiveAvatar
  videoStream={videoStream}                 // Required: video from useVoiceLive
  audioStream={audioStream}                 // Required: audio from useVoiceLive
  transparentBackground={true}              // Remove green screen via WebGL chroma key (default true)
  chromaKeyConfig={{ keyColor: [0, 1, 0], similarity: 0.4, smoothness: 0.1 }} // optional
  loadingMessage="Loading..."               // Shown before video starts
/>
```

### Other exports

`useAudioCapture()` (microphone capture on its own, used by the WebSocket transport), `createVoiceLiveConfig()` (preset + overrides), `createChromaKeyProcessor()` / `DEFAULT_GREEN_SCREEN` (avatar background removal), and the pure protocol helpers `buildSessionConfig()`, `convertToSessionUpdate()`, `validateConfig()`, `buildGreetingEvents()`, `buildMicConstraints()`, `arrayBufferToBase64()`, `createAudioDataCallback()`, `createLogger()`.

### Constants

`DEFAULT_API_VERSION` (`2026-07-15`), `DEFAULT_WEBRTC_API_VERSION` (`2026-01-01-preview`), `MIN_WEBRTC_API_VERSION`, `DEFAULT_MODEL` (`gpt-realtime`), `VOICE_LIVE_DATA_CHANNEL`, `OPENAI_VOICES`, `AZURE_REALTIME_NATIVE_VOICES`, `AGENT_OWNED_FIELDS`, `SERVER_EVENT_TYPES` / `CLIENT_EVENT_TYPES` (and the `TYPED_SERVER_EVENT_TYPES` / `OTHER_SERVER_EVENT_TYPES` they are built from), `DEFAULT_SESSION_CONFIG`, `DEFAULT_CONNECT_TIMEOUT_MS`, `DEFAULT_RECONNECT_OPTIONS`, and the close codes `RECONNECT_SETUP_FAILED_CLOSE_CODE` (4001), `CONNECT_TIMEOUT_CLOSE_CODE` (4002), `RTC_SDP_ANSWER_FAILED_CLOSE_CODE` (4009), `RTC_CALL_ERROR_CLOSE_CODE` (4010), `RTC_MEDIA_FAILED_CLOSE_CODE` (4011), `CONTROL_CHANNEL_SETUP_FAILED_CLOSE_CODE` (4012).

### Core building blocks (advanced)

The hook is a thin React binding over framework-agnostic classes that are exported for custom integrations: `WebSocketTransport` / `WebRtcTransport` (control channel, SDP negotiation, readiness gating, duplicate-event filter — one `VoiceLiveTransportInstance` interface), `OutputAudioGraph` + `PcmPlayer` (AudioContext/analyser and AudioWorklet PCM playback), `AvatarConnection` (avatar SDP exchange), `WebRtcMicrophone`, the reconnect policy (`resolveReconnectOptions`, `computeBackoffDelay`, `isReconnectableClose`), `parseServerEvent`, and the lifecycle primitives `Scope`, `ResponseGate`, `BoundedMap` / `SeenEventIds`. They have no React dependency and are unit-tested with fake browser APIs; the hook remains the supported entry point.

## Why not the official SDK?

Microsoft's `@azure/ai-voicelive` is a typed protocol client: it has no audio capture/playback, no React, no avatar rendering, no WebRTC transport and no proxy support, and it adds ten runtime dependencies. This library is the browser/React layer on top of the same wire protocol — and it stays correct by **contract-testing its wire format against `@azure/ai-voicelive`** (dev dependency only), so protocol drift fails the build instead of your app.

## Examples

Working examples for all features:

| Example | Description |
| --- | --- |
| [Voice Basic](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceOnlyBasic.tsx) | Minimal voice chat |
| [Voice Advanced](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceAdvanced.tsx) | VAD, noise reduction, mute, transcripts |
| [Voice over WebRTC](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceWebRTC.tsx) | WebRTC transport (preview) |
| [Voice Proxy](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceProxy.tsx) | Secure proxy pattern |
| [Voice MSAL](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceProxyMSAL.tsx) | Entra ID auth |
| [Avatar Basic](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AvatarBasic.tsx) | Avatar video |
| [Avatar Advanced](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AvatarAdvanced.tsx) | Chroma key, 1080p |
| [Avatar via Proxy](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AvatarProxy.tsx) | Avatar through the proxy (no key in the browser) |
| [Avatar via Proxy (MSAL)](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AvatarProxyMSAL.tsx) | Avatar through the proxy with per-user Entra auth |
| [Function Calling](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FunctionCalling.tsx) | Tools with auto-sent results |
| [Interim Responses](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/InterimResponse.tsx) | Filler messages during slow tools |
| [MCP Server Tools](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/McpTools.tsx) | Server-side MCP tools + approval flow |
| [Azure Realtime](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AzureRealtime.tsx) | `azure-realtime` model with native voices |
| [Audio Visualizer](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AudioVisualizer.tsx) | Waveform display |
| [Viseme](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VisemeExample.tsx) | Lip-sync data |
| [Live2D Avatar](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/Live2DAvatarExample.tsx) | Live2D integration |
| [3D Avatar](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/Avatar3DExample.tsx) | React Three Fiber |
| [Foundry Agent - Voice](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FoundryAgent.tsx) | Foundry Agent Service (server-side auth) |
| [Foundry Agent - Voice MSAL](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FoundryAgentMSAL.tsx) | Foundry Agent Service (MSAL auth) |
| [Foundry Agent - Avatar](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FoundryAgentAvatar.tsx) | Foundry Agent Service with avatar |
| [Foundry Agent - Avatar MSAL](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FoundryAgentAvatarMSAL.tsx) | Foundry Agent Service avatar (MSAL) |

Run examples locally:

```bash
git clone https://github.com/iLoveAgents/foundry-voice-live
cd foundry-voice-live
just install
just dev          # Opens at http://localhost:3001
```

## Related

- **[Proxy Package](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node)** - Secure WebSocket proxy for production
- **[Voice Live API Docs](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)** - Microsoft documentation
- **[Examples](https://github.com/iLoveAgents/foundry-voice-live/tree/main/examples)** - Full working examples
- **[iLoveAgents Blog](https://iloveagents.ai)** - Guides for Microsoft Foundry & Agent Framework

## Support

If this library made your life easier, a coffee is a simple way to say thanks ☕
It directly supports maintenance and future features.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow.svg)](https://buymeacoffee.com/leitwolf)

## License

MIT - [iLoveAgents](https://iloveagents.ai)
