# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0] - 2026-08-18

Targets Voice Live API **`2026-07-15` (GA)**. This release contains breaking changes (see **Removed** / **Changed**).

### `@iloveagents/foundry-voice-live-react` 0.5.0

#### Added
- **WebRTC transport (preview)** — `connection.transport: 'webrtc'`: RTP audio via `RTCPeerConnection`, control channel on `/voice-live/realtime/calls` (`rtc.call.sdp.create` / `rtc.call.sdp.created` / `rtc.call.error`), non-audio events on the `voice-live-events` data channel; `connection.rtcConfiguration` for TURN. Voice-only (avatar unsupported). New utils `buildVoiceLiveUrl`, `validateTransport`, `redactUrl`; constants `DEFAULT_WEBRTC_API_VERSION`, `MIN_WEBRTC_API_VERSION`.
- **Interim responses**: `model` / `maxCompletionTokens` options, `withInterimResponse()`; documented model limitations.
- **Typed protocol events**: `VoiceLiveServerEvent` / `VoiceLiveClientEvent` discriminated unions (`types/events.ts`); `onEvent` and `sendEvent` are typed.
- **Hook API**: `sendText()`, `sendToolResult()`, `cancelResponse()`, `clearInputAudio()`, `commitInputAudio()`, `approveMcpCall()`, `sessionExpiresAt`, `transport`; `toolExecutor` may return a value / Promise which is sent automatically as `function_call_output` + `response.create`; new callbacks `onWarning`, `onMcpApprovalRequest`, `onSessionUpdated`; `logLevel` option.
- **Events handled**: `conversation.item.input_audio_transcription.delta` (user partial transcripts), `response.text.delta/done` (text modality), `conversation.item.truncated`, `warning`, `conversation.item.created` (MCP approval requests); typed `output_audio_buffer.started/stopped` (observed on the WebRTC data channel).
- WebRTC: readiness waits for the data channel, events delivered on both channels are de-duplicated by `event_id`, server-created data channels are accepted, data-channel/RTP diagnostics at `logLevel: 'debug'`.
- `validateConfig` warns when a pre-generated greeting is combined with an OpenAI voice (spoken greetings need an Azure TTS voice).
- **Session config**: `parallelToolCalls`, `reasoningEffort`, `metadata`; MCP tools (`type: 'mcp'`, `withMcpServer()`, `.mcpServer()`), Foundry agent tools (`type: 'foundry_agent'`, `withFoundryAgentTool()`); voices `openai` / `azure-personal` / `azure-realtime-native` (`withPersonalVoice()`, `withAzureRealtimeVoice()`) with `preferLocales`, `locale`, `style`, `pitch`, `volume`, `customLexiconUrl`, `customTextNormalizationUrl`, `endpointId`, `model`; turn detection `azure_semantic_vad_en`, `smart_end_of_turn_detection`, `appendedTextAfterTruncation`; transcription `mai-transcribe`; echo cancellation `referenceSource` / `channels` (types + wire only); model `azure-realtime`.
- **Foundry Agents**: `foundryResourceOverride`, `agentAuthenticationIdentityClientId` connection options; direct connections send the Entra token as the documented `Authorization=Bearer <token>` query parameter (standard mode + agents).
- `withGreeting()`, `withReasoningEffort()`, `withMetadata()`, `withParallelToolCalls()`, `createLogger()`, `buildGreetingEvents()`, `convertToSessionUpdate()`, `DEFAULT_API_VERSION`, `DEFAULT_MODEL` exports.
- **Auto-reconnect** (`reconnect: true | { maxAttempts, initialDelayMs, maxDelayMs, jitter }`, off by default): exponential backoff after unexpected closes (`1006`, service restarts, WebRTC negotiation timeout), `connectionState: 'reconnecting'`, `reconnectAttempt`, `onReconnecting` / `onReconnected`; mic track / capture re-attached, `AudioContext` kept, greeting not re-sent. `connection.getToken` provides a fresh token per attempt.
- **Core layer** (`core/`, exported as advanced building blocks): `WebSocketTransport`, `WebRtcTransport` (one `VoiceLiveTransport` interface: SDP negotiation, timeout, readiness gating, duplicate-event filter), `OutputAudioGraph` + `PcmPlayer`, `AvatarConnection`, `WebRtcMicrophone`, reconnect policy helpers, `parseServerEvent`. No React dependency; the hook is now a binding of React state + protocol semantics over these classes (~950 lines instead of ~1350) with the same public API.
- **Protocol contract test** against Microsoft's official `@azure/ai-voicelive` SDK (dev dependency): wire format and event names are verified on every test run.
- Tests: hook (websocket, webrtc, reconnect), core classes, `useAudioCapture`, `VoiceLiveAvatar` — 240 tests with fake browser APIs.

#### Changed
- Default API version is now **`2026-07-15`** for all direct connections (was `2025-10-01` / `2026-01-01-preview`). Pin via `connection.apiVersion` if needed.
- The hook is **quiet by default** (`logLevel: 'warn'`); set `logLevel: 'debug'` for the previous verbosity.
- `validateConfig()` returns warnings instead of throwing; the hook logs them before connecting.
- Standard mode with a `token` now authenticates with it (previously the token was ignored); connecting without `apiKey`/`token`/`proxyUrl` fails fast with a clear error.
- `createVoiceLiveConfig()` passes all fields through (previously dropped `onTranscript`, `autoStartMic`, `audioSampleRate`, `audioConstraints`).
- `buildAgentSessionConfig()` deep-merges over the shared defaults, forwards `animation`, `outputAudioTimestampTypes` and `metadata` (visemes work in agent mode), strips exactly `AGENT_OWNED_FIELDS` (exported) and no longer sends a default `voice` in agent mode — the agent's portal voice is used unless you set one.
- Proxy URLs: `connection.transport` / `connection.apiVersion` now override `transport=` / `apiVersion=` params already present in `proxyUrl` (previously ignored when present); relative proxy URLs are supported.
- `buildMicConstraints()` (exported) is the single source of microphone constraint defaults for both transports.
- `updateSession()` is agent-mode aware.
- `withHDVoice()` accepts all voice options; `withEchoCancellation()` accepts Live-Reference AEC options; `withTranscription()` / `withEndOfUtterance()` accept the new model names.
- `ConnectionState` gains `'reconnecting'`; an unexpected close without `reconnect` now releases the audio graph (`audioStream`/`audioContext` become null until the next `connect()`).

#### Fixed
- Interim response wire key `latency_threshold_ms` (was `latency_threshold_in_ms`).
- Proactive greeting wire format: `response.pre_generated_assistant_message` with a `text` content part (was `preGeneratedAssistantMessage` / `output_text`).

#### Removed (breaking)
- **Agent Service v1 (classic)**: `agentId`, `agentAccessToken`, `agent-id` / `agent-access-token` URLs.
- Legacy types `VoiceLiveSession`, `VoiceLiveConfig`, `VoiceLiveReturn`, `IceServerConfig`, `ModalController`, `LoggerConfig`, `VoiceLiveEventHandler` and the legacy `AvatarConfig` shape (the full `AvatarConfig` is now exported).
- Unused `AudioPlayer` / `createAudioPlayer` utilities.

### `@iloveagents/foundry-voice-live-proxy-node` 0.5.0

#### Added
- `transport=webrtc` query parameter → relays the control channel to `/voice-live/realtime/calls` (default api-version `2026-01-01-preview` for WebRTC).
- Browser messages received before the upstream socket is open are queued and flushed (the WebRTC client sends `rtc.call.sdp.create` immediately on open — previously such early messages were dropped).
- Client disconnects during the upstream connect are handled (upstream socket closed, connection counter released); relay logging no longer `JSON.parse`s every frame.
- Foundry Agents passthrough for `agentAuthenticationIdentityClientId` and `foundryResourceOverride`.
- Keyless standard mode: falls back to `DefaultAzureCredential` when neither `token` nor `FOUNDRY_API_KEY` is configured.
- Pure `src/url.ts` module with real unit tests.

#### Changed
- Default `API_VERSION` is `2026-07-15` (was `2025-10-01`); no `API_VERSION` override needed for Foundry agents anymore.
- `GET /` reports the real package version.
- `docker-compose.yml` uses `FOUNDRY_AGENT_NAME` / `FOUNDRY_PROJECT_NAME` and no longer pins `API_VERSION` by default (so `transport=webrtc` gets its preview default).

#### Removed (breaking)
- Agent Service v1 (classic) mode (`agentId`).

### Examples
- New pages: Voice over WebRTC, Interim Responses, MCP Server Tools, Azure Realtime Voices.
- Function Calling uses the auto-sent `toolExecutor` result; Voice Proxy demonstrates `reconnect: true` (restart the proxy and watch it recover).
- Shared `useTranscripts()` / `TranscriptPanel` / `TextInput` / `proxyWsUrl()` helpers; Foundry agent pages use `azure-speech` transcription.
- Removed Agent Service v1 pages; `VITE_BACKEND_PROXY_URL` documented in `.env.example`.

## [0.4.0] - 2026-01

- AudioWorklet playback, session state, mute, transcripts, proactive greeting (see git history).
