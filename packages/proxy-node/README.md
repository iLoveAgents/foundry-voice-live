# Azure AI Foundry Voice Live Proxy

[![npm version](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-proxy-node.svg)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node)
[![CI](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml/badge.svg)](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Secure WebSocket proxy for Azure AI Foundry Voice Live API. Supports Voice, Avatar, and Foundry Agents over the WebSocket or WebRTC (preview) transport.

**Why use this proxy?** Browser WebSockets cannot send Authorization headers, and API keys must never ship to the browser. This proxy keeps credentials server-side (API key or `DefaultAzureCredential`), moves per-user tokens into the `Authorization` header, and forwards messages transparently.

## Installation

Requires **Node.js 20 or newer** (`@azure/identity` needs 20+); the Docker image and CI run on Node 22.

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

   No API key? Skip `FOUNDRY_API_KEY` and run `az login` — the proxy falls back to `DefaultAzureCredential`.

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

   With the React SDK: `useVoiceLive({ connection: { proxyUrl: "ws://localhost:8080/ws" } })`.

## Configuration

> **Region Availability:** The default model (`gpt-realtime`) is only available in **East US 2** and **Sweden Central** regions. Make sure your Azure AI Foundry resource is deployed in one of these regions. See [Microsoft docs](https://learn.microsoft.com/azure/ai-foundry/openai/concepts/models#global-standard-model-availability) for current availability.

Copy `.env.example` to `.env` and configure:

```bash
# Required
FOUNDRY_RESOURCE_NAME=your-resource-name

# Authentication (optional - see priority below)
FOUNDRY_API_KEY=your-api-key          # Shared API key (standard mode)
# Unset: clients pass ?token= (per-user) or the proxy uses DefaultAzureCredential (az login)

# Server (optional)
PORT=8080
# API_VERSION=2026-07-15              # Default when unset (GA); ?apiVersion= overrides per connection

# Foundry Agents (optional .env fallback for agentName/projectName)
# FOUNDRY_AGENT_NAME=MyAgent
# FOUNDRY_PROJECT_NAME=my-project

# Security (optional)
ALLOWED_ORIGINS=http://localhost:3000,https://your-app.com
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
MAX_CONNECTIONS=1000

# Telemetry (optional)
# APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...
```

## Authentication

For every connection the proxy resolves credentials in this order (both modes):

| Priority | Source                                           | Standard mode | Foundry Agents |
| -------- | ------------------------------------------------ | ------------- | -------------- |
| 1        | `?token=` query param (per-user Entra ID / MSAL) | ✅            | ✅             |
| 2        | `FOUNDRY_API_KEY` env (shared key)               | ✅            | –              |
| 3        | `DefaultAzureCredential` (server-side, keyless)  | ✅            | ✅             |

Credentials are always sent upstream as headers — `Authorization: Bearer` for tokens, `api-key` for a shared key — so they never appear in the upstream URL, where dependency tracing (Application Insights collects the full URL of every outbound request) would export them. `token` / `api-key` / `Authorization` values are also redacted from logs, matching parameter names the way a server reads them (percent-decoded, case-insensitive). Errors sent back to the browser are limited to problems with its own request; token-acquisition, DNS and upstream-handshake details stay in the server log.

> **Behind a load balancer.** Without `TRUST_PROXY`, every request appears to come from the ingress, so the per-IP rate limit becomes one global bucket that a single client can exhaust for everyone. Set `TRUST_PROXY=1` (or the number of proxies in front of the service) only when something actually rewrites `X-Forwarded-For` — otherwise a client can spoof its own address.
>
> **Invalid limits fail closed.** A non-numeric `MAX_CONNECTIONS` / `MAX_FRAME_BYTES` / `RATE_LIMIT_*` value falls back to the default with a warning instead of silently removing the limit.

> **Origin enforcement.** Browser connections are checked against `ALLOWED_ORIGINS` on the HTTP request _and_ on the WebSocket upgrade (matching is exact — a prefix check would let `http://localhost:3001.attacker.com` through). Requests **without** an `Origin` header (curl, native apps, server-to-server) are allowed by design, so the origin check alone does not authenticate anyone: pair it with network rules or your own auth.

> **Trust boundary.** With a shared API key or `DefaultAzureCredential`, every client that can reach `/ws` acts with the proxy's credentials — for any model and any agent the key/identity can access, in either mode. Restrict who can reach the proxy (`ALLOWED_ORIGINS`, network rules, your own auth in front of it) or use per-user `?token=` auth so each user is authorized and audited individually.

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

### 2. Token (Per-User Auth)

Best for: enterprise apps, per-user auditing, SSO.

```typescript
// Frontend - acquire and pass token
const token = await msalInstance.acquireTokenSilent({
  scopes: ["https://ai.azure.com/.default"],
});
const ws = new WebSocket(`ws://localhost:8080/ws?token=${token.accessToken}`);
```

```bash
# Backend .env
FOUNDRY_RESOURCE_NAME=your-resource
# No API key - uses the client's token
```

**Setup:**

1. Create Azure App Registration with `https://ai.azure.com/.default` scope
2. Assign "Cognitive Services User" role on your AI Foundry resource
3. Configure MSAL in your frontend app

### 3. Keyless (DefaultAzureCredential)

Best for: local development without keys, managed identity in production.

```typescript
// Frontend - nothing to pass
const ws = new WebSocket("ws://localhost:8080/ws");
```

```bash
# Backend .env - no FOUNDRY_API_KEY
FOUNDRY_RESOURCE_NAME=your-resource
```

For local dev, run `az login` (the identity needs the "Cognitive Services User" role on the Foundry resource). In production, use managed identity or a service principal — [`DefaultAzureCredential`](https://learn.microsoft.com/javascript/api/@azure/identity/defaultazurecredential) picks it up automatically.

### 4. Foundry Agents

Best for: agents built in [Azure AI Foundry](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart).

**Server-side auth** — proxy acquires tokens via `DefaultAzureCredential`:

```typescript
// Frontend - pass agent config, proxy handles auth
const ws = new WebSocket("ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject");
```

```bash
# Backend .env
FOUNDRY_RESOURCE_NAME=your-resource
```

**Per-user auth** — pass an Entra ID token alongside the agent params:

```typescript
const token = await msalInstance.acquireTokenSilent({
  scopes: ["https://ai.azure.com/.default"],
});
const ws = new WebSocket(
  `ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject&token=${token.accessToken}`
);
```

**Mode detection is automatic:** Foundry Agent mode activates when `agentName` is present in the URL, or when `FOUNDRY_AGENT_NAME` / `FOUNDRY_PROJECT_NAME` are set in `.env` and the URL has no `model` param. Optional agent params (`conversationId`, `agentVersion`, `agentAuthenticationIdentityClientId`, `foundryResourceOverride`) are forwarded upstream as-is.

## Transports

| Transport           | Client URL                                    | Upstream path                | Default API version                   |
| ------------------- | --------------------------------------------- | ---------------------------- | ------------------------------------- |
| WebSocket (default) | `ws://localhost:8080/ws?...`                  | `/voice-live/realtime`       | `API_VERSION` or `2026-07-15`         |
| WebRTC (preview)    | `ws://localhost:8080/ws?...&transport=webrtc` | `/voice-live/realtime/calls` | `API_VERSION` or `2026-01-01-preview` |

With `transport=webrtc` the proxied WebSocket becomes the WebRTC control channel (`rtc.call.*` events for SDP offer/answer plus the usual session events); audio flows directly between the browser and Azure over the WebRTC peer connection, not through the proxy. The React SDK appends `transport=webrtc` (and `apiVersion` when configured) automatically when you set `connection.transport: 'webrtc'`.

> **Live-verified (August 2026):** the WebRTC control channel is only served on api-version `2026-01-01-preview` (`2026-04-10` → 404, `2026-06-01-preview` → 401); all three auth methods (token, API key, `DefaultAzureCredential`) work with it. If you pin `API_VERSION` to a GA version, WebRTC clients must pass `?apiVersion=2026-01-01-preview`.

## Deployment

### Docker Compose (Recommended)

```bash
cp .env.example .env
# Edit .env with your values
docker-compose up -d
```

### Docker

Build from the **repository root** (the image installs with the workspace lockfile, so the build
context has to include it):

```bash
docker build -f packages/proxy-node/Dockerfile -t foundry-voice-live-proxy .
```

```bash
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

Prefer keyless: assign a managed identity to the container app with the "Cognitive Services User" role and drop `FOUNDRY_API_KEY`.

## API Reference

### Endpoints

| Endpoint  | Method | Description                                       |
| --------- | ------ | ------------------------------------------------- |
| `/`       | GET    | API info: version, supported params, API versions |
| `/health` | GET    | Health check (for probes)                         |
| `/ws`     | WS     | WebSocket proxy connection                        |

### WebSocket Query Parameters

| Parameter                             | Required    | Description                                                        | Example                                |
| ------------------------------------- | ----------- | ------------------------------------------------------------------ | -------------------------------------- |
| `model`                               | No          | Model for standard mode (default `gpt-realtime`)                   | `gpt-realtime`                         |
| `token`                               | No          | Entra ID / MSAL access token (moved to the `Authorization` header) | `eyJ0eXAi...`                          |
| `agentName`                           | Conditional | Foundry Agent name (enables agent mode; `.env` fallback)           | `MyAgent`                              |
| `projectName`                         | Conditional | Foundry project name (with `agentName`; `.env` fallback)           | `my-project`                           |
| `conversationId`                      | No          | Resume a previous conversation (agent mode)                        | `conv_abc123`                          |
| `agentVersion`                        | No          | Pin a specific agent version (agent mode)                          | `1.0`                                  |
| `agentAuthenticationIdentityClientId` | No          | Client ID of the user-assigned managed identity the agent runs as  | `00000000-0000-0000-0000-000000000000` |
| `foundryResourceOverride`             | No          | Override the Foundry resource used by the agent                    | `other-resource`                       |
| `transport`                           | No          | `websocket` (default) or `webrtc` (preview)                        | `webrtc`                               |
| `apiVersion`                          | No          | Override the API version for this connection                       | `2026-01-01-preview`                   |

Upstream parameter names: `agentName` → `agent-name`, `projectName` → `agent-project-name`, `conversationId` → `conversation-id`, `agentVersion` → `agent-version`, `agentAuthenticationIdentityClientId` → `agent-authentication-identity-client-id`, `foundryResourceOverride` → `foundry-resource-override`. `token` and `transport` are consumed by the proxy and not forwarded.

### Environment Variables

| Variable                                | Required | Default                 | Description                                                                                                                    |
| --------------------------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `FOUNDRY_RESOURCE_NAME`                 | Yes      | -                       | Azure AI Foundry resource                                                                                                      |
| `FOUNDRY_API_KEY`                       | No       | -                       | Shared API key (standard mode); unset = token or `DefaultAzureCredential`                                                      |
| `FOUNDRY_AGENT_NAME`                    | No       | -                       | Default agent name (fallback when the URL has no `agentName`/`model`)                                                          |
| `FOUNDRY_PROJECT_NAME`                  | No       | -                       | Default project name (fallback)                                                                                                |
| `PORT`                                  | No       | `8080`                  | Server port                                                                                                                    |
| `API_VERSION`                           | No       | `2026-07-15`            | Voice Live API version (WebRTC defaults to `2026-01-01-preview` when unset)                                                    |
| `ALLOWED_ORIGINS`                       | No       | `http://localhost:3000` | CORS origins (comma-sep)                                                                                                       |
| `RATE_LIMIT_MAX_REQUESTS`               | No       | `100`                   | Max requests per window                                                                                                        |
| `RATE_LIMIT_WINDOW_MS`                  | No       | `60000`                 | Rate limit window (ms)                                                                                                         |
| `MAX_FRAME_BYTES`                       | No       | `1048576`               | Largest accepted browser frame (1 MiB); offenders are closed with `1009`                                                       |
| `MAX_CONNECTIONS`                       | No       | `1000`                  | Max concurrent connections                                                                                                     |
| `TRUST_PROXY`                           | No       | _(off)_                 | Express `trust proxy` (hop count, `true`, or IP list) — set it behind an ingress so the per-IP rate limit sees real client IPs |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | No       | -                       | Enable Application Insights telemetry                                                                                          |

### Health Check Response

```json
{
  "status": "ok",
  "activeConnections": 5,
  "maxConnections": 1000,
  "timestamp": "2026-08-18T10:30:00.000Z"
}
```

## Troubleshooting

| Error                                     | Solution                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Connection fails                          | Check `.env` values, verify with `curl http://localhost:8080/health`                                             |
| "Blocked by CORS"                         | Add your origin to `ALLOWED_ORIGINS`                                                                             |
| "Too many requests"                       | Rate limit hit - wait or increase `RATE_LIMIT_MAX_REQUESTS`                                                      |
| "Entra ID token acquisition failed"       | No `token`/`FOUNDRY_API_KEY` → proxy used `DefaultAzureCredential`: run `az login` or configure managed identity |
| "requires both agentName and projectName" | Pass both URL params, or set `FOUNDRY_AGENT_NAME` + `FOUNDRY_PROJECT_NAME` in `.env`                             |
| "Unsupported transport"                   | `transport` must be `websocket` or `webrtc`                                                                      |
| WebRTC connection rejected upstream       | Ensure the API version is a preview that supports WebRTC (`?apiVersion=2026-01-01-preview`)                      |

## Support

If this library made your life easier, a coffee is a simple way to say thanks ☕
It directly supports maintenance and future features.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow.svg)](https://buymeacoffee.com/leitwolf)

## License

MIT - Made with 💜 by [iLoveAgents](https://iloveagents.ai)
