# Azure AI Foundry Voice Live Proxy

[![CI](https://github.com/iLoveAgents/foundry-voice-live-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/iLoveAgents/foundry-voice-live-proxy/actions/workflows/ci.yml)
[![Tests](https://github.com/iLoveAgents/foundry-voice-live-proxy/actions/workflows/tests.yml/badge.svg)](https://github.com/iLoveAgents/foundry-voice-live-proxy/actions/workflows/tests.yml)
[![CodeQL](https://github.com/iLoveAgents/foundry-voice-live-proxy/actions/workflows/codeql.yml/badge.svg)](https://github.com/iLoveAgents/foundry-voice-live-proxy/actions/workflows/codeql.yml)

Secure WebSocket proxy for Azure AI Foundry Voice Live (Voice, Avatar, Agent). Keeps credentials server-side, enforces security (CORS, rate limits, headers), and forwards messages transparently.

This proxy is required for browser-based apps because browser WebSockets cannot send Authorization headers, and Azure AI Foundry's Realtime endpoints do not accept tokens via the query string; the proxy injects credentials server-side and forwards the stream securely.

## Quick start (local)

Prerequisites: Node.js 18+, Azure subscription + Azure AI Foundry (hub/project). Setup: <https://learn.microsoft.com/azure/ai-studio/>

1. Install

- WS: ws://localhost:8080/ws
- Health: <http://localhost:8080/health>

## Configuration (env)

Copy from `.env.example`. Common settings:

```bash
# Server
PORT=8080
API_VERSION=2025-10-01

# Security
ALLOWED_ORIGINS=http://localhost:3000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
MAX_CONNECTIONS=1000

# Azure (required)
AZURE_AI_FOUNDRY_RESOURCE=your-resource-name

# Standard mode (optional if client sends MSAL token)
AZURE_SPEECH_KEY=your-api-key

# Telemetry (optional)
# APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=...
```

## Run with Docker

Using docker-compose (recommended):

```bash
cp .env.example .env
docker-compose up -d
docker-compose logs -f
# docker-compose down
```

Using Docker directly:

```bash
npm run docker:build
npm run docker:run
# or
docker build -t foundry-voice-live-proxy .
docker run -p 8080:8080 --env-file .env foundry-voice-live-proxy
```

### Docker health checks

- App endpoint: `GET /health`
- Dockerfile and docker-compose include a `HEALTHCHECK` probing `/health`.
- Quick verify:

```sh
curl http://localhost:8080/health
```

## Pull and run from Azure Container Registry (ACR)

Public image:

```bash
docker pull iloveagents.azurecr.io/foundry-voice-live-proxy:main
docker run -p 8080:8080 \
  -e AZURE_AI_FOUNDRY_RESOURCE=your-resource \
  -e AZURE_SPEECH_KEY=your-key \
  iloveagents.azurecr.io/foundry-voice-live-proxy:main
```

## Host on Microsoft Azure

### Option 1: Azure Container Apps

## Advanced Configuration

### Authentication Options

**API Key (shared access):**

Use when: Quick demos, internal tools, shared access OK

**Frontend:**

```typescript
// Mode is automatically detected as "standard" (no agentId/projectName)
proxyUrl: "ws://localhost:8080/ws?model=gpt-realtime";
```

**Backend (.env):**

```bash
AZURE_AI_FOUNDRY_RESOURCE=your-resource
AZURE_SPEECH_KEY=your-api-key  # Secured server-side
```

**Benefits:**

- Simple setup
- No user authentication needed
- Good for internal applications

**MSAL Token (user-level auth):**

Use when: Enterprise apps, need per-user auditing, SSO integration

**Frontend:**

```typescript
const token = await msalInstance.acquireTokenSilent({
  scopes: ["https://ai.azure.com/.default"],
});

// Mode is automatically detected as "standard" (no agentId/projectName)
proxyUrl: `ws://localhost:8080/ws?model=gpt-realtime&token=${token.accessToken}`;
```

**Backend (.env):**

```bash
AZURE_AI_FOUNDRY_RESOURCE=your-resource
# No API key needed - uses user's MSAL token
```

**Benefits:**

- No API keys stored anywhere
- Each user authenticated individually
- Tokens auto-expire (1 hour)
- Works with Conditional Access policies
- Enterprise SSO support

**Setup required:**

1. Azure App Registration with scope: `https://ai.azure.com/.default`
2. Assign "Cognitive Services User" role on AI Foundry resource
3. Install `@azure/msal-react` and configure MsalProvider

**Agent Mode (Azure AI Foundry Agent Service):**

Use when: Using custom agents built in Azure AI Foundry

**Frontend:**

```typescript
const token = await msalInstance.acquireTokenSilent({
  scopes: ["https://ai.azure.com/.default"],
});

// Mode is automatically detected as "agent" (agentId and projectName present)
proxyUrl: `ws://localhost:8080/ws?agentId=asst_abc123&projectName=my-project&token=${token.accessToken}`;
```

**Backend (.env):**

```bash
AZURE_AI_FOUNDRY_RESOURCE=your-resource
# No API key needed - uses user's MSAL token
# agentId and projectName come from client (not .env)
```

**Benefits:**

- User-level authentication with custom agents
- Per-user agent access control
- MSAL token auto-expires (1 hour)
- Transparent proxy - client controls agent selection

**Requirements:**

1. Azure App Registration with scope: `https://ai.azure.com/.default`
2. User has access to the specified agent in Azure AI Foundry
3. Client must provide both `agentId` and `projectName` in URL

### Deployment Options

**PM2:**

```bash
npm install -g pm2
pm2 start dist/index.js --name azure-voice-proxy
pm2 save
pm2 startup
```

**Docker:**

```bash
cp .env.example .env
docker-compose up -d
```

See "Run with Docker" section above for details.

**Azure:** See "Host on Microsoft Azure" section above for Container Apps, App Service, and Container Instances.

## Reference

### Environment Variables

| Variable                    | Required    | Description                  | Default                 |
| --------------------------- | ----------- | ---------------------------- | ----------------------- |
| `PORT`                      | No          | Server port                  | 8080                    |
| `API_VERSION`               | No          | Azure API version            | 2025-10-01              |
| `AZURE_AI_FOUNDRY_RESOURCE` | Yes         | Azure resource name          | -                       |
| `AZURE_SPEECH_KEY`          | Conditional | API key for Voice/Avatar     | -                       |
| `ALLOWED_ORIGINS`           | No          | Comma-separated CORS origins | `http://localhost:3000` |
| `RATE_LIMIT_WINDOW_MS`      | No          | Rate limit time window (ms)  | 60000                   |
| `RATE_LIMIT_MAX_REQUESTS`   | No          | Max requests per window      | 100                     |
| `MAX_CONNECTIONS`           | No          | Max concurrent connections   | 1000                    |

### WebSocket Query Parameters

**Mode Detection:** Mode is automatically detected - Agent mode when `agentId` and `projectName` are present, otherwise Standard mode.

| Parameter     | Required    | Description                                          | Example        |
| ------------- | ----------- | ---------------------------------------------------- | -------------- |
| `model`       | No          | Model name (Standard mode)                           | `gpt-realtime` |
| `token`       | Conditional | MSAL access token                                    | From Azure AD  |
| `agentId`     | Conditional | Agent ID (triggers Agent mode, requires projectName) | `asst_123xyz`  |
| `projectName` | Conditional | Project name (triggers Agent mode, requires agentId) | `my-project`   |

### API Endpoints

| Endpoint  | Method | Description                 |
| --------- | ------ | --------------------------- |
| `/`       | GET    | API information and version |
| `/health` | GET    | Health check endpoint       |
| `/ws`     | WS     | WebSocket proxy connection  |

**Health Check Response:**

```json
{
  "status": "ok",
  "activeConnections": 5,
  "maxConnections": 1000,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Common errors:**

- Connection fails: Verify `.env` values and check `curl http://localhost:8080/health`
- "Blocked by CORS": Add origin to `ALLOWED_ORIGINS`
- "Too many requests": Rate limit exceeded, adjust limits or wait
- "Missing token parameter": Agent mode requires MSAL token
- "AZURE_SPEECH_KEY required": Standard mode needs API key OR MSAL token

## License

MIT

Made with 💜 [iLoveAgents](https://iloveagents.ai)

## Contributing

PRs welcome. This README focuses on running and configuring the proxy; CI/workflow details are intentionally omitted.
