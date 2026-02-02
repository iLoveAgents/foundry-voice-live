# Azure AI Foundry Voice Live Proxy

[![npm version](https://img.shields.io/npm/v/@iloveagents/foundry-voice-live-proxy-node.svg)](https://www.npmjs.com/package/@iloveagents/foundry-voice-live-proxy-node)
[![CI](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml/badge.svg)](https://github.com/iLoveAgents/foundry-voice-live/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Secure WebSocket proxy for Azure AI Foundry Voice Live API. Supports Voice, Avatar, and Agent modes.

**Why use this proxy?** Browser WebSockets cannot send Authorization headers, and Azure AI Foundry endpoints require them. This proxy injects credentials server-side and forwards messages transparently.

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

Copy `.env.example` to `.env` and configure:

```bash
# Required
FOUNDRY_RESOURCE_NAME=your-resource-name

# Authentication (one of these)
FOUNDRY_API_KEY=your-api-key          # Option 1: API key (simpler)
# Or let clients pass MSAL tokens     # Option 2: Per-user auth (enterprise)

# Server (optional)
PORT=8080
API_VERSION=2025-10-01

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
const ws = new WebSocket(`ws://localhost:8080/ws?token=${token.accessToken}`);
```

```bash
# Backend .env
FOUNDRY_RESOURCE_NAME=your-resource
# No API key - uses client's MSAL token
```

**Setup:**

1. Create Azure App Registration with `https://ai.azure.com/.default` scope
2. Assign "Cognitive Services User" role on your AI Foundry resource
3. Configure MSAL in your frontend app

### 3. Agent Mode

Best for: custom agents built in Azure AI Foundry.

```typescript
// Frontend - pass agentId, projectName, and token
const token = await msalInstance.acquireTokenSilent({
  scopes: ["https://ai.azure.com/.default"],
});
const ws = new WebSocket(
  `ws://localhost:8080/ws?agentId=asst_abc123&projectName=my-project&token=${token.accessToken}`
);
```

```bash
# Backend .env
FOUNDRY_RESOURCE_NAME=your-resource
# agentId and projectName come from client URL
```

**Mode detection is automatic:** Agent mode activates when both `agentId` and `projectName` are present.

## Deployment

### Docker Compose (Recommended)

```bash
cp .env.example .env
# Edit .env with your values
docker-compose up -d
```

### Docker

```bash
docker build -t foundry-voice-live-proxy .
docker run -p 8080:8080 --env-file .env foundry-voice-live-proxy
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

| Parameter     | Required    | Description                      | Example        |
| ------------- | ----------- | -------------------------------- | -------------- |
| `token`       | Conditional | MSAL access token                | `eyJ0eXAi...`  |
| `agentId`     | Conditional | Agent ID (enables Agent mode)    | `asst_123xyz`  |
| `projectName` | Conditional | Project name (with agentId)      | `my-project`   |
| `model`       | No          | Model override                   | `gpt-realtime` |

### Environment Variables

| Variable                   | Required    | Default                 | Description                  |
| -------------------------- | ----------- | ----------------------- | ---------------------------- |
| `FOUNDRY_RESOURCE_NAME`    | Yes         | -                       | Azure AI Foundry resource    |
| `FOUNDRY_API_KEY`          | Conditional | -                       | API key (if not using MSAL)  |
| `PORT`                     | No          | `8080`                  | Server port                  |
| `API_VERSION`              | No          | `2025-10-01`            | Azure API version            |
| `ALLOWED_ORIGINS`          | No          | `http://localhost:3000` | CORS origins (comma-sep)     |
| `RATE_LIMIT_MAX_REQUESTS`  | No          | `100`                   | Max requests per window      |
| `RATE_LIMIT_WINDOW_MS`     | No          | `60000`                 | Rate limit window (ms)       |
| `MAX_CONNECTIONS`          | No          | `1000`                  | Max concurrent connections   |

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
| "Missing token" | Agent mode requires MSAL token in URL |
| "API key required" | Standard mode needs `FOUNDRY_API_KEY` or client MSAL token |

## Support

If this library made your life easier, a coffee is a simple way to say thanks ☕
It directly supports maintenance and future features.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow.svg)](https://buymeacoffee.com/leitwolf)

## License

MIT - Made with 💜 by [iLoveAgents](https://iloveagents.ai)
