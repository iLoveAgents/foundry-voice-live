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
  closeFrame.ts       # toClientCloseFrame: forward upstream close codes (the SDK reconnects on them)
  url.ts              # Pure: buildAzureUrl, resolveMode/Transport/ApiVersion, redactUrl, defaults
  packageInfo.ts      # Reads name/version from package.json (GET / info endpoint, banner)
  types.ts            # TypeScript type definitions (QueryParams, ProxyConfig, ProxyMode, ...)
  __tests__/          # Unit tests (url, security, closeFrame, pendingQueue, packageInfo)
Dockerfile
docker-compose.yml
```

## Key Concepts

- `url.ts` is a pure module (no express / applicationinsights / @azure/identity) — all upstream
  URL, mode, transport, API-version and auth resolution lives there and is unit-tested. `index.ts`
  only injects `getEntraToken` and adds logging/telemetry.
- `buildAzureUrl(query, cfg, { getEntraToken })` is async — resolves auth in this order:
  browser `?token=` > `FOUNDRY_API_KEY` (standard mode only) > `DefaultAzureCredential` (both modes)
- **Credentials travel as headers, never in the upstream URL**: `?token=` becomes
  `Authorization: Bearer`, `FOUNDRY_API_KEY` becomes the `api-key` header. A URL is exported by
  dependency tracing (Application Insights records the full URL of every outbound request), a
  header is not. `redactUrl()` masks `token`/`api-key`/`Authorization` wherever a URL _is_ logged —
  it decodes parameter names first, because the server reads `?to%6Ben=` as `token` too. Any new
  logging site that touches `req.url` must go through it.
- Transport: `?transport=webrtc` → upstream `/voice-live/realtime/calls` (WebRTC control channel,
  default api-version `2026-01-01-preview`); default → `/voice-live/realtime` (`2026-07-15`).
  The relay is identical for both — `rtc.call.*` are plain JSON text frames.
- API version precedence: `?apiVersion=` > `API_VERSION` env > built-in default per transport
- Origin is checked in three places, on purpose: `verifyClient` (rejects the _handshake_ with HTTP
  `403`, the only way the browser gets an unambiguous failure), the CORS middleware, and the `/ws`
  handler as defence in depth. With `express-ws` the upgrade completes before middleware runs, so a
  CORS rejection alone reaches the client as a close without a status code
- **Close with a code that says what the client should do**: `1008` only for a request that would
  be rejected identically on retry (the SDK stops reconnecting on it), `1011` for proxy/upstream
  failures, `1013` for capacity. Never close bare — `1005` is indistinguishable from a network drop
- Numeric limits come from `readPositiveInt()`: `parseInt("unlimited")` is `NaN`, and `NaN` removes
  a limit instead of enforcing it (`active >= NaN` is false; `ws` reads `maxPayload: NaN` as
  unlimited). `TRUST_PROXY` is parsed defensively too — Express compiles it eagerly and throws
- The Docker image builds from the **repository root** (it installs with the workspace lockfile):
  `docker build -f packages/proxy-node/Dockerfile .`; `docker-compose.yml` sets that context
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
