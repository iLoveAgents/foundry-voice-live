# Proxy Server

Package: `@iloveagents/foundry-voice-live-proxy-node`

## Purpose

Secure WebSocket proxy between browser clients and Voice Live API.

- Transparent message pass-through (does not parse or modify WebSocket payloads)
- Handles authentication: browser token passthrough, API key, or DefaultAzureCredential
- Supports Standard (Voice/Avatar) and Foundry Agents modes
- Supports the WebSocket (default) and WebRTC (preview) transports
- Mode and transport are auto-detected from URL query parameters

## Commands

```bash
just build-proxy      # Build package
just test-proxy       # Run tests
just dev-proxy        # Start dev server (port 8080)
```

## Structure

```text
src/
  index.ts            # Express + WebSocket server, logging, telemetry, DefaultAzureCredential, relay
  pendingQueue.ts     # PendingMessageQueue: pre-connect frames, bounded by count AND bytes
  security.ts         # isOriginAllowed: exact-match origin check (HTTP + the WS upgrade)
  url.ts              # Pure: buildAzureUrl, resolveMode/Transport/ApiVersion, redactUrl, defaults
  packageInfo.ts      # Reads name/version from package.json (GET / info endpoint, banner)
  types.ts            # TypeScript type definitions (QueryParams, ProxyConfig, ProxyMode, ...)
  __tests__/          # Unit tests (url.test.ts, packageInfo.test.ts)
Dockerfile
docker-compose.yml
```

## Key Concepts

- `url.ts` is a pure module (no express / applicationinsights / @azure/identity) — all upstream
  URL, mode, transport, API-version and auth resolution lives there and is unit-tested. `index.ts`
  only injects `getEntraToken` and adds logging/telemetry.
- `buildAzureUrl(query, cfg, { getEntraToken })` is async — resolves auth in this order:
  browser `?token=` > `FOUNDRY_API_KEY` (standard mode only) > `DefaultAzureCredential` (both modes)
- Token from URL `?token=` is moved to `Authorization: Bearer` header (browser WebSocket limitation);
  tokens never appear in the upstream URL, and `redactUrl()` masks `token`/`api-key`/`Authorization` in logs
- Transport: `?transport=webrtc` → upstream `/voice-live/realtime/calls` (WebRTC control channel,
  default api-version `2026-01-01-preview`); default → `/voice-live/realtime` (`2026-07-15`).
  The relay is identical for both — `rtc.call.*` are plain JSON text frames.
- API version precedence: `?apiVersion=` > `API_VERSION` env > built-in default per transport
- Origin is validated in the `/ws` handler as well as in CORS: with `express-ws` the upgrade
  completes before middleware runs, so a CORS rejection cannot prevent the connection
- Only `ProxyRequestError`s (bad client parameters) are echoed to the browser; every other failure
  is reported as a generic message and logged server-side
- Foundry Agents params forwarded upstream: `agent-name`, `agent-project-name`, `conversation-id`,
  `agent-version`, `agent-authentication-identity-client-id`, `foundry-resource-override`
- `.env` agent fallback (`FOUNDRY_AGENT_NAME`/`FOUNDRY_PROJECT_NAME`) applies only when the URL has no `model` param
- `@azure/identity` `DefaultAzureCredential` handles token caching/refresh internally
- Environment vars in `.env` configure defaults; URL params can override

## Design

- ES Modules (`"type": "module"`, `.js` import suffixes)
- Express with express-ws for WebSocket support
- Docker-ready with health checks
- Environment-based configuration

See `README.md` for full configuration, auth modes, query parameters, and deployment options.
