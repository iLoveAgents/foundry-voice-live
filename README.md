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
- **Multiple Models**: GPT-4o, GPT-4.1, GPT-5, Phi, and more - fully managed, no deployment needed
- **Global Coverage**: 140+ locales for speech-to-text, 600+ voices across 150+ locales
- **Advanced Features**: Noise suppression, echo cancellation, semantic turn detection
- **Avatar Support**: Text-to-speech avatars synchronized with audio output
- **Function Calling**: External actions and VoiceRAG patterns

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [@iloveagents/foundry-voice-live-react](./packages/react/README.md) | React hooks and components | [![npm](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-react)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-react) |
| [@iloveagents/foundry-voice-live-proxy-node](./packages/proxy-node/README.md) | Secure WebSocket proxy server | [![npm](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-proxy-node)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node) |

## Quick Start

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

### Production (Proxy)

**Never expose API keys in client-side code.** Use the proxy:

```bash
# Docker (recommended)
docker run -p 8080:8080 \
  -e FOUNDRY_RESOURCE_NAME=your-foundry-resource \
  -e FOUNDRY_API_KEY="your-api-key" \
  -e ALLOWED_ORGINS="*" \
  ghcr.io/iloveagents/foundry-voice-live-proxy:latest

# Or with npx
FOUNDRY_RESOURCE_NAME=your-foundry-resource \
FOUNDRY_API_KEY="your-api-key" \
ALLOWED_ORGINS="*" \
npx @iloveagents/foundry-voice-live-proxy-node
```

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

- Node.js >= 18.0.0
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
  connectionState,  // 'disconnected' | 'connecting' | 'connected'
  videoStream,      // MediaStream | null (avatar video)
  audioStream,      // MediaStream | null (audio playback)
  audioAnalyser,    // AnalyserNode | null (for visualization)
  isMicActive,      // boolean
  connect,          // () => Promise<void>
  disconnect,       // () => void
  sendEvent,        // (event: any) => void
  updateSession,    // (config) => void
  error,            // string | null
} = useVoiceLive({
  connection: {
    resourceName?: string,      // Azure AI Foundry resource
    apiKey?: string,            // For dev only
    proxyUrl?: string,          // Secure proxy URL (production)
  },
  session: {
    instructions?: string,
    voice?: { name: string, type: 'azure-standard' | 'azure-hd' },
    avatar?: { character: string, style: string },
    turnDetection?: { type: 'semantic_vad' | 'server_vad' | 'none' },
    tools?: ToolDefinition[],
  },
  onEvent?: (event: VoiceLiveEvent) => void,
  toolExecutor?: (name: string, args: string, callId: string) => void,
});
```

### VoiceLiveAvatar Component

```tsx
<VoiceLiveAvatar
  videoStream={videoStream}    // From useVoiceLive
  audioStream={audioStream}    // From useVoiceLive
  enableChromaKey={true}       // Remove green background
  chromaKeyColor="#00FF00"     // Custom key color
  loadingMessage="Loading..."  // Shown before video starts
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
