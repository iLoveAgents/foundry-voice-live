# Examples

Interactive examples demonstrating Voice Live API features.

## Commands

```bash
just dev-examples       # Start dev server (port 3001)
pnpm --filter examples run typecheck
pnpm --filter examples run lint
```

## Structure

```text
src/
  pages/            # Example implementations (one page per feature)
  components/       # Shared UI: SampleLayout, StatusBadge, Section, ControlGroup, ErrorPanel, AlertBox,
                    # ConfigPanel, TextInput ("type instead of talk"), TranscriptPanel
  lib/              # connection.ts (directOrProxyConnection, proxyWsUrl, isProxyMode),
                    # useTranscripts.ts (transcript accumulation), sessionState.ts (state labels)
  App.tsx           # Router
```

`vite.config.ts` aliases `@iloveagents/foundry-voice-live-react` to `packages/react` **source** (set `VITE_MODE=dist` to test the built package).

## Adding Examples

1. Create component in `src/pages/`
2. Add route in `App.tsx`
3. Add navigation card in `HomePage.tsx`

## Conventions

- Use `SampleLayout` + `StatusBadge` + `ControlGroup` + `ErrorPanel`; put caveats in an `AlertBox`.
- Read credentials from `import.meta.env` (declared in `src/vite-env.d.ts`, documented in `.env.example`). Every non-proxy page uses `directOrProxyConnection()` from `src/lib/connection.ts` (direct with `VITE_FOUNDRY_API_KEY`, otherwise the proxy) and proxy pages use `proxyWsUrl()` (honours `VITE_BACKEND_PROXY_URL`, default `ws://localhost:8080`) — never build connection configs or URLs by hand, so all pages work keyless.
- Use `useTranscripts()` + `<TranscriptPanel>` for transcripts and `sessionStateLabel()` for the session state; add `<TextInput onSend={sendText} />` so pages work without a microphone.
- Foundry agent pages use `.transcription({ model: 'azure-speech' })`.
- Pass `logLevel: 'debug'` to `useVoiceLive` so the dev console stays informative.
- Bind `audioStream` to a hidden `<audio ref autoPlay hidden>` element (also for the WebRTC transport, where it is the remote RTP track).
- Prefer the `sessionConfig()` builder; return the result from `toolExecutor` instead of sending `function_call_output` manually.
- Do not hardcode `apiVersion` - the SDK default is the GA version (WebRTC has its own preview default).
