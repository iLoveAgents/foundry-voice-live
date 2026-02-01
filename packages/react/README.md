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

## Install

```bash
npm install @iloveagents/foundry-voice-live-react
```

## Quick Start

```tsx
import { useVoiceLive, VoiceLiveAvatar } from '@iloveagents/foundry-voice-live-react';

function App() {
  const { videoStream, connect, disconnect, connectionState } = useVoiceLive({
    connection: {
      resourceName: 'your-resource',
      apiKey: process.env.AZURE_KEY, // See "Production" below
    },
    session: {
      instructions: 'You are a helpful assistant.',
      voice: 'en-US-Ava:DragonHDLatestNeural',
    },
  });

  return (
    <>
      <VoiceLiveAvatar videoStream={videoStream} />
      <button onClick={connect}>Start</button>
      <button onClick={disconnect}>Stop</button>
    </>
  );
}
```

Microphone starts automatically when connected. No manual audio setup needed.

## Production

**Never expose API keys in client-side code.** Use the proxy package:

```bash
npm install @iloveagents/foundry-voice-live-proxy-node
```

Two secure options:

1. **API Key via Proxy** - Backend holds the key, client connects through proxy
2. **Microsoft Entra ID (MSAL)** - User-level authentication with Azure AD

See [proxy package docs](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node) and [proxy examples](https://github.com/iLoveAgents/foundry-voice-live/tree/main/examples/src/pages).

## Configuration Helpers

Compose configuration with fluent helpers:

```tsx
import {
  useVoiceLive,
  withAvatar,
  withSemanticVAD,
  withEchoCancellation,
  withTransparentBackground,
  compose,
} from '@iloveagents/foundry-voice-live-react';

const config = compose(
  withEchoCancellation,
  withSemanticVAD({ threshold: 0.5 }),
  withAvatar('lisa', 'casual-standing'),
  withTransparentBackground,
);

const { videoStream } = useVoiceLive({
  connection: { resourceName: 'your-resource', apiKey },
  session: config({ instructions: 'You are helpful.' }),
});
```

### Available Helpers

| Category   | Helpers                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------- |
| **Voice**  | `withVoice`, `withHDVoice`, `withCustomVoice`                                                     |
| **Avatar** | `withAvatar`, `withTransparentBackground`, `withBackgroundImage`, `withAvatarCrop`                |
| **VAD**    | `withSemanticVAD`, `withMultilingualVAD`, `withEndOfUtterance`, `withoutTurnDetection`            |
| **Audio**  | `withEchoCancellation`, `withDeepNoiseReduction`, `withNearFieldNoiseReduction`, `withSampleRate` |
| **Output** | `withViseme`, `withWordTimestamps`, `withTranscription`                                           |
| **Tools**  | `withTools`, `withToolChoice`                                                                     |

## Function Calling

```tsx
const { videoStream, connect } = useVoiceLive({
  connection: { resourceName, apiKey },
  session: withTools([{
    type: 'function',
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: {
      type: 'object',
      properties: { location: { type: 'string' } },
      required: ['location'],
    },
  }], { instructions: 'You can check the weather.' }),
  toolExecutor: async (call) => {
    if (call.name === 'get_weather') {
      return await fetchWeather(call.arguments.location);
    }
  },
});
```

## Event Handling

```tsx
const { connect } = useVoiceLive({
  connection: { resourceName, apiKey },
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
  connectionState: 'disconnected' | 'connecting' | 'connected';
  videoStream: MediaStream | null;    // Avatar video
  audioStream: MediaStream | null;    // Audio playback
  audioAnalyser: AnalyserNode | null; // For visualization
  isMicActive: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendEvent: (event: any) => void;
  updateSession: (config) => void;
  error: string | null;
}
```

### `VoiceLiveAvatar`

```tsx
<VoiceLiveAvatar
  videoStream={videoStream}
  enableChromaKey={true}           // Remove green background
  chromaKeyColor="#00FF00"         // Key color
  chromaKeySimilarity={0.4}        // Color match threshold
  chromaKeySmoothness={0.1}        // Edge smoothness
/>
```

## Examples

Working examples for all features:

| Example                                                                                                                 | Description          |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------- |
| [Voice Basic](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceOnlyBasic.tsx)        | Minimal voice chat   |
| [Voice Advanced](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceOnlyAdvanced.tsx)  | VAD, noise reduction |
| [Voice Proxy](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceProxy.tsx)            | Secure proxy pattern |
| [Voice MSAL](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VoiceProxyMSAL.tsx)         | Entra ID auth        |
| [Avatar Basic](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AvatarBasic.tsx)          | Avatar video         |
| [Avatar Advanced](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AvatarAdvanced.tsx)    | Chroma key, 1080p    |
| [Function Calling](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/FunctionCalling.tsx)  | Tool integration     |
| [Audio Visualizer](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AudioVisualizer.tsx)  | Waveform display     |
| [Viseme](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/VisemeExample.tsx)              | Lip-sync data        |
| [Live2D Avatar](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/Live2DAvatarExample.tsx) | Live2D integration   |
| [3D Avatar](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/Avatar3DExample.tsx)         | React Three Fiber    |
| [Agent Service](https://github.com/iLoveAgents/foundry-voice-live/blob/main/examples/src/pages/AgentService.tsx)        | Foundry Agent        |

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

## License

MIT - [iLoveAgents](https://iloveagents.ai)
