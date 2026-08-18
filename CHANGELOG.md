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
- **`connectTimeoutMs`** (default 15 s) and exported close codes (`RTC_SDP_ANSWER_FAILED_CLOSE_CODE`, `RTC_CALL_ERROR_CLOSE_CODE`, `RTC_MEDIA_FAILED_CLOSE_CODE`) so callers can tell why a session ended.
- **Hook API**: `sendText()`, `sendToolResult()`, `cancelResponse()`, `clearInputAudio()`, `commitInputAudio()`, `approveMcpCall()`, `sessionExpiresAt`, `transport`; `toolExecutor` may return a value / Promise which is sent automatically as `function_call_output` + `response.create`; new callbacks `onWarning`, `onMcpApprovalRequest`, `onSessionUpdated`; `logLevel` option.
- **Events handled**: `conversation.item.input_audio_transcription.delta` (user partial transcripts), `response.text.delta/done` (text modality), `conversation.item.truncated`, `warning`, `conversation.item.created` (MCP approval requests); typed `output_audio_buffer.started/stopped` (observed on the WebRTC data channel).
- WebRTC: readiness waits for the data channel, events delivered on both channels are de-duplicated by `event_id`, server-created data channels are accepted, data-channel/RTP diagnostics at `logLevel: 'debug'`.
- `validateConfig` warns when a pre-generated greeting is combined with an OpenAI voice (spoken greetings need an Azure TTS voice).
- **Session config**: `parallelToolCalls`, `reasoningEffort`, `metadata`; MCP tools (`type: 'mcp'`, `withMcpServer()`, `.mcpServer()`), Foundry agent tools (`type: 'foundry_agent'`, `withFoundryAgentTool()`); voices `openai` / `azure-personal` / `azure-realtime-native` (`withPersonalVoice()`, `withAzureRealtimeVoice()`) with `preferLocales`, `locale`, `style`, `pitch`, `volume`, `customLexiconUrl`, `customTextNormalizationUrl`, `endpointId`, `model`; turn detection `azure_semantic_vad_en`, `smart_end_of_turn_detection`, `appendedTextAfterTruncation`; transcription `mai-transcribe`; echo cancellation `referenceSource` / `channels` (types + wire only); model `azure-realtime`.
- **Foundry Agents**: `foundryResourceOverride`, `agentAuthenticationIdentityClientId` connection options; direct connections send the Entra token as the documented `Authorization=Bearer <token>` query parameter (standard mode + agents).
- `withGreeting()`, `withReasoningEffort()`, `withMetadata()`, `withParallelToolCalls()`, `createLogger()`, `buildGreetingEvents()`, `convertToSessionUpdate()`, `DEFAULT_API_VERSION`, `DEFAULT_MODEL` exports.
- **Auto-reconnect** (`reconnect: true | { maxAttempts, initialDelayMs, maxDelayMs, jitter }`, off by default): exponential backoff after unexpected closes (`1006`, service restarts, WebRTC negotiation timeout), `connectionState: 'reconnecting'`, `reconnectAttempt`, `onReconnecting` / `onReconnected`; mic track / capture re-attached, `AudioContext` kept, greeting not re-sent. `connection.getToken` provides a fresh token per attempt.
- **`Scope` (`core/lifecycle.ts`)** — the single primitive for "does this async work still belong to a live session?". Two lifetimes: the *connection* (`connect()` → `disconnect()`, survives reconnects — microphone, audio graph) and the *session* (one control channel / one server-side conversation, replaced per attempt — response and tool-call ids, readiness). Child scopes end with their parent, and `onAbort()` carries cleanup. This replaced five ad-hoc staleness mechanisms (two generation counters, two boolean flags and a React-state mirror) across 44 call sites, which is what let the same class of stale-continuation bug reappear in different places.
- **`ResponseGate` (`core/responseGate.ts`)** — an explicit `idle → requested → active` state machine for `response.create`, replacing three cooperating booleans. The service rejects overlapping responses and `response.created` alone cannot tell you a request is already in flight.
- **Core layer** (`core/`, exported as advanced building blocks): `WebSocketTransport`, `WebRtcTransport` (one `VoiceLiveTransport` interface: SDP negotiation, timeout, readiness gating, duplicate-event filter), `OutputAudioGraph` + `PcmPlayer`, `AvatarConnection`, `WebRtcMicrophone`, reconnect policy helpers, `parseServerEvent`. No React dependency; the hook is now a binding of React state + protocol semantics over these classes (~950 lines instead of ~1350) with the same public API.
- **Protocol contract test** against Microsoft's official `@azure/ai-voicelive` SDK (dev dependency): wire format and event names are verified on every test run.
- Tests: hook (websocket, webrtc, reconnect), core classes, `useAudioCapture`, `VoiceLiveAvatar` — 354 tests with fake browser APIs, plus a model-based fuzz test for the response gate.

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
- Errors are correlated using `error.event_id` (the offending *client* event) rather than the top-level `event_id` (the server's own error event) — the earlier correlation could have left the gate waiting for a `response.done` that never comes.
- The speculative VAD reservation follows the **effective** session as reported by the service, so `updateSession({ turnDetection: { createResponse: false } })` takes effect instead of the hook trusting stale local config.
- **WebRTC event ordering**: lifecycle events (data channel) and function-call events (control channel) are independent, so `response.done` can arrive *before* a tool call of that response. Completed response ids are remembered, so a batch created afterwards knows it is already complete instead of waiting forever — previously that stalled the conversation and the assistant never spoke the tool result.
- A user turn is held whenever **any** tool batch of the session still owes outputs — the response gate being idle is not sufficient, because over WebRTC the response can finish before its tool calls arrive — and is **handed over to that batch**: sending it earlier made the model reply to a conversation whose `function_call_output` did not exist yet. One follow-up covers the tool result and that turn together, and still happens when every executor returns void. `response.done` also reserves a batch for the calls it declares, so a turn submitted in that window (including from a `response.done` callback) is held as well; a declared call that never arrives is abandoned after 5 s rather than holding every later turn forever, and once a response has been answered, a call arriving afterwards cannot resurrect a batch waiting for work already accounted for. The reservation exists only when the hook executes tools itself — consumers handling function calls manually (`onEvent` + `sendToolResult()`) are never held behind it.
- A WebRTC offer that rejects *after* the control channel already closed is silent, instead of reporting a second, spurious failure for a session that was already torn down.
- A blocked or unavailable `AudioContext` no longer aborts a WebRTC connection (playback there is the remote RTP track; the graph is only used for visualization), and a throwing consumer `onOpen` can no longer break a transport's own negotiation.
- A `sendToolResult()` you call yourself counts towards the response's tool batch, so it shares the single follow-up instead of racing a second one; the `toolExecutor` contract (returning `undefined` means no automatic output for that call) is now spelled out in the README.
- A microphone attachment requested before the WebRTC transceiver exists no longer resolves optimistically: the promise settles with the real outcome, so `isMicActive` cannot claim a live microphone that never attached.
- A microphone attachment still waiting for the transceiver is now also settled when the control channel closes remotely or the offer fails, not only on an explicit `close()` — `startMic()` used to hang forever if the session died during negotiation.
- `setMicrophoneTrack()` on a closed transport rejects instead of returning a promise nothing can ever settle.
- A speculative response reservation survives errors caused by *other* client events: they arrive without an `event_id` and used to release the reservation that exists to keep the next turn from overlapping the service's own response. An automatic response announced *during* another one is now remembered and reserved when that one finishes, instead of being forgotten (a queued turn could be sent straight into the window the service was about to use).
- A tool call arriving after its response was already answered (late control-channel delivery) sends its output but no longer triggers a **second** `response.create` for the same turn — the assistant used to answer twice.
- A tool batch created before `response.done` now has a watchdog too: if that `response.done` never arrives, the batch completes instead of silently swallowing the user turn handed to it.
- `useAudioCapture` coalesces concurrent `startCapture()` calls. `isCapturing` only flips after `getUserMedia` and the worklet load, so two calls in that window each acquired a stream and the second overwrote the first's refs — leaving a microphone recording that `stopCapture()` could not release.
- Reconnect no longer retries closes that reject the request itself (`1003`, `1008`, `1010`) — the same URL and credentials would be rejected identically.
- A protocol-relative `proxyUrl` (`//proxy.example/ws`) keeps its host when parameters are added; it used to collapse to a path, pointing the session (with the user's token) at the page's own origin.
- `redactUrl()` decodes and lower-cases parameter names before matching, so `?to%6Ben=` / `?API-KEY=` are redacted like their plain spellings.
- A consumer that ends the transport from its own `onError` no longer gets an `onClose` afterwards (and, on a reused instance, no longer has its replacement connection torn down): every terminal failure goes through one `failTerminally()` path that re-checks the generation after the callback.
- `validateConfig()` warnings reach `onWarning` (`code: CLIENT_CONFIG_WARNING_CODE`), as the README always promised — they were console-only.
- An automatic response announced while our own `response.create` was still unacknowledged is now held on **every** path that frees the gate (rejection, transport not open), not only on `response.done` — a queued turn used to be sent straight into the window the service was about to use. Found by a new model-based fuzz test (`core/responseGate.fuzz.test.ts`) that drives random legal event sequences and asserts the gate never sends into a running or announced response and never gets stuck busy.
- A tool call that arrives after its batch was abandoned (watchdog) is answered when that batch never asked for a response itself — previously its output went out and the assistant stayed silent for the rest of the turn.
- A second turn announced while a speculative reservation was held is no longer dropped by the watchdog, which used to leave a phantom reservation that delayed the next turn by the full 5 s.
- Several turns committed during one response are all remembered (up to a bounded burst) instead of collapsing into a single reservation, so a queued turn cannot be sent into the window of the second announced response.
- `useAudioCapture` releases the microphone when a start fails *after* `getUserMedia` resolved (a blocked worklet module, an unsupported sample rate); the half-open capture used to make every later `startCapture()` return early as "already capturing".
- A consumer that calls `disconnect()` from `onWarning` no longer leaves an orphaned socket: the connection scope is re-checked before the transport is created.
- The microphone controls (`startMic` / `stopMic` / `toggleMute` / `isMicActive` / `isMuted`) act on the transport of the **live** session rather than the current `connection.transport` prop: changing the prop mid-session only takes effect on the next connect, and until then the controls kept operating on the wrong capture path.
- Foundry agent sessions reserve the response slot on `speech_stopped` like every other session — they use server VAD too, so a turn submitted before `response.created` could overlap the response the agent was already starting.
- Avatar tracks delivered without an associated stream (some browsers) are wrapped instead of dropped, which used to leave a blank avatar and no audio on a session that reported itself ready.
- Agent mode is detected from a **non-empty `agentName`**, matching the proxy: a URL carrying only `projectName` (or an empty `agentName`) made the hook build an agent-mode session and silently strip instructions, tools, temperature and the voice from a standard one.
- `WebRtcTransport` queues events sent between `onOpen` and `rtc.call.sdp.create` (the call does not exist until the offer is negotiated, so they would have been rejected), and a consumer that closes or replaces the transport from `onEvent` stops the rest of that event's handling — `close()` promises no further callbacks.
- The audio graph is built transactionally: a browser where one node constructor throws used to leave a half-built graph that satisfied the "already created" guard forever, so playback connected to a gain node with no destination and the session was silent for its whole lifetime.
- Any `transport` value already present in a reused `proxyUrl` is replaced rather than compared (the proxy normalizes case, so `?transport=WebRTC` slipped through an exact match and routed a WebSocket session to the WebRTC control endpoint).
- Every transport callback goes through a defensive notifier, so a throwing consumer handler can no longer prevent terminal cleanup (a throwing `onError` used to leave the socket open and the transport stuck `open`, with no `onClose` for reconnect or teardown to act on).
- `AvatarConnection` closes its peer connection when *any* setup step fails, including `addTransceiver()` in browsers/WebViews that reject receive-only transceivers — not only when the offer fails.
- WebRTC readiness is not announced off a media path that dropped before the session started (a transient `disconnected` used to leave the flag set, so the data-channel fallback could report ready while RTP was down), and a throwing consumer `onEvent` can no longer strand the SDP negotiation that follows it.
- Avatar audio is fed into the shared analyser, so `audioAnalyser` works for avatar sessions instead of reading silence — those sessions deliberately skip the MediaStreamDestination, and nothing else attached the stream.
- WebRTC seeds the effective `turnDetection.createResponse` from the session it opens with (that transport is ready before any `session.updated` echo), so a manual `createResponse()` is not held for the speculative timeout when automatic responses are disabled.
- **Per-user auth through a proxy works with `getToken`**: the refreshed token is now written onto the proxy URL (`?token=`), replacing any stale one. Previously it was silently dropped, so a proxy configured for per-user auth fell back to the server identity — the exact combination the README documents.
- A custom `response.create` waits behind pending tool outputs like every other turn (keeping its payload); it used to bypass that check deliberately and could answer before the `function_call_output` existed.
- `rtc.call.error` reaches `onEvent` before the teardown it triggers, so consumers can inspect its `operation` and error details — `onEvent` promises every event.
- `AvatarConnection.createOffer()` closes its peer connection when setup fails; the caller never receives a handle for a failed offer and could not clean it up.
- The public `sendEvent()` routes a raw `response.create` through the response gate as well (keeping the consumer's payload, even when the request must be deferred), so the documented raw-event API cannot overlap a running response.
- Both transports report terminally when the control socket cannot even be constructed (a malformed URL, or a throwing `createWebSocket` factory) instead of returning silently — which left the WebRTC offer's peer connection alive and no callback to act on.
- All `response.create` sends funnel through one internal helper, so the gate cannot be bypassed and queued flushes carry a correlation id too. The transport interface now states that `onError` is advisory and a transport that cannot continue must also `onClose` — reconnect and teardown key off the close.
- The proactive greeting goes through the response gate as well, carrying its own payload, and is **dropped** rather than queued when a turn is already running (a greeting after the user has spoken is not a greeting).
- Errors are correlated with the request they belong to via `event_id`: an unrelated failure (say an invalid `session.update`) no longer releases the gate while our `response.create` may still be accepted. Errors without an `event_id` stay ambiguous and release it, because a stuck gate would block every later turn.
- Server VAD starting a response is reserved in the gate, so a turn submitted between `speech_stopped` and `response.created` is queued instead of overlapping it. The reservation is speculative and self-heals after 5 s if the service does not answer.
- A failed *initial* connect (rejected `getToken()`, invalid WebRTC configuration, setup throw) ends the connection like any other terminal failure, releasing a microphone armed by the documented pre-connect `startMic()` pattern.
- Consumer callbacks that end or replace the session (`onEvent`, `onSessionUpdated`) stop the rest of that event's handling — `safeCall` now reports whether the session survived, so an avatar peer connection is no longer created for a session the consumer just disconnected.
- **`createResponse()`** (new hook API): asks the model to respond now — for manual turn control or after a server-side tool — through the same serialization as every other turn. Previously the only way was sending a raw `response.create`, which bypassed the gate and could overlap a user turn (the MCP example did exactly that).
- A terminal close (reconnect disabled, or attempts exhausted) now ends the whole connection, **including the microphone**. It is deliberately kept across reconnect *attempts*, but leaving it live after the session ended kept the browser's recording indicator on. The user's mute preference survives.
- `createWebRtcOffer()` closes the peer connection and data channel when offer creation fails — the caller never receives a handle for a failed offer, so each failed attempt leaked one of each.
- A control-channel close during ICE gathering invalidates the pending negotiation, instead of letting the resolved offer send SDP on a dead socket and arm a 30 s timer that fired a spurious error afterwards.
- The response gate only advances when a request actually reached the service: `sendText()` during a reconnect (or while disconnected) no longer leaves it busy, which would have queued every later turn behind a response that never starts. A rejected request also releases the turn queued behind it instead of dropping it and emitting a phantom `response.create` later.
- `startMic()` before `connect()` keeps its track again (the connection-scope refactor briefly released it), so the documented "pre-arm the microphone from a user gesture" pattern works.
- A tool batch from a superseded session can no longer delete the live session's batch stored under the same (per-session) response id, which would have left the new tool outputs without their follow-up response.
- `response.create` is serialized against the *service*: a request stays outstanding until `response.done`, so two `sendText()` calls before the first `response.created` no longer send two overlapping requests (the service rejects the second, losing that turn). An API error clears the flag so later turns still work.
- Microphone audio is only streamed once the session is configured: during a reconnect and between socket-open and `session.updated` chunks are dropped instead of being warned about ten times a second or processed by a session that has not received `session.update` yet.
- `1001 Going Away` now triggers reconnect. It reaches the client only when the *service* restarts — the client's own 1001 (navigation/unmount) is never observed because `disconnect()` detaches the transport callbacks first.
- `WebRtcMicrophone.start()` coalesces concurrent calls: two `startMic()` calls during one permission prompt used to acquire two streams, the second overwriting the first and leaving a live microphone track `stop()` could not reach.
- A consumer that calls `disconnect()` from `onEvent` stops the rest of that event's handling (it could previously resurrect `isReady` and restart the microphone for the session it had just ended), and an avatar offer that rejects after teardown no longer writes an error into the next session.
- Parallel tool calls: every `function_call_output` of a response is sent before a **single** `response.create`, which now waits for `response.done` (only then is it certain no further tool call belongs to the response) and shares one gate with `sendText()`, so a user turn and a completing tool batch can no longer emit two overlapping `response.create`s.
- Tool results whose executor settles after the session ended or reconnected are discarded instead of being injected into the new conversation; a **rejected** executor now sends `{ error }` as its `function_call_output` so the conversation cannot stall waiting for a result that will never come.
- Terminal WebRTC failures all close the transport now (SDP answer not applicable `4009`, `rtc.call.error` `4010`, peer connection `failed` — e.g. a mid-call network change — `4011`), so auto-reconnect runs and `connect()` is accepted again. Previously the control channel stayed `open` and the session was unrecoverable.
- A control channel that never opens (and never errors) fails after `connectTimeoutMs` instead of leaving the hook in `'connecting'` forever.
- WebRTC: a `rtc.call.sdp.created` answer that cannot be applied now closes the transport (previously it stayed `open`, blocking both `connect()` and auto-reconnect).
- A microphone permission prompt that resolves after `disconnect()` **or `stopMic()`** releases its track instead of leaving the microphone hot and reporting `isMicActive` (fixed in `WebRtcMicrophone` itself, so the exported class is safe standalone). The same race in `useAudioCapture` (`stopCapture()`/unmount during `getUserMedia` or worklet loading) no longer leaves `isCapturing: true` with no stream, which used to silently disable the auto-start retry.
- Audio chunks still being decoded when playback is flushed (barge-in, reconnect) are dropped instead of being queued into the next turn.
- A throwing consumer callback (`onEvent`, `onTranscript`, `onReconnecting`, …) can no longer abort event handling or strand the reconnect state machine.
- Avatar ICE gathering is bounded by a timeout, so `close()` during negotiation cannot leave `createOffer()` pending forever.
- `sessionExpiresAt` is cleared when a session ends (a stale expiry used to survive into a reconnect).
- An avatar SDP answer applied after teardown no longer marks a disconnected (or replacement) session ready.
- Reconnect: a transient `getToken()`/setup failure consumes an attempt and continues the backoff policy instead of ending in `'error'` with no transport and no timer.
- Proxy URLs: an explicit `websocket` transport now overrides a stale `transport=webrtc` parameter in a reused `proxyUrl` (which would have routed the socket to the WebRTC control endpoint).
- Interim response wire key `latency_threshold_ms` (was `latency_threshold_in_ms`).
- Proactive greeting wire format: `response.pre_generated_assistant_message` with a `text` content part (was `preGeneratedAssistantMessage` / `output_text`).

#### Removed (breaking)
- **Agent Service v1 (classic)**: `agentId`, `agentAccessToken`, `agent-id` / `agent-access-token` URLs.
- Legacy types `VoiceLiveSession`, `VoiceLiveConfig`, `VoiceLiveReturn`, `IceServerConfig`, `ModalController`, `LoggerConfig`, `VoiceLiveEventHandler` and the legacy `AvatarConfig` shape (the full `AvatarConfig` is now exported).
- Unused `AudioPlayer` / `createAudioPlayer` utilities.

#### Packaging
- **`LICENSE` is now shipped** with both packages (they declare MIT but no license file existed anywhere in the repo — the proxy's `files` list even referenced one).
- `exports` map declares types per condition (`import` → `index.d.mts`, `require` → `index.d.ts`), which is what `moduleResolution: node16`/`bundler` expects.
- Every type reachable from the public API is exported (previously `VoiceOptions`, `AvatarConnectionOptions`, `WebRtcMicrophoneOptions`, the event base interfaces and ~20 typed event members were declared but unreachable for consumers).

### `@iloveagents/foundry-voice-live-proxy-node` 0.5.0

#### Added
- Pre-connect message queue is bounded by bytes as well as frame count (`PendingMessageQueue`, 1 MiB budget): an unauthenticated client can no longer make the proxy retain large payloads while the upstream connection is pending. Offenders are closed with `1009`.
- **Security**: origin matching is exact (a prefix check accepted `http://localhost:3001.attacker.com` against a `http://localhost:3001` allow-list) and is now enforced on the WebSocket upgrade too — with `express-ws` the upgrade completes before CORS middleware can reject it. Errors returned to the browser are limited to problems with its own request; token/DNS/handshake detail stays server-side.
- The connection slot is held until the client is gone **and** the upstream attempt has settled, and an attempt the client abandoned is terminated instead of completed. Releasing on the client close alone let repeated connect-and-abort cycles start unlimited concurrent token acquisitions and handshakes outside `MAX_CONNECTIONS`.
- Upstream close codes are forwarded to the browser (`src/closeFrame.ts`): closing without one produced `1005 "no status"`, so SDK clients with `reconnect` retried even after Azure closed the session *normally*. Codes that may not appear in a close frame (`1005`/`1006`/`1015`, out-of-range) map to `1011`, and reasons are truncated to the 123-byte limit without splitting a UTF-8 sequence.
- Client frames are capped at 1 MiB (`MAX_FRAME_BYTES`) on the WebSocket server, so a hostile client cannot make the proxy buffer `ws`'s 100 MB default per frame before the pre-connect byte budget applies (offenders get `1009`).
- Upstream connections use a 15 s handshake timeout, and an upstream error closes the browser socket explicitly (`1011`) instead of relying on a paired `close` event — a hanging Azure handshake used to leave the client reporting `connected` while never becoming ready.
- `transport=webrtc` query parameter → relays the control channel to `/voice-live/realtime/calls` (default api-version `2026-01-01-preview` for WebRTC).
- Browser messages received before the upstream socket is open are queued and flushed (the WebRTC client sends `rtc.call.sdp.create` immediately on open — previously such early messages were dropped).
- Client disconnects during the upstream connect are handled (upstream socket closed, connection counter released); relay logging no longer `JSON.parse`s every frame.
- Foundry Agents passthrough for `agentAuthenticationIdentityClientId` and `foundryResourceOverride`.
- Keyless standard mode: falls back to `DefaultAzureCredential` when neither `token` nor `FOUNDRY_API_KEY` is configured.
- Pure `src/url.ts` module with real unit tests.
- Log/telemetry redaction decodes parameter names before matching, so a percent-encoded secret parameter (`?to%6Ben=…`, which the server still accepts) is redacted instead of printed verbatim.
- **The shared API key is sent as an `api-key` header instead of a query parameter.** The upstream handshake is an ordinary HTTPS request, so Application Insights dependency collection exported the full URL — key included — to telemetry. Microsoft documents the header for non-browser clients.
- A disallowed origin is rejected during the WebSocket handshake (HTTP `403`). The CORS middleware runs *after* `express-ws` has completed the upgrade, so its rejection reached the browser as a close without a status code (`1005`), indistinguishable from a network drop.
- A connection that fails before the relay starts closes with an explicit code — `1008` for invalid connection parameters, `1011` for a proxy/upstream failure — instead of `1005`, so a reconnecting client can tell "your request is wrong" from "try again".
- Invalid `MAX_CONNECTIONS` / `MAX_FRAME_BYTES` / `RATE_LIMIT_*` / `PORT` values fall back to the default with a warning. `parseInt("unlimited")` is `NaN`, and `NaN` *removed* the limit: `active >= NaN` is always false and `ws` reads `maxPayload: NaN` as unlimited.
- New `TRUST_PROXY` setting: behind an ingress every request carries the balancer's IP, collapsing the per-IP rate limit into one global bucket that a single client can exhaust for everyone. Booleans and IP lists are accepted as well as hop counts — Express compiles the setting immediately and would otherwise abort the process on `TRUST_PROXY=true`.
- "Server at capacity" closes with `1013 Try Again Later` instead of `1008`: capacity frees up, and an SDK client treats `1008` as a rejection it must not retry.
- The blocked-origin log redacts the upgrade URL — it carries `?token=` / `?api-key=`, and log properties are exported to Application Insights.

#### Changed
- Default `API_VERSION` is `2026-07-15` (was `2025-10-01`); no `API_VERSION` override needed for Foundry agents anymore.
- `engines.node` is `>=20.0.0` (was `>=18.0.0`, which no install could satisfy — `@azure/identity` requires Node 20+); the Docker image is built on `node:22-alpine`, and the published tarball no longer contains the compiled tests (`tsconfig.build.json`).
- The Docker image builds from the **repository root** so it can install with the workspace lockfile (`docker build -f packages/proxy-node/Dockerfile .`); `docker-compose.yml` sets that context itself. The previous image built with `corepack prepare pnpm@latest`, which now installs pnpm 10 and fails the install outright.
- `GET /` reports the real package version.
- `docker-compose.yml` uses `FOUNDRY_AGENT_NAME` / `FOUNDRY_PROJECT_NAME` and no longer pins `API_VERSION` by default (so `transport=webrtc` gets its preview default).

#### Removed (breaking)
- Agent Service v1 (classic) mode (`agentId`).

### Examples
- `VITE_BACKEND_PROXY_URL` accepts a trailing slash: `ws://proxy.example/` used to produce `//ws`, which the proxy does not serve, so every proxy-backed example failed to connect.
- New pages: Voice over WebRTC, Interim Responses, MCP Server Tools, Azure Realtime Voices.
- Function Calling uses the auto-sent `toolExecutor` result; Voice Proxy demonstrates `reconnect: true` (restart the proxy and watch it recover).
- Shared `useTranscripts()` / `TranscriptPanel` / `TextInput` / `proxyWsUrl()` helpers; Foundry agent pages use `azure-speech` transcription.
- Removed Agent Service v1 pages; `VITE_BACKEND_PROXY_URL` documented in `.env.example`.

## [0.4.0] - 2026-01

- AudioWorklet playback, session state, mute, transcripts, proactive greeting (see git history).
