# Proxy Server

Package: `@iloveagents/foundry-voice-live-proxy-node`

## Purpose

Secure WebSocket proxy between browser clients and Voice Live API.

- Hides Foundry credentials from client-side code
- Handles authentication via MSAL token or API key
- Provides rate limiting and security headers

## Commands

```bash
just build-proxy      # Build package
just test-proxy       # Run tests
just dev-proxy        # Start dev server (port 8080)
```

## Structure

```text
src/
  index.ts            # Express + WebSocket server
  __tests__/          # Unit tests
Dockerfile
docker-compose.yml
```

## Environment

```bash
FOUNDRY_RESOURCE_NAME=your-resource
FOUNDRY_API_KEY=your-key
PORT=8080
```

`FOUNDRY_API_KEY` is optional when using MSAL authentication.

## Design

- ES Modules (`"type": "module"`)
- Express with express-ws for WebSocket support
- Docker-ready with health checks
- Environment-based configuration

## Docker

```bash
docker build -t foundry-voice-live-proxy .
docker run -p 8080:8080 --env-file .env foundry-voice-live-proxy
```
