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

## What is Voice Live?

Microsoft Foundry Voice Live API provides a unified solution for low-latency, high-quality speech-to-speech interactions:

- **Unified API**: Integrates speech recognition, generative AI, and text-to-speech in one interface
- **Multiple Models**: `gpt-realtime`, `azure-realtime` (native voices), GPT-4.1, GPT-5, Phi, and more - fully managed, no deployment needed
- **Global Coverage**: 140+ locales for speech-to-text, 600+ voices across 150+ locales
- **Advanced Features**: Noise suppression, echo cancellation, semantic turn detection, interim responses, proactive greetings
- **Transports**: WebSocket audio, or WebRTC (preview) for lowest browser latency
- **Foundry Agents & MCP**: Connect to Foundry Agent Service, add remote MCP servers as tools
- **Avatar Support**: Text-to-speech avatars synchronized with audio output
- **Function Calling**: External actions and VoiceRAG patterns
- **Production hardening**: opt-in auto-reconnect with backoff, token providers, typed events, quiet logging, secure proxy

This SDK targets Voice Live API **`2026-07-15` (GA)** and contract-tests its wire format against Microsoft's official `@azure/ai-voicelive` SDK. The React hook is a thin binding over framework-agnostic core classes (transports, audio output, avatar connection) that are exported for custom integrations.

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [@iloveagents/foundry-voice-live-react](./packages/react/README.md) | React hooks and components | [![npm](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-react)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-react) |
| [@iloveagents/foundry-voice-live-proxy-node](./packages/proxy-node/README.md) | Secure WebSocket proxy server | [![npm](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-proxy-node)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node) |

## Quick Start

> **Region Availability:** The default model (`gpt-realtime`) is only available in **East US 2** and **Sweden Central** regions. Make sure your Azure AI Foundry resource is deployed in one of these regions. See [Microsoft docs](https://learn.microsoft.com/azure/ai-foundry/openai/concepts/models#global-standard-model-availability) for current availability.

### Installation

```bash
npm install @iloveagents/foundry-voice-live-react
```

### Voice Only

```tsx
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { connect, disconnect, connectionState, audioStream } = useVoiceLive({
    connection: {
      resourceName: 'your-foundry-resource',  // Azure AI Foundry resource name
      apiKey: 'your-foundry-api-key',         // For dev only - use proxy in production!
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

### With Avatar

```tsx
import { useVoiceLive, VoiceLiveAvatar, sessionConfig } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { videoStream, audioStream, connect, disconnect } = useVoiceLive({
    connection: {
      resourceName: 'your-foundry-resource',
      apiKey: 'your-foundry-api-key',
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

Configure the proxy `.env` with `FOUNDRY_RESOURCE_NAME` (the GA API version `2026-07-15` is the default — no `API_VERSION` needed).

To resume a previous conversation, add `conversationId` to the URL:

```text
ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject&conversationId=conv_abc123
```

For per-user MSAL auth, pass `token` as a URL param. The token only travels to your own proxy over localhost/internal network — the proxy moves it to an `Authorization` header before connecting to Azure. For direct connections without a proxy, pass `token` on the connection config (sent as the documented `Authorization=Bearer …` query parameter). See the [examples](./examples/) for both auth patterns.

### WebRTC Transport (Preview)

Set `connection.transport = 'webrtc'` to stream audio over RTP instead of the WebSocket (voice-only, lower latency; see the [React SDK README](./packages/react/README.md#webrtc-transport-preview) for limitations). Works directly and through the proxy (`transport=webrtc` is appended automatically).

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

- Node.js >= 22.0.0 (development; the protocol contract test's `@azure/ai-voicelive` dev dependency requires it. The published packages themselves run on older runtimes — the proxy declares Node >= 18.)
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
        WebSocket audio  OR  WebRTC (RTP) + control channel
                    ▼
┌─────────────────────────────────────────┐
│     Microsoft Foundry Voice Live API    │
└─────────────────────────────────────────┘
```

## API Reference

### useVoiceLive Hook

```typescript
const {
  connectionState,  // 'disconnected' | 'connecting' | 'connected' | 'error'
  sessionState,     // 'idle' | 'listening' | 'thinking' | 'speaking'
  transport,        // 'websocket' | 'webrtc'
  videoStream,      // MediaStream | null (avatar video)
  audioStream,      // MediaStream | null (assistant audio — attach to <audio autoPlay>)
  audioAnalyser,    // AnalyserNode | null (for visualization)
  sessionExpiresAt, // number | null (epoch ms)
  isMicActive,      // boolean - whether microphone is capturing
  isMuted,          // boolean - microphone mute state
  connect,          // () => Promise<void>
  disconnect,       // () => void
  toggleMute,       // () => void - instant mute/unmute
  sendText,         // (text) => void - user text message
  sendToolResult,   // (callId, output) => void
  cancelResponse,   // () => void
  approveMcpCall,   // (approvalRequestId, approve) => void
  sendEvent,        // (event: VoiceLiveClientEvent | VoiceLiveEvent) => void
  updateSession,    // (config) => void
  error,            // string | null
} = useVoiceLive({
  connection: {
    resourceName?: string,      // Microsoft Foundry resource
    apiKey?: string,            // For dev only
    token?: string,             // Entra ID token (direct connections)
    proxyUrl?: string,          // Secure proxy URL (production)
    transport?: 'websocket' | 'webrtc',
    agentName?, projectName?,   // Foundry Agents
  },
  session: sessionConfig()
    .instructions('You are a helpful assistant.')
    .hdVoice('en-US-Ava:DragonHDLatestNeural')
    .semanticVAD({ interruptResponse: true, removeFillerWords: true, autoTruncate: true })
    .echoCancellation()
    .noiseReduction()
    .greeting({ type: 'llm', text: 'Greet the user warmly in English.' })
    .interimResponse({
      type: 'llm_interim_response',
      triggers: ['tool', 'latency'],
      latencyThresholdInMs: 1500,
    })
    .mcpServer({ serverLabel: 'mslearn', serverUrl: 'https://learn.microsoft.com/api/mcp' })
    .build(),
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'none',   // default 'warn'
  onEvent?: (event: VoiceLiveServerEvent) => void,          // typed wire events
  onTranscript?: (role: 'user' | 'assistant', text: string, isFinal: boolean) => void,
  toolExecutor?: (name, args, callId) => ToolResult | Promise<ToolResult> | void, // returned value is auto-sent
  onMcpApprovalRequest?: (request) => void,
  onWarning?: (warning) => void,
});
```

### VoiceLiveAvatar Component

```tsx
<VoiceLiveAvatar
  videoStream={videoStream}          // From useVoiceLive
  audioStream={audioStream}          // From useVoiceLive
  transparentBackground={true}       // Remove green background (WebGL chroma key)
  chromaKeyConfig={{ keyColor: [0, 1, 0], similarity: 0.4, smoothness: 0.1 }}
  loadingMessage="Loading..."        // Shown before video starts
/>
```

## Documentation

- **[Getting Started Guide](https://iloveagents.ai/foundry-voice-live-react-sdk)** — Tutorial with step-by-step examples
- **[React SDK Reference](./packages/react/README.md)** — Full API docs, configuration helpers, and advanced features
- **[Proxy Server Docs](./packages/proxy-node/README.md)** — Production deployment and authentication

### Microsoft Resources

- [Voice Live Documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live)
- [Voice Live API Reference](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-api-reference)
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
