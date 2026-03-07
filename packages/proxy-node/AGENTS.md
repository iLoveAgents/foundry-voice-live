# Proxy Server

Package: `@iloveagents/foundry-voice-live-proxy-node`

## Purpose

Secure WebSocket proxy between browser clients and Voice Live API.

- Transparent message pass-through (does not parse or modify WebSocket payloads)
- Handles authentication: API key, MSAL token passthrough, or DefaultAzureCredential
- Supports Standard (Voice/Avatar), Foundry Agents, and Agent Service (classic) modes
- Mode is auto-detected from URL query parameters

## Commands

```bash
just build-proxy      # Build package
just test-proxy       # Run tests
just dev-proxy        # Start dev server (port 8080)
```

## Structure

```text
src/
  index.ts            # Express + WebSocket server, buildAzureUrl, token acquisition
  types.ts            # TypeScript type definitions (QueryParams, ProxyConfig, etc.)
  __tests__/          # Unit tests
Dockerfile
docker-compose.yml
```

## Key Concepts

- `buildAzureUrl()` is async — resolves auth (API key, MSAL token, or DefaultAzureCredential)
- Token from URL `?token=` is moved to `Authorization: Bearer` header (browser WebSocket limitation)
- `@azure/identity` `DefaultAzureCredential` handles token caching/refresh internally
- Environment vars in `.env` configure defaults; URL params can override

## Design

- ES Modules (`"type": "module"`)
- Express with express-ws for WebSocket support
- Docker-ready with health checks
- Environment-based configuration

See `README.md` for full configuration, auth modes, query parameters, and deployment options.
