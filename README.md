<p align="center">
  <a href="https://iloveagents.ai">
    <img src=".github/images/iloveagents-foundry-voice-banner.png" alt="Foundry Voice Live" width="800" />
  </a>
</p>

# Foundry Voice Live

[![CI](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml/badge.svg)](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-react)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

SDK and tools for **Microsoft Foundry Voice Live API** - enabling real-time voice interactions with AI agents. Supports Azure video avatars, Live2D avatars, 3D avatars, and audio visualizers.

📖 **[Getting Started Guide](https://iloveagents.ai/foundry-voice-live-react-sdk)** — Step-by-step tutorial with examples

> **Renamed**: This project was previously "azure-voice-live" and has been renamed to align with [Microsoft's rebranding](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live) of the service.

## What is Voice Live?

Microsoft Foundry Voice Live API provides a unified solution for low-latency, high-quality speech-to-speech interactions:

- **Unified API**: Integrates speech recognition, generative AI, and text-to-speech in one interface
- **Multiple Models**: Azure Realtime, GPT Realtime, GPT text models, and Phi — see the [current managed model list](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live#supported-models-and-regions) for supported choices
- **Global Coverage**: 140+ locales for speech-to-text, 600+ voices across 150+ locales
- **Advanced Features**: Noise suppression, echo cancellation, semantic turn detection
- **Avatar Support**: Text-to-speech avatars synchronized with audio output
- **Function Calling**: External actions and VoiceRAG patterns

## API compatibility

Checked against Microsoft's [Voice Live `2026-07-15` API reference](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference-2026-07-15) on **2026-11-14**. This is the default stable API version for the SDK and proxy.

The typed configuration and event helpers cover native Azure Realtime voices, MAI transcription, MCP tools, parallel tool-call control, streaming text input, and server-reported session expiration. Feature support still depends on the model and region. The [Azure Realtime and Streaming Text example](./examples/src/pages/CurrentCapabilities.tsx) demonstrates a current configuration using the backend proxy.

Choose WebSocket audio (the default) or native WebRTC voice with `connection.transport: 'webrtc'`. WebRTC sends microphone and assistant audio over media tracks, receives transcripts and response events on the `voice-live-events` data channel, and keeps a WebSocket open for signaling, session control, and tools. The bundled proxy authenticates the control connection while audio flows directly between the browser and Voice Live. WebRTC voice and smart turn detection remain preview capabilities in Microsoft's documentation. [Voice Live WebRTC](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-webrtc) currently uses global standard deployments and automatic regional routing; avatar configuration is unsupported with its sideband control.

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [@iloveagents/foundry-voice-live-react](./packages/react/README.md) | React hooks and components | [![npm](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-react)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-react) |
| [@iloveagents/foundry-voice-live-proxy-node](./packages/proxy-node/README.md) | Secure WebSocket proxy server | [![npm](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-proxy-node)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node) |

## Quick Start

> **Model and region availability:** Availability depends on the selected model, resource region, and processing scope. Check the [Voice Live region matrix](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=voice-live#regions) for your deployment. The SDK keeps `gpt-realtime` as its default; you can select newer supported models explicitly.

### Installation

```bash
npm install @iloveagents/foundry-voice-live-react
```

### Voice Only

Start the [proxy](#production-proxy) with your server-side credentials before connecting.

```tsx
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { connect, disconnect, connectionState, audioStream } = useVoiceLive({
    connection: {
      proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime', // Server-side credentials
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

### Voice over WebRTC

Select the voice transport through the same hook:

```tsx
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
});
```

Play `voice.audioStream` through an audio element, as in the voice-only example. Call `voice.startMic()` after connecting when the user chooses to enable the microphone. `stopMic()`, `toggleMute()`, `sendEvent()`, `createResponse()`, and transcript callbacks work through the same hook API. The SDK negotiates SDP through the proxy using `transport=webrtc`; the proxy connects to `/voice-live/realtime/calls`. Use `wss://` for a remotely hosted proxy.

The [WebRTC example](./examples/src/pages/WebRTCVoice.tsx) includes audio playback, text input, a time-lookup tool, microphone controls, and error handling. See the [React SDK transport guide](./packages/react/README.md#voice-over-webrtc-preview) for connection options and service limitations.

### With Avatar

```tsx
import { useVoiceLive, VoiceLiveAvatar, sessionConfig } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { videoStream, audioStream, connect, disconnect } = useVoiceLive({
    connection: {
      proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime',
    },
    session: sessionConfig()
      .instructions('You are a helpful assistant.')
      .hdVoice('en-US-Ava:DragonHDLatestNeural')
      .avatar('lisa', 'casual-sitting', { codec: 'h264' })
      .semanticVAD({ interruptResponse: true })
      .echoCancellation()
      .noiseReduction()
      .build(),
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

> 📖 See the **[React SDK README](./packages/react/README.md)** for full configuration options, function calling, event handling, and more examples.

### Foundry Agent Service

Connect to [Foundry Agent Service](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart) — the client passes agent config as URL params, the proxy handles auth via `DefaultAzureCredential` (service principal, managed identity, or Azure CLI for dev):

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

Configure the proxy `.env` with `FOUNDRY_RESOURCE_NAME`; the default API version is `2026-07-15`. Existing deployments can set `API_VERSION` explicitly. For new agent integrations, use these named Foundry Agent Service examples; the classic `agentId` examples remain for existing integrations.

To resume a previous conversation, add `conversationId` to the URL:

```text
ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject&conversationId=conv_abc123
```

For per-user MSAL auth, pass `token` as a URL param. Use `wss://` for a remotely hosted proxy. The proxy moves the token to an `Authorization` header before connecting to Azure (the browser WebSocket API cannot set headers directly). See the [examples](./examples/) for both auth patterns.

### Production (Proxy)

**Never expose API keys in client-side code.** Use the proxy:

```bash
# Docker (recommended)
docker run -p 8080:8080 \
  -e FOUNDRY_RESOURCE_NAME=your-foundry-resource \
  -e FOUNDRY_API_KEY="your-api-key" \
  -e ALLOWED_ORIGINS="*" \
  ghcr.io/iloveagents/foundry-voice-live-proxy:latest

# Or with npx
FOUNDRY_RESOURCE_NAME=your-foundry-resource \
FOUNDRY_API_KEY="your-api-key" \
ALLOWED_ORIGINS="*" \
npx @iloveagents/foundry-voice-live-proxy-node
```

> **Note:** `ALLOWED_ORIGINS="*"` is for local development only. In production, set this to your app's origin (e.g., `https://myapp.example.com`).

```tsx
// Connect through proxy - no API key in client code
const { connect } = useVoiceLive({
  connection: {
    proxyUrl: 'ws://localhost:8080/ws',  // Proxy handles auth
  },
  session: {
    instructions: 'You are a helpful assistant.',
  },
});
```

## Run Examples

Interactive examples demonstrating Voice Live API features.

```bash
# 1. Clone and install
git clone https://github.com/iloveagents/foundry-voice-live.git
cd foundry-voice-live
just install

# 2. Configure credentials
cp packages/proxy-node/.env.example packages/proxy-node/.env
cp examples/.env.example examples/.env
# Edit both .env files with your Azure AI Foundry credentials

# 3. Start proxy + examples
just dev
```

Open <http://localhost:3001> to explore the examples.

## Development

### Prerequisites

- Node.js 22.22.2+, 24.15+, or 26+
- pnpm >= 9.0.0
- [just](https://github.com/casey/just) command runner

### Setup

```bash
# Clone and install
git clone https://github.com/iloveagents/foundry-voice-live.git
cd foundry-voice-live
just install

# Build all packages
just build

# Run tests
just test

# Start development servers
just dev
```

### Commands

```bash
just              # Show all commands
just install      # Install dependencies
just build        # Build all packages
just test         # Run tests
just dev          # Run dev servers
just lint         # Lint code
just publish-dry  # Preview npm publish
```

## Architecture

```
┌─────────────────────────────────────────┐
│            Your Application             │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│   @iloveagents/foundry-voice-live-react │
│   • useVoiceLive hook                   │
│   • VoiceLiveAvatar component           │
│   • Configuration helpers               │
└─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌───────────────┐      ┌───────────────────┐
│  Direct API   │  OR  │  Proxy Server     │
│  (Dev only)   │      │  (Production)     │
└───────────────┘      └───────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│     Microsoft Foundry Voice Live API    │
└─────────────────────────────────────────┘
```

## Migration from Azure Voice Live

If upgrading from the previous `@iloveagents/azure-voice-live-*` packages:

```bash
# Remove old packages
npm uninstall @iloveagents/azure-voice-live-react @iloveagents/azure-voice-live-proxy

# Install new packages
npm install @iloveagents/foundry-voice-live-react
npm install @iloveagents/foundry-voice-live-proxy-node  # if using proxy
```

Update imports:

```typescript
// Before
import { useVoiceLive } from '@iloveagents/azure-voice-live-react';

// After
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';
```

## API Reference

### useVoiceLive Hook

```typescript
const {
  connectionState,  // 'disconnected' | 'connecting' | 'connected' | 'error'
  sessionState,     // 'idle' | 'listening' | 'thinking' | 'speaking'
  videoStream,      // MediaStream | null (avatar video)
  audioStream,      // MediaStream | null (audio playback)
  audioAnalyser,    // AnalyserNode | null (for visualization)
  isMicActive,      // boolean - whether microphone is capturing
  isMuted,          // boolean - microphone mute state
  connect,          // () => Promise<void>
  disconnect,       // () => void
  toggleMute,       // () => void - instant mute/unmute
  sendEvent,        // (event: any) => void
  updateSession,    // (config) => void — updates only supplied fields
  appendText,       // (itemId, delta, contentIndex?) => void
  finishText,       // (itemId, contentIndex?) => void
  createResponse,   // (options?) => void
  sessionExpiresAt, // number | null — server Unix timestamp in seconds
  error,            // string | null
} = useVoiceLive({
  connection: {
    resourceName?: string,      // Azure AI Foundry resource
    apiKey?: string,            // For dev only
    proxyUrl?: string,          // Secure proxy URL (production)
  },
  session: sessionConfig()
    .instructions('You are a helpful assistant.')
    .hdVoice('en-US-Ava:DragonHDLatestNeural')
    .semanticVAD({ interruptResponse: true, removeFillerWords: true })
    .echoCancellation()
    .noiseReduction()
    .greeting({ type: 'llm', text: 'Greet the user warmly in English.' })
    .interimResponse({
      type: 'llm_interim_response',
      triggers: ['tool', 'latency'],
      latencyThresholdInMs: 3000,
    })
    .build(),
  onEvent?: (event: VoiceLiveEvent) => void,
  onTranscript?: (role: 'user' | 'assistant', text: string, isFinal: boolean) => void,
  toolExecutor?: (name: string, args: string, callId: string) => void,
});
```

### VoiceLiveAvatar Component

```tsx
<VoiceLiveAvatar
  videoStream={videoStream}    // From useVoiceLive
  audioStream={audioStream}    // From useVoiceLive
  transparentBackground={true} // Remove green background
  chromaKeyConfig={{ keyColor: [0, 1, 0], similarity: 0.4, smoothness: 0.1 }}
  loadingMessage="Loading..."  // Shown before video starts
/>
```

## Documentation

- **[Getting Started Guide](https://iloveagents.ai/foundry-voice-live-react-sdk)** — Tutorial with step-by-step examples
- **[React SDK Reference](./packages/react/README.md)** — Full API docs, configuration helpers, and advanced features
- **[Proxy Server Docs](./packages/proxy-node/README.md)** — Production deployment and authentication

### Microsoft Resources

- [Voice Live Documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live)
- [Voice Live API Reference](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference-2026-07-15)
- [Voice Live WebRTC](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-webrtc)
- [Azure AI Foundry](https://azure.microsoft.com/products/ai-foundry/)

## Contributing

Contributions welcome! Fork the repo, create a feature branch, run `just test`, and open a PR.

## Support

If this library made your life easier, a coffee is a simple way to say thanks ☕
It directly supports maintenance and future features.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow.svg)](https://buymeacoffee.com/leitwolf)

## License

MIT - see [LICENSE](./LICENSE) file

## Author

[Christian Glessner](https://github.com/ltwlf) - [iLoveAgents.ai](https://iloveagents.ai)

---

<p align="center">
  Built with ❤️ by <a href="https://iloveagents.ai">iLoveAgents.ai</a>
</p>
