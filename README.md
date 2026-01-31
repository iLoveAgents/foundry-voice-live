# Foundry Voice Live

[![npm version](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-react)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

SDK and tools for **Microsoft Foundry Voice Live API** - enabling real-time voice interactions with AI agents.

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
| [@iloveagents/foundry-voice-live-react](./packages/react) | React hooks and components | [![npm](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-react)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-react) |
| [@iloveagents/foundry-voice-live-proxy-node](./packages/proxy-node) | Secure WebSocket proxy server | [![npm](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-proxy-node)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node) |

## Quick Start

### Installation

```bash
# React SDK
npm install @iloveagents/foundry-voice-live-react

# Optional: Proxy server for secure authentication
npm install @iloveagents/foundry-voice-live-proxy-node
```

### Basic Usage

```tsx
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function VoiceAgent() {
  const { status, connect, disconnect, sendAudio } = useVoiceLive({
    endpoint: 'wss://your-resource.cognitiveservices.azure.com',
    apiKey: 'your-api-key', // Use proxy in production!
    model: 'gpt-4o',
    voice: 'en-US-JennyNeural',
    onMessage: (event) => console.log('Response:', event),
    onAudio: (audio) => playAudio(audio),
  });

  return (
    <div>
      <p>Status: {status}</p>
      <button onClick={connect}>Start</button>
      <button onClick={disconnect}>Stop</button>
    </div>
  );
}
```

### With Avatar

```tsx
import { useVoiceLive, VoiceLiveAvatar } from '@iloveagents/foundry-voice-live-react';

function AvatarAgent() {
  const { status, connect, avatarStream } = useVoiceLive({
    endpoint: 'wss://your-resource.cognitiveservices.azure.com',
    apiKey: 'your-api-key',
    avatar: {
      character: 'lisa',
      style: 'casual-sitting',
    },
  });

  return (
    <div>
      <VoiceLiveAvatar
        stream={avatarStream}
        chromaKey={true}  // Remove green background
      />
      <button onClick={connect}>Start Conversation</button>
    </div>
  );
}
```

### Using the Proxy (Recommended for Production)

```bash
# Start proxy server
npx @iloveagents/foundry-voice-live-proxy-node

# Or with Docker
docker run -p 8080:8080 \
  -e AZURE_REGION=westus2 \
  -e AZURE_RESOURCE_NAME=your-resource \
  -e AZURE_API_KEY=your-key \
  ghcr.io/iloveagents/foundry-voice-live-proxy
```

```tsx
// Connect through proxy instead of directly
const { connect } = useVoiceLive({
  endpoint: 'ws://localhost:8080/voice-live',
  // No API key needed - proxy handles auth
});
```

## Demos

| Demo | Description | Run |
|------|-------------|-----|
| [playground](./demos/playground) | Interactive examples for all features | `just dev-playground` |
| [avatar](./demos/avatar) | Full-featured Luna AI assistant | `just dev-avatar` |

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
│            Your Application              │
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
  status,       // 'disconnected' | 'connecting' | 'connected' | 'error'
  connect,      // () => Promise<void>
  disconnect,   // () => void
  sendAudio,    // (audioData: ArrayBuffer) => void
  sendText,     // (text: string) => void
  avatarStream, // MediaStream | null (when avatar enabled)
} = useVoiceLive({
  // Connection
  endpoint: string,
  apiKey?: string,

  // Model
  model?: 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4.1' | 'phi4-mini' | ...,

  // Voice
  voice?: string,  // e.g., 'en-US-JennyNeural'

  // Avatar (optional)
  avatar?: {
    character: string,
    style: string,
  },

  // Turn Detection
  turnDetection?: {
    type: 'semantic_vad',
    threshold?: number,
    silenceDuration?: number,
  },

  // Callbacks
  onMessage?: (event: VoiceLiveEvent) => void,
  onAudio?: (audio: ArrayBuffer) => void,
  onTranscript?: (text: string, isFinal: boolean) => void,
  onError?: (error: Error) => void,
});
```

### VoiceLiveAvatar Component

```tsx
<VoiceLiveAvatar
  stream={avatarStream}      // MediaStream from useVoiceLive
  chromaKey={true}           // Remove green background
  chromaColor="#00FF00"      // Custom chroma key color
  width={640}
  height={480}
  className="avatar"
/>
```

## Resources

- [Microsoft Voice Live Documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live)
- [Voice Live API Reference](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live-api-reference)
- [Azure AI Foundry](https://azure.microsoft.com/products/ai-foundry/)

## Contributing

See [AGENTS.md](./AGENTS.md) for development guidelines.

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Run tests: `just test`
4. Commit changes: `git commit -m 'Add amazing feature'`
5. Push: `git push origin feature/amazing-feature`
6. Open Pull Request

## License

MIT - see [LICENSE](./LICENSE) file

## Author

[Christian Glessner](https://github.com/ltwlf) - [iLoveAgents.ai](https://iloveagents.ai)

---

<p align="center">
  Built with ❤️ by <a href="https://iloveagents.ai">iLoveAgents.ai</a>
</p>
