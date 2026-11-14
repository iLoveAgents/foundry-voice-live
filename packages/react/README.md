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

**React hooks and components for [Microsoft Foundry Voice Live API](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live).** Build real-time voice AI apps with Azure video avatars, Live2D avatars, 3D avatars, audio visualizers, function calling, and TypeScript support.

## API compatibility and current capabilities

Reviewed against Microsoft's [stable `2026-07-15` API reference](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference-2026-07-15) on **2026-11-14**. New direct connections and the bundled proxy default to that version. Explicit `connection.apiVersion` or proxy `API_VERSION` overrides remain available for existing deployments.

| Capability | SDK support |
| --- | --- |
| WebRTC voice (preview) | `connection.transport: 'webrtc'`; RTP audio, data-channel transcripts, WebSocket signaling and tools |
| Azure Realtime native voices | `voice: { type: 'azure-realtime-native', name: 'ava' }`; requires model `azure-realtime` |
| OpenAI, Azure standard/custom/personal voices | Typed configuration, including custom endpoint, locale, lexicon and prosody fields |
| MAI Transcribe | `inputAudioTranscription.model: 'mai-transcribe-2'` or the `mai-transcribe` alias |
| Parallel tool calls | `parallelToolCalls: false` for sequential calls |
| MCP / Foundry agents as tools | Typed `MCPTool` / `FoundryAgentTool`; approval and lifecycle events through `sendEvent` / `onEvent` |
| Streamed user text | `appendText(id, delta)`, then `finishText(id)`, then `createResponse()` |
| Hosted invocation input | `createResponse({ invokeInput: ... })`; deltas through `onEvent` |
| Session expiration | Read-only `sessionExpiresAt`, Unix seconds, from server events |
| Reasoning and tracing | `reasoningEffort` and session `metadata` |
| Animation / photo avatars | Blendshapes, visemes, photo-avatar model, scene and output settings serialize to the protocol |
| Image input | `buildResponseConfig` maps `imageUrl` to the current `image_url` wire field |

For example:

```tsx
const voice = useVoiceLive({
  connection: { proxyUrl: 'ws://localhost:8080/ws', model: 'azure-realtime' },
  session: {
    voice: { type: 'azure-realtime-native', name: 'ava' },
    inputAudioTranscription: { model: 'mai-transcribe-2', language: 'de-DE' },
    parallelToolCalls: false,
  },
});
```

Tools retain API snake_case fields, so JSON schemas and MCP configurations pass through unchanged. The legacy nested function choice `{ type: 'function', function: { name } }` is normalized to `{ type: 'function', name }`. `updateSession()` sends a patch without resetting unrelated defaults. Agent sessions retain audio/animation/metadata options while agent-owned instructions and model/tool policy are omitted.

**Transports:** WebSocket audio remains the default. Set `connection.transport: 'webrtc'` for native WebRTC voice through the same hook; see [Voice over WebRTC](#voice-over-webrtc-preview) below. Avatar streaming remains available with the default WebSocket transport; Microsoft currently does not support avatar configuration with WebRTC voice sideband control. WebSocket avatar video and hosted-agent lifecycle events are available as raw events; applications must supply their own video renderer or lifecycle UI. With WebSocket audio, built-in microphone capture produces mono PCM16. Client-supplied echo reference requires custom interleaved stereo PCM16 input through `sendEvent`, `autoStartMic: false`, and `connection.previewFeatures: ['client_ec_reference']`. Smart end-of-turn detection and client echo reference remain explicitly opt-in preview settings; service support depends on model and region.

The [interim-response guide](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-live-interim-response) specifies underscore wire fields (`interim_response`, `llm_interim_response`, `latency_threshold_ms`). This SDK follows its raw JSON examples; the API reference currently contains inconsistent hyphenated spellings. Interim responses apply to agent mode and supported cascaded text models, not realtime audio models.

## Install

```bash
npm install @iloveagents/foundry-voice-live-react
```

## Quick Start

> **Availability:** Choose a model and resource region from the current [Voice Live region matrix](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=voice-live#regions). Capabilities vary by model and region.

### Voice Only

```tsx
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { connect, disconnect, connectionState, audioStream } = useVoiceLive({
    connection: {
      proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime',
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

### Voice over WebRTC (preview)

The same `useVoiceLive` hook supports native WebRTC audio. Select `connection.transport: 'webrtc'` and keep credentials on the proxy:

```tsx
import { useEffect, useRef } from 'react';
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function WebRTCVoice() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const voice = useVoiceLive({
    connection: {
      proxyUrl: 'ws://localhost:8080/ws?model=azure-realtime',
      transport: 'webrtc',
    },
    autoStartMic: false,
    session: {
      voice: { type: 'azure-realtime-native', name: 'ava' },
      inputAudioTranscription: { model: 'mai-transcribe-2' },
    },
    onTranscript: (role, text, isFinal) => console.log(role, text, isFinal),
  });

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = voice.audioStream;
  }, [voice.audioStream]);

  return (
    <>
      <button onClick={voice.connect} disabled={voice.connectionState === 'connecting' || voice.connectionState === 'connected'}>Connect</button>
      <button onClick={() => { void voice.startMic().catch(console.error); }} disabled={!voice.isReady || voice.isMicActive}>Enable microphone</button>
      <button onClick={voice.toggleMute} disabled={!voice.isMicActive}>{voice.isMuted ? 'Unmute' : 'Mute'}</button>
      <button onClick={voice.stopMic} disabled={!voice.isMicActive}>Stop microphone</button>
      <button onClick={voice.disconnect}>Disconnect</button>
      <p>{voice.error}</p>
      <audio ref={audioRef} autoPlay controls />
    </>
  );
}
```

With `autoStartMic: false`, connecting does not request microphone permission. You can receive spoken responses to text immediately, then call `startMic()` when the user wants to speak. Stopping the microphone releases capture; mute keeps capture active while suppressing outgoing microphone audio. Attach `audioStream` to an audio element for playback, including a user-initiated playback control if the browser blocks autoplay.

The SDK uses Microsoft's WebSocket signaling flow:

| Channel | Purpose |
| --- | --- |
| WebSocket through the proxy | Authenticated `/voice-live/realtime/calls` signaling with `rtc.call.sdp.create` / `rtc.call.sdp.created`, session updates, tool calls, and control events |
| WebRTC `voice-live-events` data channel | Transcripts, VAD, and response lifecycle events delivered through the hook callbacks |
| WebRTC RTP media tracks | Microphone input and continuous assistant audio; audio is not carried in `response.audio.delta` events |

`sendEvent`, `createResponse`, `updateSession`, `onEvent`, `onTranscript`, and `toolExecutor` retain the same public API. The hook forwards `transport=webrtc` to the bundled proxy so it selects the calls endpoint. Keep the proxy connection open for the lifetime of the WebRTC call. Custom proxies must support this signaling route and forward the control events unchanged. This implementation uses WebSocket signaling; the service's alternative HTTP SDP exchange is not used.

All outgoing client commands share the ordered WebSocket connection, so a tool result arrives before its subsequent `response.create`. Incoming events are accepted from both channels and deduplicated by `event_id`.

For microphone selection, set `audioConstraints: { deviceId: { exact: selectedDeviceId } }` on the hook. Stop capture before changing the selection, then call `startMic()` again. WebRTC uses the latest constraints without reconnecting the session. `await getMicrophoneStatus()` reports the selected track, browser/OS source mute state, input level and outgoing RTP counters. It returns `null` when no WebRTC microphone is attached; individual statistics are `null` when the browser does not provide them. A live track alone does not prove that the microphone is delivering audible input.

Optional connection settings allow custom ICE servers and bounded negotiation:

```ts
connection: {
  proxyUrl: 'wss://your-proxy.example.com/ws?model=azure-realtime',
  transport: 'webrtc',
  webRTC: {
    rtcConfiguration: {
      iceServers: [{ urls: 'stun:your-stun-server.example.com:3478' }],
    },
    connectionTimeoutMs: 30000,
    iceGatheringTimeoutMs: 10000,
  },
}
```

WebRTC voice remains **preview**. Microsoft currently uses **global standard deployments with automatic regional routing** for this transport; check the [WebRTC guide](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-webrtc) and [region support](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=voice-live) before choosing it for workloads with regional processing requirements. The service currently does not support avatar configuration with sideband control, so the hook rejects `transport: 'webrtc'` together with `session.avatar`. Use the default WebSocket transport for avatars and for custom base64 audio input.

See the complete [WebRTC voice example](../../examples/src/pages/WebRTCVoice.tsx) for text input, function calling, microphone controls, playback, and error handling.

### With Avatar

```tsx
import { useVoiceLive, VoiceLiveAvatar } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { videoStream, audioStream, connect, disconnect } = useVoiceLive({
    connection: {
      proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime',
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

Microphone starts automatically when connected. No manual audio setup needed.

## Production

**Never expose API keys in client-side code.** Use a proxy server to secure your credentials.

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

> **Note:** `ALLOWED_ORIGINS="*"` is for local development only. In production, set this to your app's origin (e.g., `https://myapp.example.com`).

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

Connect to [Foundry Agent Service](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart) — client passes agent config as URL params, proxy handles auth:

```tsx
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { connect, disconnect, audioStream } = useVoiceLive({
    connection: {
      proxyUrl: 'ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject',
    },
    session: sessionConfig()
      .voice('en-US-AvaMultilingualNeural')
      .semanticVAD({ interruptResponse: true })
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

Proxy needs `FOUNDRY_RESOURCE_NAME` and `API_VERSION=2026-07-15`. For MSAL auth, also pass `token` in the URL.

To resume a previous conversation, add `conversationId` to the URL:

```text
ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject&conversationId=conv_abc123
```

For direct connections (without proxy), set `conversationId` on the connection config instead.

### Authentication Options

- **API Key via Proxy** — Backend holds the key, client uses `proxyUrl`
- **MSAL Token** — Pass token in query string: `proxyUrl + '?token=' + msalToken`
- **Foundry Agent Service** — Proxy uses `DefaultAzureCredential` (or pass MSAL `token`)

See [proxy package docs](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node) and [proxy examples](https://github.com/iLoveAgents/foundry-voice-live/tree/main/examples/src/pages).

## Configuration Helpers

### Session Builder (Recommended)

Use the fluent `sessionConfig()` builder for clean, chainable configuration:

```tsx
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';

const config = sessionConfig()
  .instructions('You are a helpful assistant.')
  .hdVoice('en-US-Ava:DragonHDLatestNeural', { temperature: 0.8 })
  .avatar('lisa', 'casual-sitting', { codec: 'h264' })
  .semanticVAD({ multilingual: true, interruptResponse: true })
  .echoCancellation()
  .noiseReduction()
  .build();

const { videoStream, audioStream } = useVoiceLive({
  connection: { proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime' },
  session: config,
});
```

### Builder Methods

| Method | Description |
| ------ | ----------- |
| `.instructions(text)` | Set system prompt |
| `.voice(name)` | Set voice by name |
| `.hdVoice(name, { temperature?, rate? })` | Set HD voice with options |
| `.customVoice(name, endpointId)` | Set custom voice with its deployed endpoint |
| `.realtimeVoice(name)` | Set an Azure native voice (azure-realtime model only) |
| `.parallelToolCalls(enabled)` | Control parallel tool calls |
| `.avatar(character, style, options?)` | Configure avatar |
| `.transparentBackground()` | Enable chroma key background |
| `.backgroundImage(url)` | Set avatar background image |
| `.semanticVAD(options?)` | Configure turn detection (use `{ multilingual: true }` for 10-language support) |
| `.endOfUtterance(options?)` | Add end-of-utterance detection |
| `.noTurnDetection()` | Disable turn detection (manual mode) |
| `.echoCancellation()` | Enable server echo cancellation |
| `.noiseReduction(type?)` | Enable noise reduction (`'deep'` or `'nearField'`) |
| `.transcription(options?)` | Configure input transcription |
| `.viseme()` | Enable viseme output (lip-sync) |
| `.wordTimestamps()` | Enable word timestamps |
| `.tools(tools)` | Add function, MCP, or Foundry-agent tools |
| `.toolChoice(choice)` | Set tool choice mode |
| `.build()` | Build the final config |

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

> **Note:** `phraseList` supports `azure-speech`, `mai-transcribe`, and `mai-transcribe-2`. `customSpeech` requires `azure-speech` and maps locales to deployed custom-speech **endpoint IDs** on the same resource. Model combinations and availability are defined in the [API reference](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference-2026-07-15#realtimeaudioinputtranscriptionsettings).

## Function Calling

Define tools the AI can call, then handle execution and send results back:

```tsx
import { useRef, useCallback } from 'react';
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

const sendEventRef = useRef<(event: any) => void>(() => {});

const toolExecutor = useCallback((name: string, args: string, callId: string) => {
  const parsedArgs = JSON.parse(args);
  let result = {};

  if (name === 'get_weather') {
    result = { temperature: '72°F', location: parsedArgs.location };
  }

  // Send result back to the API
  sendEventRef.current({
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(result) },
  });
  sendEventRef.current({ type: 'response.create' });
}, []);

const { connect, sendEvent } = useVoiceLive({
  connection: { proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime' },
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
  toolExecutor,
});

sendEventRef.current = sendEvent;
```

## Event Handling

```tsx
const { connect } = useVoiceLive({
  connection: { proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime' },
  onEvent: (event) => {
    switch (event.type) {
      case 'session.created':
        console.log('Connected');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        console.log('User:', event.transcript);
        break;
      case 'response.audio_transcript.delta':
        console.log('AI:', event.delta);
        break;
      case 'error':
        console.error(event.error);
        break;
    }
  },
});
```

## API

### `useVoiceLive(config)`

Returns:

```typescript
{
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
  videoStream: MediaStream | null;    // Avatar video
  audioStream: MediaStream | null;    // Audio playback
  audioAnalyser: AnalyserNode | null; // For visualization
  isMicActive: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendEvent: (event: any) => void;
  updateSession: (config) => void;
  sessionExpiresAt: number | null; // Unix seconds, server-set
  appendText: (id: string, delta: string, contentIndex?: number) => void;
  finishText: (id: string, contentIndex?: number) => void;
  createResponse: (options?: ResponseCreateOptions) => void;
  error: string | null;
}
```

### `VoiceLiveAvatar`

```tsx
<VoiceLiveAvatar
  videoStream={videoStream}        // Required: video from useVoiceLive
  audioStream={audioStream}        // Required: audio from useVoiceLive
  transparentBackground={true}
  chromaKeyConfig={{ keyColor: [0, 1, 0], similarity: 0.4, smoothness: 0.1 }}
  loadingMessage="Loading..."      // Shown before video starts
/>
```

## Examples

Runnable examples for common features:

| Example | Description |
| --- | --- |
| [Voice Basic](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceOnlyBasic.tsx) | Minimal voice chat |
| [Voice Advanced](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceAdvanced.tsx) | VAD, noise reduction |
| [Voice Proxy](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceProxy.tsx) | Secure proxy pattern |
| [Voice MSAL](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceProxyMSAL.tsx) | Entra ID auth |
| [Avatar Basic](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AvatarBasic.tsx) | Avatar video |
| [Avatar Advanced](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AvatarAdvanced.tsx) | Chroma key, 1080p |
| [Function Calling](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FunctionCalling.tsx) | Tool integration |
| [Audio Visualizer](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AudioVisualizer.tsx) | Waveform display |
| [Viseme](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VisemeExample.tsx) | Lip-sync data |
| [Live2D Avatar](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/Live2DAvatarExample.tsx) | Live2D integration |
| [3D Avatar](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/Avatar3DExample.tsx) | React Three Fiber |
| [Foundry Agent - Voice](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FoundryAgent.tsx) | Foundry Agent Service (server-side auth) |
| [Foundry Agent - Voice MSAL](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FoundryAgentMSAL.tsx) | Foundry Agent Service (MSAL auth) |
| [Foundry Agent - Avatar](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FoundryAgentAvatar.tsx) | Foundry Agent Service with avatar |
| [Foundry Agent - Avatar MSAL](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FoundryAgentAvatarMSAL.tsx) | Foundry Agent Service avatar (MSAL) |
| [Agent Service](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AgentService.tsx) | Agent Service (classic) |

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
