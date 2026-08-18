# Unit Tests

Focused unit tests for the Microsoft Foundry Voice Live Proxy. The tests import the real
modules under test (`src/url.ts`, `src/packageInfo.ts`) — no server is started and no
network connections are made.

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm run test:watch

# Run tests with coverage report
pnpm run test:coverage
```

## Test Coverage

`url.test.ts` — upstream URL / auth resolution (`buildAzureUrl` and helpers):

- **Standard mode** — API key in URL (empty headers), browser token moved to the
  `Authorization` header (never in the URL, beats API key), keyless fallback to the injected
  `getEntraToken` (DefaultAzureCredential), default model, URL encoding
- **Foundry Agents** — all agent params (`agent-name`, `agent-project-name`, `conversation-id`,
  `agent-version`, `agent-authentication-identity-client-id`, `foundry-resource-override`),
  token header vs. DefaultAzureCredential, missing `projectName` error, `.env` fallback only when
  the `model` param is absent, URL params overriding `.env` values
- **API version precedence** — `?apiVersion=` > `API_VERSION` > built-in default
- **WebRTC transport** — `transport=webrtc` routes to `/voice-live/realtime/calls` with the
  `2026-01-01-preview` default (explicit/env versions respected), unknown transports rejected
- **`redactUrl`** — masks `token`, `api-key`, `Authorization` values for logging
- **`resolveTransport` / `resolveMode` / `resolveAgent` / `resolveApiVersion`** — helpers in isolation

`packageInfo.test.ts` — `readPackageInfo()` resolves `../package.json` (same path from `src/`
and `dist/`) and falls back to `unknown` instead of throwing.

## Test Framework

- **Vitest** (v2, `environment: node`) — fast, TypeScript-native testing framework
- **Coverage** — V8 coverage provider for accurate reporting

## Writing Tests

- Import the real functions from `../url.js` / `../packageInfo.js` (ESM `.js` suffix)
- Inject I/O via `deps` (e.g. `getEntraToken: vi.fn().mockResolvedValue("token")`)
- Assert on parsed URLs (`new URL(url).searchParams`) rather than string layout
- Keep tests fast: no real WebSocket connections, no environment variables

## CI/CD Integration

Add to your CI pipeline:

```yaml
- run: pnpm test
- run: pnpm run test:coverage
```
