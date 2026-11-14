# Azure AI Foundry Voice Live Proxy

[![npm version](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-proxy-node.svg)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node)
[![CI](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml/badge.svg)](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Secure WebSocket proxy for Azure AI Foundry Voice Live API. Supports Voice, Avatar, and Agent modes.

**Why use this proxy?** Browser WebSockets cannot set Authorization headers. Voice Live also supports query-string authentication, but this proxy keeps resource API keys server-side, sends credentials in upgrade headers where supported, and forwards protocol messages transparently.

The default service API is **`2026-07-15`** (GA), checked against the [Microsoft Voice Live reference](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference-2026-07-15). Streaming text, MCP events, hosted-agent invocation events, native Azure realtime voices, and session expiration metadata pass through without payload changes. The proxy supports WebSocket audio and the preview Voice Live WebRTC transport through a persistent WebSocket signaling/control channel. With WebRTC, audio flows directly between the browser and Voice Live over RTP media tracks.

## Installation

**npm:**

```bash
npm install @iloveagents/foundry-voice-live-proxy-node
```

**Docker:**

```bash
docker pull ghcr.io/iloveagents/foundry-voice-live-proxy:latest
```

## Quick Start

1. **Configure environment**

   ```bash
   # Create .env file
   cat > .env << 'EOF'
   FOUNDRY_RESOURCE_NAME=your-resource-name
   FOUNDRY_API_KEY=your-api-key
   EOF
   ```

2. **Run the proxy**

   ```bash
   # With Docker (recommended)
   docker run -p 8080:8080 --env-file .env ghcr.io/iloveagents/foundry-voice-live-proxy:latest

   # Or with npm
   npx @iloveagents/foundry-voice-live-proxy-node
   ```

3. **Verify it's running**

   ```bash
   curl http://localhost:8080/health
   ```

4. **Connect from your app**

   ```typescript
   const ws = new WebSocket("ws://localhost:8080/ws");
   ```

## Configuration

> **Region Availability:** Model, voice, and agent availability varies by region. Check the [Voice Live model and region documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live) for your resource before connecting.

Copy `.env.example` to `.env` and configure:

```bash
# Required
FOUNDRY_RESOURCE_NAME=your-resource-name

# Authentication (one of these)
FOUNDRY_API_KEY=your-api-key          # Option 1: API key (simpler)
# Or let clients pass MSAL tokens     # Option 2: Per-user auth (enterprise)
# Or omit both for DefaultAzureCredential (managed identity / Azure CLI)

# Server (optional)
PORT=8080
API_VERSION=2026-07-15

# Security (optional)
ALLOWED_ORIGINS=http://localhost:3000,https://your-app.com
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
MAX_CONNECTIONS=1000

# Telemetry (optional)
# APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...
```

## Authentication Modes

### 1. API Key (Shared Access)

Best for: demos, internal tools, trusted environments.

```typescript
// Frontend - no token needed
const ws = new WebSocket("ws://localhost:8080/ws");
```

```bash
# Backend .env
FOUNDRY_RESOURCE_NAME=your-resource
FOUNDRY_API_KEY=your-api-key  # Secured server-side
```

### 2. MSAL Token (Per-User Auth)

Best for: enterprise apps, per-user auditing, SSO.

```typescript
// Frontend - acquire and pass token
const token = await msalInstance.acquireTokenSilent({
  scopes: ["https://ai.azure.com/.default"],
});
const ws = new WebSocket(`ws://localhost:8080/ws?token=${encodeURIComponent(token.accessToken)}`);
```

```bash
# Backend .env
FOUNDRY_RESOURCE_NAME=your-resource
# No API key - uses client's MSAL token
```

**Setup:**

1. Create Azure App Registration with `https://ai.azure.com/.default` scope
2. Assign the applicable `Cognitive Services User` and `Foundry User` roles on your Foundry resource/project, as described in the [authentication documentation](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-api-reference-2026-07-15#endpoint-and-authentication). `Foundry User` was previously named `Azure AI User`.
3. Configure MSAL in your frontend app

### 3. Foundry Agent Service (Recommended)

Best for: agents built in [Azure AI Foundry](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart).

**Server-side auth** — proxy acquires tokens via `DefaultAzureCredential`:

```typescript
// Frontend - pass agent config, proxy handles auth
const ws = new WebSocket(
  "ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject"
);
```

```bash
# Backend .env
FOUNDRY_RESOURCE_NAME=your-resource
API_VERSION=2026-07-15
```

For local dev, run `az login`. In production, use managed identity or a service principal.

**MSAL auth** — per-user Entra ID tokens:

```typescript
// Frontend - pass agent config + MSAL token
const token = await msalInstance.acquireTokenSilent({
  scopes: ["https://ai.azure.com/.default"],
});
const ws = new WebSocket(
  `ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject&token=${encodeURIComponent(token.accessToken)}`
);
```

**Mode detection is automatic:** Foundry Agent mode activates when `agentName` is present in the URL, or through `FOUNDRY_AGENT_NAME` / `FOUNDRY_PROJECT_NAME` defaults. Explicit `model` or classic `agentId` requests do not inherit the default agent. Agent invocation uses Entra ID even when a resource API key is configured.

Standard model connections also use `DefaultAzureCredential` when neither a caller token nor `FOUNDRY_API_KEY` is supplied. Use managed identity in production or `az login` locally. Server credentials grant access to clients of this proxy; protect the proxy with your application authentication when deploying it publicly.

### 4. Agent Service (Classic v1)

Legacy mode for agents using `agentId` (Microsoft recommends [migrating to Foundry Agent Service](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-agent-integration#migrate-from-agent-service-classic)):

```typescript
const ws = new WebSocket(
  `ws://localhost:8080/ws?agentId=asst_abc123&projectName=my-project&token=${encodeURIComponent(token.accessToken)}`
);
```

Classic invocation forwards `agentAccessToken` as `agent-access-token` separately from Voice Live authentication. For compatibility, it falls back to `token` when both services accept the same token. If the classic agent requires a different token audience, supply `agentAccessToken` separately and authenticate Voice Live with `token`, a server API key, or server-side Entra credentials. See the [classic quickstart](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart-classic).

### BYOM and preview features

```typescript
const params = new URLSearchParams({
  model: "my-deployment",
  profile: "byom-foundry-openai-responses",
  foundryResourceOverride: "model-resource",
});
const ws = new WebSocket(`ws://localhost:8080/ws?${params}`);
```

Supported service profiles include `byom-azure-openai-realtime`, `byom-foundry-openai-responses`, `byom-azure-openai-chat-completion`, and the preview `byom-foundry-anthropic-messages`. Cross-resource usage requires the permissions described in the [BYOM documentation](https://learn.microsoft.com/azure/ai-services/speech-service/how-to-bring-your-own-model). For cross-resource agents, pass `foundryResourceOverride` and optionally `authenticationIdentityClientId`.

Pass `features=client_ec_reference:true` to opt into client echo-reference input. This feature remains preview: clients must also configure the matching session fields and produce interleaved stereo PCM16 with microphone and playback-reference channels. Forwarding a feature flag alone does not enable stereo capture.

### Voice Live WebRTC (preview)

Select the media transport when opening the proxy control connection:

```typescript
const signaling = new WebSocket(
  "ws://localhost:8080/ws?transport=webrtc&model=azure-realtime"
);
```

The proxy connects upstream to `/voice-live/realtime/calls` with the `realtime` WebSocket subprotocol and the same server-side authentication as other connections. The React SDK selects this path with `connection: { proxyUrl: "ws://localhost:8080/ws", transport: "webrtc" }`.

The browser creates an `RTCPeerConnection`, adds its microphone track and the `voice-live-events` data channel, and sends `rtc.call.sdp.create` containing its `sdp_offer` and session settings over this control socket. Apply the returned `rtc.call.sdp.created.sdp_answer` as the remote description. Keep the control socket open for `session.update`, function/tool calls, errors, and other control messages; audio travels over WebRTC tracks and transcription/lifecycle events arrive over the data channel. See [Microsoft's WebRTC guide](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-webrtc).

The proxy buffers up to 1 MiB of early control messages during token acquisition and the upstream handshake, so an SDP offer sent immediately after the browser socket opens is retained. Closing the browser socket closes its Azure control connection, including a pending handshake. The client remains responsible for closing its peer connection and stopping microphone tracks.

`transport=websocket` (the default) keeps the original `/voice-live/realtime` endpoint. HTTP SDP signaling is not implemented by this proxy. Voice Live WebRTC remains preview, and Microsoft currently does not support avatar configuration with this side-band control flow.

## Deployment

### Docker Compose (Recommended)

Run from `packages/proxy-node` in a repository checkout. Compose uses the repository root as its build context so it can apply the workspace lockfile and dependency overrides.

```bash
cp .env.example .env
# Edit .env with your values
docker compose up -d
```

### Docker

Build from the repository root. Both build and production dependencies use `pnpm install --frozen-lockfile`; the image runs Node.js 26 as a non-root user. The source Dockerfile requires the repository workspace and is not a standalone npm-package build.

```bash
docker build -f packages/proxy-node/Dockerfile -t foundry-voice-live-proxy .
docker run -p 8080:8080 --env-file packages/proxy-node/.env foundry-voice-live-proxy
```

### GitHub Container Registry

```bash
docker pull ghcr.io/iloveagents/foundry-voice-live-proxy:latest
docker run -p 8080:8080 \
  -e FOUNDRY_RESOURCE_NAME=your-resource \
  -e FOUNDRY_API_KEY=your-key \
  ghcr.io/iloveagents/foundry-voice-live-proxy:latest
```

### PM2 (Node.js)

```bash
npm install -g pm2
pm2 start node_modules/@iloveagents/foundry-voice-live-proxy-node/dist/index.js --name voice-proxy
pm2 save && pm2 startup
```

### Azure Container Apps

```bash
az containerapp create \
  --name voice-proxy \
  --resource-group your-rg \
  --environment your-env \
  --image ghcr.io/iloveagents/foundry-voice-live-proxy:latest \
  --target-port 8080 \
  --ingress external \
  --env-vars FOUNDRY_RESOURCE_NAME=your-resource FOUNDRY_API_KEY=your-key
```

## API Reference

### Endpoints

| Endpoint  | Method | Description                |
| --------- | ------ | -------------------------- |
| `/`       | GET    | API info and version       |
| `/health` | GET    | Health check (for probes)  |
| `/ws`     | WS     | WebSocket proxy connection |

### WebSocket Query Parameters

| Parameter        | Required    | Description                                  | Example           |
| ---------------- | ----------- | -------------------------------------------- | ------------------ |
| `transport` | No | `websocket` audio (default) or `webrtc` media with persistent control | `webrtc` |
| `agentName`      | Conditional | Foundry Agent name (enables v2 mode)         | `MyAgent`          |
| `projectName`    | Conditional | Foundry project name (with agentName/agentId)| `my-project`       |
| `token`          | Conditional | MSAL access token                            | `eyJ0eXAi...`      |
| `conversationId` | No          | Resume a previous conversation               | `conv_abc123`      |
| `agentVersion`   | No          | Pin a specific agent version                 | `1.0`              |
| `apiVersion`     | No          | Override API version                         | `2026-07-15` |
| `model`          | No          | Model override (standard mode)               | `gpt-realtime`     |
| `agentId`        | Conditional | Agent ID (classic v1 mode)                   | `asst_123xyz`      |
| `agentAccessToken` | No | Separate classic agent invocation token | `eyJ0eXAi...` |
| `features` | No | Service feature flags (preview where documented) | `client_ec_reference:true` |
| `profile` | No | BYOM routing profile | `byom-foundry-openai-responses` |
| `foundryResourceOverride` | No | Resource hosting the model or agent | `other-resource` |
| `authenticationIdentityClientId` | No | User-assigned identity for agent authentication | `<client-id>` |

### Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `FOUNDRY_RESOURCE_NAME` | Yes | - | Azure AI Foundry resource |
| `FOUNDRY_API_KEY` | Conditional | - | API key (otherwise caller token or DefaultAzureCredential) |
| `FOUNDRY_AGENT_NAME` | No | - | Default agent name (fallback) |
| `FOUNDRY_PROJECT_NAME` | No | - | Default project name (fallback) |
| `PORT` | No | `8080` | Server port |
| `API_VERSION` | No | `2026-07-15` | Azure API version (standard and Foundry Agent Service) |
| `ALLOWED_ORIGINS` | No | `http://localhost:3000` | CORS origins (comma-sep) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (ms) |
| `MAX_CONNECTIONS` | No | `1000` | Max concurrent connections |

### Health Check Response

```json
{
  "status": "ok",
  "activeConnections": 5,
  "maxConnections": 1000,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

## Troubleshooting

| Error | Solution |
| ----- | -------- |
| Connection fails | Check `.env` values, verify with `curl http://localhost:8080/health` |
| "Blocked by CORS" | Add your origin to `ALLOWED_ORIGINS` |
| "Too many requests" | Rate limit hit - wait or increase `RATE_LIMIT_MAX_REQUESTS` |
| "Missing token" | Classic agent mode (v1) requires MSAL token. Foundry Agent Service can use DefaultAzureCredential instead |
| Authentication fails | Provide a client MSAL token, configure `FOUNDRY_API_KEY` for standard mode, or configure DefaultAzureCredential |
| "Failed to acquire Entra ID token" | Run `az login` for local dev, or configure managed identity/service principal |

## Support

If this library made your life easier, a coffee is a simple way to say thanks ☕
It directly supports maintenance and future features.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow.svg)](https://buymeacoffee.com/leitwolf)

## License

MIT - Made with 💜 by [iLoveAgents](https://iloveagents.ai)
