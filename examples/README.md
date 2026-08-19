# Foundry Voice Live Examples

Interactive examples for testing Microsoft Foundry Voice Live API features.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

Copy the example environment file and add your Azure credentials:

```bash
cp .env.example .env
```

| Variable                                               | Used by                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_FOUNDRY_RESOURCE_NAME`, `VITE_FOUNDRY_API_KEY`   | Optional: when both are set, the non-proxy examples connect directly with the key (dev only — never ship API keys in client code). When unset they go through the proxy instead, so every example works keyless with `just dev-proxy` + `az login` |
| `VITE_BACKEND_PROXY_URL`                               | Proxy, MSAL and Foundry Agent examples, and the keyless fallback of all other pages (defaults to `ws://localhost:8080`, see `packages/proxy-node`)                                                                                                 |
| `VITE_FOUNDRY_AGENT_NAME`, `VITE_FOUNDRY_PROJECT_NAME` | Foundry Agent examples                                                                                                                                                                                                                             |
| `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`         | MSAL (Entra ID) examples                                                                                                                                                                                                                           |
| `VITE_AVATAR_CHARACTER`, `VITE_AVATAR_STYLE`           | Avatar examples (optional)                                                                                                                                                                                                                         |

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

```bash
just dev-examples
```

Open http://localhost:3001 in your browser.

## Examples

| Route                                                                                          | What it shows                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/voice-basic`                                                                                 | Minimal voice chat with auto-start microphone                                                                                                                     |
| `/voice-advanced`                                                                              | Semantic VAD, echo cancellation, noise suppression, barge-in, greeting, transcripts                                                                               |
| `/voice-webrtc`                                                                                | WebRTC transport (preview): RTP audio + WebSocket control channel, greeting, text input; direct with an API key or through the proxy (keyless) when no key is set |
| `/azure-realtime`                                                                              | `azure-realtime` model with native voices (voice picker)                                                                                                          |
| `/voice-proxy`, `/voice-proxy-msal`                                                            | Backend proxy with API key / Entra ID (MSAL); `/voice-proxy` enables `reconnect: true` — restart the proxy while connected to see it recover                      |
| `/avatar-basic`, `/avatar-advanced`, `/avatar-proxy`, `/avatar-proxy-msal`                     | Avatar video, chroma key, proxy variants                                                                                                                          |
| `/foundry-agent`, `/foundry-agent-msal`, `/foundry-agent-avatar`, `/foundry-agent-avatar-msal` | Foundry Agents via the proxy (server-side auth or MSAL)                                                                                                           |
| `/function-calling`                                                                            | Client-side tools; the `toolExecutor` return value is sent automatically                                                                                          |
| `/interim-response`                                                                            | Filler messages while a slow tool runs (`gpt-4.1` + Azure voice)                                                                                                  |
| `/mcp-tools`                                                                                   | Server-side MCP tools with an approval flow                                                                                                                       |
| `/audio-visualizer`                                                                            | Waveform from `audioAnalyser`                                                                                                                                     |
| `/viseme`, `/live2d-avatar`, `/avatar-3d`                                                      | Viseme events driving custom lip-sync                                                                                                                             |

All pages pass `logLevel: 'debug'` to `useVoiceLive` so every event shows up in the browser console.

## License

Examples are MIT licensed. Note that Live2D models have their own licensing terms - see [Live2D License](https://www.live2d.com/en/terms/live2d-free-material-license-agreement/).
