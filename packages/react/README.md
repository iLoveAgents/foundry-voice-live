# @iloveagents/foundry-voice-live-react

[![npm version](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-react.svg)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-react)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive, production-ready React library for Microsoft Foundry Voice Live API with complete feature coverage and TypeScript support.

## Overview

Microsoft Foundry Voice Live enables real-time voice conversations with AI models through native audio streaming. This library provides a complete React implementation with full API coverage and a fluent configuration API.

**Key Features:**

- **Complete API Coverage** - All Microsoft Foundry Voice Live parameters supported and typed
- **TypeScript First** - Comprehensive type definitions with full IntelliSense support
- **Production Ready** - Enterprise-grade code with proper error handling and validation
- **Fluent API** - 25+ composable helper functions for streamlined configuration
- **React Hooks** - Modern hooks-based architecture with integrated microphone capture
- **Zero Config Audio** - Microphone auto-starts when session is ready (no manual coordination)
- **Avatar Support** - Real-time avatar video with GPU-accelerated chroma key compositing
- **Audio Enhancements** - Built-in echo cancellation, noise suppression, and semantic VAD
- **Function Calling** - Complete tool support with async executor pattern
- **Zero Dependencies** - No external runtime dependencies (React only)

## Installation

```bash
npm install @iloveagents/foundry-voice-live-react
```

Or using other package managers:

```bash
yarn add @iloveagents/foundry-voice-live-react
pnpm add @iloveagents/foundry-voice-live-react
```

## Security

**Important**: Never commit API keys to version control.

**For Development:**

- Use environment variables (`.env` files)
- Add `.env` to `.gitignore`
- Example: `apiKey: process.env.VITE_AZURE_SPEECH_KEY`

**For Production:**

- **Recommended**: Use backend proxy with Microsoft Entra ID (MSAL) authentication
- Use managed identities for Azure-hosted applications
- Never expose API keys in client-side code

## Quick Start

### Basic Implementation

```tsx
import { useVoiceLive, VoiceLiveAvatar } from '@iloveagents/foundry-voice-live-react';

function VoiceAssistant() {
  // Microphone automatically starts when session is ready!
  const { videoStream, connect, disconnect, connectionState } = useVoiceLive({
    connection: {
      resourceName: 'your-azure-resource-name',
      apiKey: process.env.AZURE_VOICE_LIVE_KEY,
      model: 'gpt-realtime', // GPT-4o Realtime model (recommended)
    },
    session: {
      instructions: 'You are a helpful AI assistant.',
      voice: 'en-US-Ava:DragonHDLatestNeural',
    },
  });

  return (
    <div>
      <VoiceLiveAvatar videoStream={videoStream} />
      <button onClick={connect} disabled={connectionState === 'connected'}>
        Connect
      </button>
      <button onClick={disconnect} disabled={connectionState === 'disconnected'}>
        Disconnect
      </button>
      <p>Status: {connectionState}</p>
    </div>
  );
}
```

**That's it!** The microphone automatically:

- Requests permissions when you call `connect()`
- Starts capturing when the session is ready
- Stops when you call `disconnect()`

No manual audio coordination needed!

### Voice-Only with Visualization

For voice-only applications, the hook provides a pre-configured `audioAnalyser` for effortless visualization:

```tsx
import { useRef, useEffect } from 'react';
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';

function VoiceVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const config = createVoiceLiveConfig({
    connection: {
      resourceName: 'your-resource-name',
      apiKey: process.env.AZURE_VOICE_LIVE_KEY,
    },
  });

  // Get pre-configured audio analyser - no manual setup needed!
  const { connect, disconnect, audioStream, audioAnalyser, connectionState } = useVoiceLive(config);

  // Connect audio stream for playback
  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  // Visualize audio using the pre-configured analyser
  useEffect(() => {
    if (!audioAnalyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);

    const draw = () => {
      requestAnimationFrame(draw);
      audioAnalyser.getByteFrequencyData(dataArray);

      // Your visualization logic here
      // No need to create AudioContext or AnalyserNode manually!
    };
    draw();
  }, [audioAnalyser]);

  return (
    <div>
      <canvas ref={canvasRef} width={800} height={200} />
      <audio ref={audioRef} autoPlay hidden />
      <button onClick={connect}>Start</button>
      <button onClick={disconnect}>Stop</button>
    </div>
  );
}
```

**No audio complexity** - the hook handles:

- AudioContext creation and configuration (48kHz, low-latency)
- Professional-grade Lanczos-3 resampling (24kHz → 48kHz)
- AnalyserNode setup for visualization
- Audio routing and stream management
- Proper cleanup on disconnect

## Configuration API

### Simple Configuration Builder

Use `createVoiceLiveConfig` to build your configuration:

```tsx
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';

const config = createVoiceLiveConfig({
  connection: {
    resourceName: 'your-resource-name',
    apiKey: process.env.AZURE_VOICE_LIVE_KEY,
  },
  session: {
    instructions: 'You are a helpful assistant.',
    voice: 'en-US-Ava:DragonHDLatestNeural',
  },
});

const { videoStream, connect } = useVoiceLive(config);
```

### Fluent Helper Functions

Build custom configurations using composable helper functions:

```tsx
import {
  useVoiceLive,
  withHDVoice,
  withSemanticVAD,
  withEchoCancellation,
  withDeepNoiseReduction,
  compose
} from '@iloveagents/foundry-voice-live-react';

// Compose multiple configuration helpers
const enhanceAudio = compose(
  withEchoCancellation,
  withDeepNoiseReduction,
  (config) => withSemanticVAD({
    threshold: 0.5,
    removeFillerWords: true,
    interruptResponse: true,
  }, config),
  (config) => withHDVoice('en-US-Ava:DragonHDLatestNeural', {
    temperature: 0.9,
    rate: '1.1'
  }, config)
);

const { videoStream, connect } = useVoiceLive({
  connection: {
    resourceName: 'your-resource-name',
    apiKey: process.env.AZURE_VOICE_LIVE_KEY,
  },
  session: enhanceAudio({
    instructions: 'You are a helpful assistant.',
  }),
});
```

### Available Helper Functions

**Voice Configuration:**

- `withVoice(voice, config)` - Configure voice (string or VoiceConfig)
- `withHDVoice(name, options, config)` - Configure HD voice with temperature/rate control
- `withCustomVoice(name, config)` - Configure custom trained voice

**Avatar Configuration:**

- `withAvatar(character, style, options, config)` - Configure avatar character and style
- `withTransparentBackground(config, options?)` - Enable transparent background with chroma key (default green, customizable)
- `withBackgroundImage(url, config)` - Add custom background image
- `withAvatarCrop(crop, config)` - Configure video cropping for portrait mode

**Turn Detection:**

- `withSemanticVAD(options, config)` - Azure Semantic VAD (recommended)
- `withMultilingualVAD(languages, options, config)` - Multi-language semantic VAD
- `withEndOfUtterance(options, config)` - Advanced end-of-utterance detection
- `withoutTurnDetection(config)` - Disable automatic turn detection (manual mode)

**Audio Enhancements:**

- `withEchoCancellation(config)` - Enable server-side echo cancellation
- `withoutEchoCancellation(config)` - Disable echo cancellation
- `withDeepNoiseReduction(config)` - Azure deep noise suppression
- `withNearFieldNoiseReduction(config)` - Near-field noise reduction
- `withoutNoiseReduction(config)` - Disable noise reduction
- `withSampleRate(rate, config)` - Set sample rate (16000 or 24000 Hz)

**Output Features:**

- `withViseme(config)` - Enable viseme data for lip-sync animation
- `withWordTimestamps(config)` - Enable word-level audio timestamps
- `withTranscription(options, config)` - Enable input audio transcription
- `withoutTranscription(config)` - Disable transcription

**Function Calling:**

- `withTools(tools, config)` - Add function tools
- `withToolChoice(choice, config)` - Set tool choice behavior ('auto', 'none', 'required')

**Composition:**

- `compose(...fns)` - Compose multiple configuration functions

## API Reference

### `useVoiceLive(config)` Hook

Main hook for Microsoft Foundry Voice Live API integration with integrated microphone capture.

**Parameters:**

```typescript
interface UseVoiceLiveConfig {
  // Connection configuration
  connection: {
    resourceName: string;      // Azure AI Foundry resource name
    apiKey: string;            // Azure API key
    model?: string;            // Model name (default: 'gpt-realtime')
    apiVersion?: string;       // API version (default: '2025-10-01')
  };

  // Session configuration (optional)
  session?: VoiceLiveSessionConfig;

  // Auto-connect on mount (default: false)
  autoConnect?: boolean;

  // Microphone configuration
  autoStartMic?: boolean;                       // Auto-start mic when ready (default: true)
  audioSampleRate?: number;                     // Sample rate (default: 24000)
  audioConstraints?: MediaTrackConstraints | boolean; // Microphone selection

  // Event handler for all Voice Live events
  onEvent?: (event: VoiceLiveEvent) => void;

  // Tool executor for function calling
  toolExecutor?: (toolCall: ToolCall) => Promise<any>;
}
```

**Returns:**

```typescript
interface UseVoiceLiveReturn {
  // Connection state
  connectionState: 'disconnected' | 'connecting' | 'connected';

  // Media streams
  videoStream: MediaStream | null;      // Avatar video stream (WebRTC)
  audioStream: MediaStream | null;      // Audio stream for playback

  // Audio visualization (voice-only mode)
  audioContext: AudioContext | null;    // Web Audio API context
  audioAnalyser: AnalyserNode | null;   // Pre-configured analyser for visualization

  // Microphone state and control
  isMicActive: boolean;                 // Whether microphone is capturing
  startMic: () => Promise<void>;        // Manually start microphone
  stopMic: () => void;                  // Manually stop microphone

  // Connection methods
  connect: () => Promise<void>;         // Establish connection
  disconnect: () => void;                // Close connection

  // Communication methods
  sendEvent: (event: any) => void;      // Send custom event to API
  updateSession: (config: Partial<VoiceLiveSessionConfig>) => void; // Update session

  // Advanced features
  isReady: boolean;                     // Whether session is ready for interaction
  error: string | null;                 // Error message if any
}
```

**Microphone Control:**

By default, the microphone automatically starts when the session is ready (`autoStartMic: true`). You can:

```typescript
// Use default auto-start behavior (recommended)
const { connect, disconnect } = useVoiceLive(config);

// Manual control
const { connect, startMic, stopMic, isMicActive } = useVoiceLive({
  ...config,
  autoStartMic: false, // Disable auto-start
});

// Select specific microphone device
const { connect } = useVoiceLive({
  ...config,
  audioConstraints: { deviceId: 'specific-device-id' },
});
```

### `VoiceLiveAvatar` Component

Component for rendering avatar video with optional chroma key compositing.

**Props:**

```typescript
interface VoiceLiveAvatarProps {
  videoStream: MediaStream | null;

  // Chroma key settings
  enableChromaKey?: boolean;            // Enable green screen removal
  chromaKeyColor?: string;              // Key color (default: '#00FF00')
  chromaKeySimilarity?: number;         // Color similarity (0-1, default: 0.4)
  chromaKeySmoothness?: number;         // Edge smoothness (0-1, default: 0.1)

  // Styling
  className?: string;
  style?: React.CSSProperties;

  // Callbacks
  onVideoReady?: () => void;            // Called when video is ready
}
```

### `useAudioCapture()` Hook

**Note**: Microphone capture is now integrated into `useVoiceLive`. You typically don't need this hook unless you're building custom audio processing pipelines.

Hook for standalone microphone audio capture with AudioWorklet processing.

**Parameters:**

```typescript
interface AudioCaptureConfig {
  sampleRate?: number;                  // Sample rate (default: 24000)
  workletPath?: string;                 // Custom AudioWorklet path (optional)
  audioConstraints?: MediaTrackConstraints; // getUserMedia constraints
  onAudioData?: (data: ArrayBuffer) => void; // Audio data callback
  autoStart?: boolean;                  // Auto-start capture (default: false)
}
```

**Returns:**

```typescript
interface AudioCaptureReturn {
  isCapturing: boolean;                 // Capture state
  startCapture: () => Promise<void>;    // Start capturing
  stopCapture: () => void;              // Stop capturing
  pauseCapture: () => void;             // Pause capture
  resumeCapture: () => void;            // Resume capture
}
```

**Advanced Example (Custom Processing):**

```typescript
import { useAudioCapture } from '@iloveagents/foundry-voice-live-react';

// Only needed for custom audio processing outside of Voice Live
const { startCapture, stopCapture, isCapturing } = useAudioCapture({
  sampleRate: 24000,
  onAudioData: (audioData) => {
    // Custom processing logic here
    processAudioData(audioData);
  },
});
```

### Audio Helper Utilities

Convenience helpers for audio processing.

#### `arrayBufferToBase64()`

Low-level utility for converting ArrayBuffer to base64 string safely.

**Usage:**

```typescript
import { arrayBufferToBase64 } from '@iloveagents/foundry-voice-live-react';

const base64 = arrayBufferToBase64(audioData);
sendEvent({ type: 'input_audio_buffer.append', audio: base64 });
```

**Note:** Uses chunked conversion (32KB chunks) to avoid stack overflow from spread operator.

**When to use:** This is only needed for advanced use cases where you're manually processing audio data. For standard usage, microphone capture is integrated into `useVoiceLive` and handles this automatically.

## Session Configuration

The `session` parameter supports all Microsoft Foundry Voice Live API options:

```typescript
interface VoiceLiveSessionConfig {
  // System instructions
  instructions?: string;

  // Model parameters
  temperature?: number;                  // Response creativity (0-1)
  maxResponseOutputTokens?: number;      // Maximum response length

  // Voice configuration
  voice?: string | VoiceConfig;

  // Turn detection
  turnDetection?: TurnDetectionConfig | null;

  // Audio enhancements
  inputAudioEchoCancellation?: EchoCancellationConfig | null;
  inputAudioNoiseReduction?: NoiseReductionConfig | null;
  inputAudioSamplingRate?: 16000 | 24000;

  // Avatar configuration
  avatar?: AvatarConfig;

  // Function calling
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';

  // Output configuration
  animation?: AnimationConfig;           // Viseme output
  outputAudioTimestampTypes?: TimestampType[]; // Word timestamps

  // Input transcription
  inputAudioTranscription?: TranscriptionConfig | null;

  // Additional parameters...
}
```

For complete type definitions, see the TypeScript types included with the package.

## Advanced Examples

### Avatar with Transparent Background

```tsx
import {
  useVoiceLive,
  VoiceLiveAvatar,
  withAvatar,
  withTransparentBackground,
  compose
} from '@iloveagents/foundry-voice-live-react';

const configureAvatar = compose(
  (config) => withAvatar('lisa', 'casual-standing', {
    resolution: { width: 1920, height: 1080 },
    bitrate: 2000000,
  }, config),
  withTransparentBackground  // No color needed - uses default green
);

function AvatarApp() {
  const { videoStream, connect } = useVoiceLive({
    connection: {
      resourceName: process.env.AZURE_RESOURCE_NAME,
      apiKey: process.env.AZURE_API_KEY,
    },
    session: configureAvatar({
      instructions: 'You are a helpful assistant.',
    }),
  });

  return <VoiceLiveAvatar videoStream={videoStream} enableChromaKey />;
}
```

### Function Calling

```tsx
import { useVoiceLive, withTools } from '@iloveagents/foundry-voice-live-react';

const weatherTool = {
  type: 'function',
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or zip code'
      }
    },
    required: ['location']
  }
};

function WeatherAssistant() {
  const executeTool = async (toolCall: ToolCall) => {
    if (toolCall.name === 'get_weather') {
      const { location } = toolCall.arguments;
      // Fetch weather data
      const weather = await fetchWeather(location);
      return weather;
    }
  };

  const { videoStream, connect } = useVoiceLive({
    connection: {
      resourceName: process.env.AZURE_RESOURCE_NAME,
      apiKey: process.env.AZURE_API_KEY,
    },
    session: withTools([weatherTool], {
      instructions: 'You are a weather assistant with access to real-time weather data.',
    }),
    toolExecutor: executeTool,
  });

  return <VoiceLiveAvatar videoStream={videoStream} />;
}
```

### Event Handling

```tsx
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

function EventMonitor() {
  const handleEvent = (event: VoiceLiveEvent) => {
    switch (event.type) {
      case 'session.created':
        console.log('Session established');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        console.log('User said:', event.transcript);
        break;

      case 'response.audio_transcript.delta':
        console.log('Assistant saying:', event.delta);
        break;

      case 'response.done':
        console.log('Response complete');
        break;

      case 'error':
        console.error('Error occurred:', event.error);
        break;
    }
  };

  const { videoStream, connect } = useVoiceLive({
    connection: {
      resourceName: process.env.AZURE_RESOURCE_NAME,
      apiKey: process.env.AZURE_API_KEY,
    },
    session: {
      instructions: 'You are a helpful assistant.',
    },
    onEvent: handleEvent,
  });

  return <VoiceLiveAvatar videoStream={videoStream} />;
}
```

### 1. Use Recommended Defaults

The library defaults to optimal settings:

- **Model**: `gpt-realtime`
- **Turn Detection**: `azure_semantic_vad` (most reliable)
- **Sample Rate**: 24000 Hz (best quality)
- **Echo Cancellation**: Enabled
- **Noise Suppression**: Enabled
- **Auto-start Mic**: Enabled (no manual coordination needed)

### 2. Enable Audio Enhancements

For production deployments, always enable audio enhancements:

```tsx
const enhanceAudio = compose(
  withEchoCancellation,
  withDeepNoiseReduction,
  (config) => withSemanticVAD({ threshold: 0.5 }, config)
);
```

### 3. Use Azure Semantic VAD

Azure Semantic VAD provides superior turn detection compared to simple volume-based detection:

```tsx
withSemanticVAD({
  threshold: 0.5,                  // Detection threshold
  removeFillerWords: true,         // Remove "um", "uh", etc.
  interruptResponse: true,         // Allow user interruptions
  endOfUtteranceDetection: {       // Advanced end-of-speech detection
    model: 'semantic_detection_v1',
    thresholdLevel: 'medium',
    timeoutMs: 1000,
  }
})
```

### 4. Handle Errors Properly

Implement robust error handling:

```tsx
onEvent: (event) => {
  if (event.type === 'error') {
    console.error('Voice Live error:', event.error);
    // Implement retry logic or user notification
  }
}
```

### 5. Secure API Keys

Never expose API keys in client-side code:

```tsx
// ❌ Bad - API key in code
const apiKey = 'your-api-key-here';

// ✅ Good - Use environment variables
const apiKey = process.env.AZURE_VOICE_LIVE_KEY;

// ✅ Better - Fetch from secure backend
const apiKey = await fetchApiKeyFromBackend();
```

## Requirements

### Peer Dependencies

- **React**: ≥16.8.0 (Hooks support required)
- **React DOM**: ≥16.8.0

### Browser Requirements

- Modern browser with WebRTC support
- WebAudio API support
- AudioWorklet support (for microphone capture)

### Azure Requirements

- Azure AI Foundry resource with Voice Live API enabled
- Deployed voice-enabled model (`gpt-realtime` or `gpt-realtime-mini`)
- Valid API key with appropriate permissions

## Azure Setup

1. **Create Azure AI Foundry Resource**
   - Navigate to [Azure Portal](https://portal.azure.com)
   - Create new AI Foundry resource
   - Note your resource name

2. **Enable Voice Live API**
   - In your AI Foundry resource, enable Voice Live API
   - Deploy a voice-enabled model (gpt-realtime recommended)

3. **Get API Key**
   - Navigate to Keys and Endpoint
   - Copy your API key
   - Store securely (use environment variables)

For detailed setup instructions, see [Microsoft Foundry Voice Live Documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live).

## Examples & Playground

The library includes a comprehensive playground with working examples for all features:

### Voice Examples

- **[Voice Chat - Simple](./playground/src/pages/VoiceOnlyBasic.tsx)** - Basic voice-only implementation
- **[Voice Chat - Advanced](./playground/src/pages/VoiceOnlyAdvanced.tsx)** - Full configuration with semantic VAD
- **[Voice Chat - Secure Proxy](./playground/src/pages/VoiceProxy.tsx)** - Backend proxy with API key
- **[Voice Chat - Secure Proxy (MSAL)](./playground/src/pages/VoiceProxyMSAL.tsx)** - User-level authentication

### Avatar Examples

- **[Avatar - Simple](./playground/src/pages/AvatarBasic.tsx)** - Basic avatar with video
- **[Avatar - Advanced](./playground/src/pages/AvatarAdvanced.tsx)** - Chroma key + noise suppression
- **[Avatar - Secure Proxy](./playground/src/pages/AvatarProxy.tsx)** - Backend proxy with API key
- **[Avatar - Secure Proxy (MSAL)](./playground/src/pages/AvatarProxyMSAL.tsx)** - User-level authentication

### Advanced Features

- **[Function Calling](./playground/src/pages/FunctionCalling.tsx)** - Tool/function integration
- **[Audio Visualizer](./playground/src/pages/AudioVisualizer.tsx)** - Real-time audio visualization
- **[Viseme Animation](./playground/src/pages/VisemeExample.tsx)** - Custom avatar lip-sync
- **[Live2D Avatar](./playground/src/pages/Live2DAvatarExample.tsx)** - Live2D Cubism 4 lip-sync ([setup required](#live2d-avatar-setup))
- **[Agent Service](./playground/src/pages/AgentService.tsx)** - Azure AI Foundry Agent integration

### Running the Playground

```bash
# Install and start
npm install
npm run dev
```

Open <http://localhost:3001> to explore all examples.

### Live2D Avatar Setup

The Live2D Avatar example requires downloading the model separately due to Live2D licensing restrictions.

1. **Download the Kei model** from [Live2D Sample Models](https://www.live2d.com/en/learn/sample/)
2. **Accept the license agreements** (Free Material License Agreement & Terms of Use)
3. **Extract the model** to `playground/public/models/kei_vowels_pro/`

The folder structure should look like:

```text
playground/public/models/kei_vowels_pro/
├── kei_vowels_pro.model3.json
├── kei_vowels_pro.moc3
├── kei_vowels_pro.physics3.json
├── kei_vowels_pro.cdi3.json
├── kei_vowels_pro.2048/
│   └── texture_00.png
└── motions/
```

**Note:** The model files are excluded from git. Each developer must download and accept the license individually.

## Contributing

Contributions are welcome! Please open an issue or pull request on GitHub.

## License

MIT © [iloveagents](https://github.com/iloveagents)

## Support

- **Issues**: [GitHub Issues](https://github.com/iloveagents/foundry-voice-live-react/issues)
- **Discussions**: [GitHub Discussions](https://github.com/iloveagents/foundry-voice-live-react/discussions)
- **Documentation**: [API Reference](https://github.com/iloveagents/foundry-voice-live-react#readme)

## Acknowledgments

Built for Microsoft Foundry Voice Live API. For official Microsoft documentation, visit:

- [Microsoft Foundry Voice Live Overview](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live)
- [Voice Live API Reference](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference)
- [Azure AI Foundry](https://learn.microsoft.com/azure/ai-studio/)

---

**Built by [iloveagents](https://github.com/iloveagents)**
