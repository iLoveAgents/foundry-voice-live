# Foundry Voice Live Examples

Interactive examples for testing Microsoft Foundry Voice Live API features.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Copy the example environment file. Configure the proxy with your Foundry resource and server-side credentials; MSAL examples additionally need a public client ID and tenant ID:

```bash
# From the repository root
cp examples/.env.example examples/.env
cp packages/proxy-node/.env.example packages/proxy-node/.env
```

### 3. Download Live2D Model (Optional)

The Live2D avatar feature requires the Kei model from Live2D's sample collection. Due to licensing, this model is not included in the repository.

**Download instructions:**

1. Visit [Live2D Sample Models](https://www.live2d.com/en/learn/sample/)
2. Download the **Kei** model (look for "kei_vowels_pro")
3. Extract the contents to:
   ```
   examples/public/models/kei_vowels_pro/
   ```

The directory structure should look like:
```
public/models/kei_vowels_pro/
├── kei_vowels_pro.2048/
│   └── texture_00.png
├── kei_vowels_pro.cdi3.json
├── kei_vowels_pro.moc3
├── kei_vowels_pro.model3.json
├── kei_vowels_pro.motionsync3.json
├── kei_vowels_pro.physics3.json
├── motions/
└── sounds/
```

### 4. Run examples

Start the proxy and examples in separate terminals from the repository root:

```bash
just dev-proxy
just dev-examples
```

Open [the examples](http://localhost:3001) in your browser. Start with [Azure Realtime and Streaming Text](http://localhost:3001/current-capabilities): it uses `azure-realtime`, the native `ava` voice, `mai-transcribe-2`, sequential function calls, streamed text chunks, and the server-reported session expiration. The microphone is optional and starts only on request.

Try [Voice over WebRTC](http://localhost:3001/voice-webrtc) for native audio media tracks with text input, a time-lookup tool, transcripts, mute controls, and an optional microphone. It uses `connection.transport: 'webrtc'`; the proxy authenticates signaling while audio flows directly over WebRTC. Microsoft currently offers this transport in preview with global routing, and does not support avatar configuration with its sideband control. See [Voice Live WebRTC](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-webrtc).

The SDK and proxy default to stable API version `2026-07-15`. Check [Voice Live model and region availability](https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=voice-live#regions) before selecting a model. Foundry Agent Service examples use current named agents; Agent Service (classic) examples are retained for legacy agent IDs.

All model examples keep resource credentials on the proxy. Any `VITE_*` variable is included in browser code; never put API keys there. Set `VITE_BACKEND_PROXY_URL` to your `wss://` proxy URL when hosting these examples remotely.

## Features

- Voice-only mode testing over WebSocket and WebRTC
- Avatar mode with Microsoft avatars
- Live2D avatar integration (requires model download)
- Real-time audio visualization
- Session configuration testing

## License

Examples are MIT licensed. Note that Live2D models have their own licensing terms - see [Live2D License](https://www.live2d.com/en/terms/live2d-free-material-license-agreement/).
