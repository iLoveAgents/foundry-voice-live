/**
 * useVoiceLive Hook - Comprehensive Implementation
 *
 * React hook for Microsoft Foundry Voice Live API with full parameter support.
 * Supports all Voice Live features with sensible defaults, two transports
 * (WebSocket audio or WebRTC audio + control channel) and Foundry agents.
 *
 * @example
 * ```tsx
 * // Simple usage with defaults
 * const { connectionState, audioStream, connect } = useVoiceLive({
 *   connection: {
 *     resourceName: 'my-resource',
 *     apiKey: 'xxx',
 *   },
 * });
 *
 * // Advanced usage with full config
 * const api = useVoiceLive({
 *   connection: {
 *     resourceName: 'my-resource',
 *     token: entraAccessToken,
 *     model: 'gpt-4.1',
 *     transport: 'webrtc', // preview, voice-only
 *   },
 *   session: {
 *     instructions: 'You are helpful',
 *     voice: {
 *       name: 'en-US-Ava:DragonHDLatestNeural',
 *       type: 'azure-standard',
 *       temperature: 0.9,
 *       rate: '1.2',
 *     },
 *     turnDetection: {
 *       type: 'azure_semantic_vad',
 *       removeFillerWords: true,
 *       endOfUtteranceDetection: {
 *         model: 'semantic_detection_v1',
 *       },
 *     },
 *     interimResponse: { type: 'llm_interim_response', triggers: ['tool', 'latency'] },
 *   },
 *   toolExecutor: async (name, args) => ({ ok: true }), // returned value is sent automatically
 * });
 * ```
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type {
  UseVoiceLiveConfig,
  UseVoiceLiveReturn,
  VoiceLiveEvent,
  VoiceLiveSessionConfig,
  SessionState,
  ConnectionState,
  ToolResult,
} from '../types/voiceLive';
import type { VoiceLiveServerEvent, VoiceLiveClientEvent } from '../types/events';
import { buildSessionConfig, buildAgentSessionConfig, validateConfig } from '../utils/sessionBuilder';
import { buildGreetingEvents } from '../utils/greeting';
import { buildVoiceLiveUrl, validateTransport, redactUrl } from '../utils/connectionUrl';
import { DEFAULT_CONNECT_TIMEOUT_MS } from '../utils/constants';
import { createLogger } from '../utils/logger';
import { arrayBufferToBase64 } from '../utils/audioHelpers';
import { WebSocketTransport } from '../core/transports/websocketTransport';
import { WebRtcTransport } from '../core/transports/webrtcTransport';
import type {
  TransportCallbacks,
  TransportCloseInfo,
  TransportKind,
  VoiceLiveTransport,
} from '../core/transports/types';
import { OutputAudioGraph, PcmPlayer } from '../core/audioOutput';
import { AvatarConnection } from '../core/avatarConnection';
import { WebRtcMicrophone } from '../core/microphone';
import { resolveReconnectOptions, computeBackoffDelay, isReconnectableClose } from '../core/reconnect';
import { BoundedMap } from '../core/boundedMap';
import { Scope } from '../core/lifecycle';
import { ResponseGate } from '../core/responseGate';
import { useAudioCapture } from './useAudioCapture';

/** High-frequency events that are not logged even at debug level */
const VERBOSE_SERVER_EVENTS = new Set<string>([
  'response.audio.delta',
  'response.audio_transcript.delta',
  'response.text.delta',
  'conversation.item.input_audio_transcription.delta',
  'response.function_call_arguments.delta',
  'response.mcp_call_arguments.delta',
  'response.foundry_agent_call_arguments.delta',
  'response.animation_viseme.delta',
  'response.animation_blendshapes.delta',
  'response.audio_timestamp.delta',
]);

const VERBOSE_CLIENT_EVENTS = new Set<string>(['input_audio_buffer.append']);

/**
 * The transport and derived state of one service session. Held in a ref so async continuations can
 * compare identity (`sessionRef.current === session`) and readiness without depending on a render.
 */
interface LiveSession {
  scope: Scope;
  transport: VoiceLiveTransport;
  /** True once `session.updated` (or avatar/WebRTC readiness) configured this session */
  ready: boolean;
}

/** Synthetic close code used when a reconnect attempt fails before the transport exists */
const RECONNECT_SETUP_FAILED_CLOSE_CODE = 4001;

/** Synthetic close code used when the control channel never opened in time */
const CONNECT_TIMEOUT_CLOSE_CODE = 4002;

/**
 * How long to wait for a tool call that `response.done` declared but whose event has not arrived
 * (WebRTC delivers them on a separate channel), before answering with what did arrive.
 */
const LATE_TOOL_CALL_TIMEOUT_MS = 5000;

/**
 * How long a speculative response reservation (server VAD is about to create a response) may wait
 * for `response.created` before it is released, so a service that decides not to answer cannot
 * block later turns.
 */
const SPECULATIVE_RESPONSE_TIMEOUT_MS = 5000;

/**
 * `code` on warnings the SDK raises itself (session options the chosen mode/model ignores), so a
 * consumer can tell them apart from the service's `warning` events.
 */
export const CLIENT_CONFIG_WARNING_CODE = 'client_config';

/**
 * Whether a batch still owes `function_call_output`s: executors are running, or the response
 * declared calls that have not arrived yet. A turn must not be answered while this is true.
 */
function batchOwesOutputs(batch: ToolBatch): boolean {
  return batch.pending > 0 || batch.seenCalls < batch.expectedCalls;
}

/**
 * What is known about a finished response, kept for a while after it ended.
 *
 * Over WebRTC a response's tool calls can arrive *after* its `response.done` (independent
 * channels), so a batch created later needs both facts: how many calls that response declared,
 * and whether it has already been answered — a call arriving after the answer still needs its
 * `function_call_output`, but must not trigger a second answer for the same turn.
 */
interface ResponseCompletion {
  /** Tool calls the response declared that a later batch still has to wait for */
  outstandingToolCalls: number;
  /** A follow-up `response.create` was already sent for this response */
  answered: boolean;
}

/**
 * Automatic tool executors of one response. The follow-up `response.create` may only be sent
 * once the response has emitted **all** its tool calls (`response.done`) *and* every executor
 * has settled — otherwise a fast first result would answer without the pending ones.
 */
interface ToolBatch {
  /** Executors still running */
  pending: number;
  /** At least one `function_call_output` was sent, so a follow-up response is warranted */
  sentOutput: boolean;
  /** `response.done` was observed, i.e. no further tool calls can arrive for this response */
  responseDone: boolean;
  /**
   * A user turn was queued while this batch was running and handed over to it: the follow-up must
   * happen even if every executor returned void, otherwise that turn would never be answered.
   */
  followUpOwed: boolean;
  /** Tool calls seen for this response so far */
  seenCalls: number;
  /**
   * Calls whose `function_call_output` has not been sent yet. An executor that returns a value
   * clears its own entry; a consumer sending the output themselves (`sendToolResult`) clears it
   * too. An executor returning `undefined` means "no output for this call" — see AGENTS.md.
   */
  pendingCallIds: Set<string>;
  /**
   * The response this batch belongs to was already answered (a very late tool call). Its output
   * is still sent — the service waits for one per `call_id` — but asking for a second answer
   * would make the assistant speak twice for the same turn.
   */
  followUpSuppressed?: boolean;
  /**
   * Guard for declared calls that never arrive: without it a dropped control-channel event would
   * hold every later turn forever, which is worse than answering slightly early.
   */
  lateCallTimer?: ReturnType<typeof setTimeout>;
  /**
   * Tool calls the response actually contains, taken from `response.done`'s output list. Over
   * WebRTC the tool events can arrive *after* `response.done` and one at a time, so arrival order
   * cannot tell us whether more are coming — the completed response can.
   */
  expectedCalls: number;
}

/**
 * Hook for Microsoft Foundry Voice Live API integration
 * Supports all Voice Live parameters with best-practice defaults
 */
export function useVoiceLive(config: UseVoiceLiveConfig): UseVoiceLiveReturn {
  const {
    connection,
    session,
    autoConnect = false,
    autoStartMic = true,
    audioSampleRate = 24000,
    audioConstraints,
    logLevel = 'warn',
  } = config;

  const transport = connection.transport ?? 'websocket';

  // The latest config (session, connection, callbacks) is read through a ref inside the
  // callbacks below, so their identity does not change when callers pass inline objects or
  // closures on every render — this keeps `connect`/effects stable and avoids reconnect loops.
  const configRef = useRef<UseVoiceLiveConfig>(config);
  configRef.current = config;
  const logLevelRef = useRef(logLevel);
  logLevelRef.current = logLevel;
  const log = useMemo(() => createLogger(() => logLevelRef.current), []);

  /**
   * Invoke a consumer callback without letting an exception in it break the session: a throwing
   * `onEvent`/`onTranscript` must not abort event handling, and a throwing `onReconnecting` must
   * not leave the reconnect state machine half-updated.
   */
  const safeCall = useCallback(
    <TArgs extends unknown[]>(
      name: string,
      fn: ((...args: TArgs) => void) | undefined,
      ...args: TArgs
    ): boolean => {
      const sessionBefore = sessionRef.current;
      if (fn) {
        try {
          fn(...args);
        } catch (err) {
          log.error(`${name} callback threw:`, err);
        }
      }
      // A consumer may call disconnect()/connect() from its callback: the caller must not keep
      // applying an event to a session that no longer exists
      const stillCurrent = sessionRef.current === sessionBefore && sessionBefore?.scope.isActive !== false;
      if (!stillCurrent) {
        log.debug(`Session changed inside ${name} — stopping work for this event`);
      }
      return stillCurrent;
    },
    [log]
  );

  // ===== React state =====
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [rtcMicActive, setRtcMicActive] = useState(false);
  const [rtcMuted, setRtcMuted] = useState(false);
  const [, forceUpdate] = useState({});

  // ===== Core objects (framework-agnostic, see ../core) =====
  const transportKindRef = useRef<TransportKind>(transport);
  const graphRef = useRef<OutputAudioGraph | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const avatarRef = useRef<AvatarConnection | null>(null);
  const micRef = useRef<WebRtcMicrophone | null>(null);
  if (!micRef.current) micRef.current = new WebRtcMicrophone();

  // ===== Protocol state =====
  const isAgentModeRef = useRef<boolean>(false);
  /** Effective `turn_detection.create_response` as last reported by the service (default: on) */
  const autoCreateResponseRef = useRef<boolean>(true);
  const currentResponseIdRef = useRef<string | null>(null);
  /** Serializes `response.create` against the service (see `core/responseGate.ts`) */
  const responseGateRef = useRef<ResponseGate | null>(null);
  if (!responseGateRef.current) responseGateRef.current = new ResponseGate();
  const assistantTranscriptRef = useRef<string>('');
  const userTranscriptRef = useRef<string>('');
  const videoStreamRef = useRef<MediaStream | null>(null);
  const greetingSentRef = useRef<boolean>(false);
  /**
   * In-flight automatic tool executors, keyed by response id and scoped to the session record, so
   * a batch can never be adopted by a later session (executors are user code and may settle at
   * any time).
   */
  const toolBatchesRef = useRef<Map<string, ToolBatch>>(new Map());
  /**
   * Response ids whose `response.done` has been seen. Over WebRTC the lifecycle events (data
   * channel) and function-call events (control channel) are independent, so `response.done` can
   * arrive *before* a tool call of that response — a batch created afterwards would otherwise wait
   * forever for a completion signal that already happened.
   */
  const completedResponsesRef = useRef<BoundedMap<string, ResponseCompletion> | null>(null);
  if (!completedResponsesRef.current) completedResponsesRef.current = new BoundedMap(64);

  // ===== Lifetimes (see `core/lifecycle.ts`) =====
  /**
   * The `connect()` → `disconnect()` lifetime. Survives reconnect attempts, so work the user owns
   * across a hiccup (microphone acquisition, the audio graph) is scoped to it.
   */
  const connectionScopeRef = useRef<Scope | null>(null);
  /**
   * The live service session: one control channel and one server-side conversation. Replaced on
   * every (re)connect attempt, so anything naming conversation state (response/tool-call ids,
   * readiness) is scoped to it.
   */
  const sessionRef = useRef<LiveSession | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speculativeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSpeculativeTimer = useCallback((): void => {
    if (speculativeTimerRef.current) {
      clearTimeout(speculativeTimerRef.current);
      speculativeTimerRef.current = null;
    }
  }, []);

  /**
   * Free a speculative reservation the service never acknowledged, so a conversation whose
   * automatic response never arrives is not blocked. Armed wherever a reservation is taken.
   */
  /** Stable ref: `sendGatedResponseCreate` is defined before the helper it needs here */
  const armSpeculativeReleaseRef = useRef<() => void>();

  const armSpeculativeRelease = useCallback((): void => {
    const gate = responseGateRef.current as ResponseGate;
    if (!gate.isSpeculative) return;
    clearSpeculativeTimer();
    speculativeTimerRef.current = setTimeout(() => {
      speculativeTimerRef.current = null;
      if (gate.releaseSpeculative()) {
        sendGatedResponseCreateRef.current?.();
      } else if (gate.isSpeculative) {
        // The slot passed to another announced response — it needs its own watchdog
        armSpeculativeReleaseRef.current?.();
      }
    }, SPECULATIVE_RESPONSE_TIMEOUT_MS);
  }, [clearSpeculativeTimer]);
  armSpeculativeReleaseRef.current = armSpeculativeRelease;

  const clearConnectTimer = useCallback((): void => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  // Stable refs so transport callbacks always see the latest closures
  const sendEventRef = useRef<(event: VoiceLiveClientEvent | VoiceLiveEvent) => void>();
  const handleServerEventRef = useRef<(event: VoiceLiveServerEvent) => void>();
  const openConnectionRef = useRef<(connectionScope: Scope, mode: 'initial' | 'reconnect') => Promise<void>>();
  const handleUnexpectedCloseRef = useRef<(connectionScope: Scope, info: TransportCloseInfo) => void>();
  const requestResponseRef = useRef<typeof requestResponse>();
  const sendGatedResponseCreateRef = useRef<(event?: VoiceLiveClientEvent) => void>();
  /** Monotonic id for client events we need to correlate errors with */
  const clientEventSeqRef = useRef<number>(0);
  /** Payload of a queued `response.create`, so a custom request survives being deferred */
  const queuedResponseEventRef = useRef<VoiceLiveClientEvent | null>(null);
  const endConnectionRef = useRef<(options: { resetMute: boolean }) => void>();
  const finishToolBatchIfReadyRef = useRef<(key: string, batch: ToolBatch, session: LiveSession) => void>();

  /**
   * Handle audio data from microphone (WebSocket transport)
   * Converts to base64 and sends to Voice Live API
   */
  const handleAudioData = useCallback((audioData: ArrayBuffer): void => {
    // Only stream while the session is configured: during a reconnect (and between socket-open and
    // session.updated) the audio would either be dropped with a warning per 100 ms chunk, or worse,
    // be processed by a session that has not received our session.update yet.
    if (!sessionRef.current?.ready) return;
    sendEventRef.current?.({ type: 'input_audio_buffer.append', audio: arrayBufferToBase64(audioData) });
  }, []);

  /**
   * Integrate audio capture for microphone input (WebSocket transport)
   */
  const {
    isCapturing: wsMicActive,
    isMuted: wsMuted,
    startCapture: startWsMic,
    stopCapture: stopWsMic,
    toggleMute: toggleWsMute,
  } = useAudioCapture({
    sampleRate: audioSampleRate,
    audioConstraints: typeof audioConstraints === 'boolean' ? undefined : audioConstraints,
    onAudioData: handleAudioData,
    autoStart: false, // Manual control - we'll start when session is ready
  });

  /**
   * Build the wire session object for the current mode (standard vs Foundry agent)
   */
  const buildSession = useCallback(
    (sessionConfig?: VoiceLiveSessionConfig): Record<string, unknown> =>
      isAgentModeRef.current ? buildAgentSessionConfig(sessionConfig) : buildSessionConfig(sessionConfig),
    []
  );

  /**
   * Send an event to the Voice Live API (WebSocket / WebRTC control channel)
   */
  /** Put an event on the wire as-is. Internal: bypasses the response gate by design. */
  const sendRaw = useCallback(
    (event: VoiceLiveClientEvent | VoiceLiveEvent): boolean => {
      const active = sessionRef.current?.transport;
      if (!active || active.state !== 'open') {
        log.warn('Not connected, cannot send event:', event.type);
        return false;
      }
      if (!VERBOSE_CLIENT_EVENTS.has(event.type)) {
        log.debug('Sending:', event.type);
      }
      return active.send(JSON.stringify(event));
    },
    [log]
  );

  const sendEvent = useCallback(
    (event: VoiceLiveClientEvent | VoiceLiveEvent): boolean => {
      if (event.type === 'response.create') {
        // A raw `response.create` would bypass the serialization every other turn goes through and
        // could overlap a running response, which the service rejects. The consumer's payload is
        // kept — only the timing is taken over, so it may be sent after the current response.
        log.debug('Routing a raw response.create through the response gate');
        requestResponseRef.current?.({ event: event as VoiceLiveClientEvent });
        return true;
      }
      return sendRaw(event);
    },
    [sendRaw, log]
  );
  sendEventRef.current = sendEvent;

  /**
   * Complete a tool batch once the response emitted all its calls and every executor settled.
   */
  const finishToolBatchIfReady = useCallback(
    (key: string, batch: ToolBatch, session: LiveSession): void => {
      // Nothing a batch from a dead or superseded session does may touch live state — its own
      // teardown already cleared the map and its timers
      if (sessionRef.current !== session || !session.scope.isActive) return;
      // Not finished until: every executor settled, the response is known to be complete, and
      // every tool call that response contains has actually arrived
      if (!batch.responseDone || batchOwesOutputs(batch)) return;
      if (batch.lateCallTimer) {
        clearTimeout(batch.lateCallTimer);
        batch.lateCallTimer = undefined;
      }
      // A stale executor must not evict the live session's batch stored under the same
      // (service-assigned, per-session) response id — delete only our own entry
      if (toolBatchesRef.current.get(key) === batch) {
        toolBatchesRef.current.delete(key);
      }
      // A call arriving after this point must not resurrect a batch that waits for calls this one
      // already accounted for (that would hold every later turn forever), but whether it may ask
      // for an answer depends on whether *this* batch asked for one: `answered` records what
      // actually happened, not merely that the batch finished.
      const answerRequested =
        (batch.sentOutput || batch.followUpOwed) && !(batch.followUpSuppressed && !batch.followUpOwed);
      completedResponsesRef.current?.set(key, {
        outstandingToolCalls: 0,
        answered: answerRequested,
      });
      if (batch.followUpSuppressed && !batch.followUpOwed) {
        // This response was already answered: the late call's output is on the wire, and a second
        // response.create would answer the same turn twice. A user turn handed to this batch
        // (`followUpOwed`) still has to be answered, so it takes precedence.
        log.debug(`Response ${key} was already answered — not asking again for a late tool call`);
        return;
      }
      if (batch.sentOutput || batch.followUpOwed) {
        // Every output of this response is on the wire — ask for the answer. This goes through
        // the same deferral as sendText(), so a user turn and a tool batch completing in the
        // same tick produce ONE response.create (the service rejects overlapping responses).
        requestResponseRef.current?.();
      }
    },
    [log]
  );
  finishToolBatchIfReadyRef.current = finishToolBatchIfReady;

  /**
   * Ask the model for a response. If a response is still in progress the request is deferred
   * until `response.done` (Voice Live rejects overlapping responses).
   */
  /**
   * The single place a `response.create` reaches the wire. Everything else — user turns, the
   * greeting, tool follow-ups, queued flushes — goes through here, so the gate can never be
   * bypassed and every request carries an id the service can name in an `error`.
   */
  const sendGatedResponseCreate = useCallback(
    (requested?: VoiceLiveClientEvent): void => {
      const gate = responseGateRef.current as ResponseGate;
      // A queued request may carry a custom payload (a consumer's raw `response.create`, or the
      // greeting): flushing it as a bare request would silently drop what they asked for
      const event = requested ?? queuedResponseEventRef.current ?? { type: 'response.create' };
      queuedResponseEventRef.current = null;
      const eventId = `evt_${++clientEventSeqRef.current}`;
      gate.trackRequest(eventId);
      // `sendRaw`, not `sendEvent`: this IS the gated path, and going through the public wrapper
      // would route it straight back into the gate
      if (!sendRaw({ ...event, event_id: eventId })) {
        // Nothing reached the service (disconnected, or mid-reconnect): the gate must not stay busy
        gate.onRequestNotSent();
        armSpeculativeReleaseRef.current?.();
      }
    },
    [sendRaw]
  );

  /**
   * Watchdog for a tool batch that depends on an event which may never arrive: a declared tool
   * call still in flight, or the `response.done` that says no more are coming. Without it a
   * dropped control-channel event would leave the batch owing a follow-up forever — and a user
   * turn handed to that batch would never be answered.
   *
   * The batch is only *unblocked*, never answered early: `finishToolBatchIfReady` still waits for
   * every executor, and the follow-up still goes through the response gate, so a `response.done`
   * that merely arrives late results in a queued turn rather than an overlapping response.
   */
  const armToolBatchTimeout = useCallback(
    (key: string, batch: ToolBatch, session: LiveSession): void => {
      if (batch.lateCallTimer) clearTimeout(batch.lateCallTimer);
      batch.lateCallTimer = setTimeout(() => {
        batch.lateCallTimer = undefined;
        if (toolBatchesRef.current.get(key) !== batch) return;
        if (!batch.responseDone) {
          log.warn(`No response.done for response ${key} — completing its tool batch anyway`);
          batch.responseDone = true;
        }
        if (batch.seenCalls < batch.expectedCalls) {
          log.warn(
            `Tool call(s) declared by response ${key} never arrived — answering with ${batch.seenCalls}/${batch.expectedCalls}`
          );
          batch.expectedCalls = batch.seenCalls;
        }
        finishToolBatchIfReadyRef.current?.(key, batch, session);
      }, LATE_TOOL_CALL_TIMEOUT_MS);
    },
    [log]
  );

  /** The tool batch of this session that still owes a follow-up, if any */
  const pendingToolBatch = useCallback((): ToolBatch | null => {
    for (const batch of toolBatchesRef.current.values()) {
      if (batchOwesOutputs(batch)) return batch;
    }
    return null;
  }, []);

  const requestResponse = useCallback(
    (options: { event?: VoiceLiveClientEvent; dropIfBusy?: boolean } = {}): void => {
      const gate = responseGateRef.current as ResponseGate;
      // A response is owed by a tool batch that has not put all its outputs on the wire yet.
      // Answering now would make the model reply to a conversation with an unanswered tool call,
      // so the turn is handed to that batch — its single follow-up covers both, carrying a custom
      // payload if one was given.
      const batch = pendingToolBatch();
      if (batch) {
        if (options.dropIfBusy) {
          log.debug('Tool outputs still pending — dropping the proactive request');
          return;
        }
        batch.followUpOwed = true;
        if (options.event && !queuedResponseEventRef.current) {
          queuedResponseEventRef.current = options.event;
        }
        log.debug('Tool outputs still pending — the follow-up will answer this turn too');
        return;
      }
      if (options.dropIfBusy && gate.isBusy) {
        // A proactive greeting only makes sense as the first turn: if the conversation already
        // started, dropping it is right — queueing would greet after the user has spoken
        log.debug('Response already in progress — dropping the proactive request');
        return;
      }
      if (!gate.request()) {
        // Keep the first custom payload; later plain requests collapse into it
        if (options.event && !queuedResponseEventRef.current) {
          queuedResponseEventRef.current = options.event;
        }
        log.debug(`Response ${gate.currentState} — queued one response.create for response.done`);
        return;
      }
      sendGatedResponseCreate(options.event);
    },
    [sendGatedResponseCreate, pendingToolBatch, log]
  );
  requestResponseRef.current = requestResponse;
  sendGatedResponseCreateRef.current = sendGatedResponseCreate;

  /**
   * Stop local audio playback immediately (barge-in / cancel; WebSocket transport)
   */
  const stopAudioPlayback = useCallback((): void => {
    if (playerRef.current) {
      playerRef.current.stop();
      log.debug('Audio playback stopped');
    }
  }, [log]);

  /**
   * Send a user text message and (by default) trigger a response
   */
  const sendText = useCallback(
    (text: string, options: { triggerResponse?: boolean } = {}): void => {
      sendEvent({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
      if (options.triggerResponse !== false) {
        requestResponse();
      }
    },
    [sendEvent, requestResponse]
  );

  /**
   * Send a function-call result and (by default) trigger a response
   */
  const sendToolResult = useCallback(
    (callId: string, output: ToolResult, options: { triggerResponse?: boolean } = {}): void => {
      // A result the consumer sends themselves counts towards the batch that is coordinating this
      // response, so the follow-up covers it instead of racing a second one
      for (const batch of toolBatchesRef.current.values()) {
        if (batch.pendingCallIds.delete(callId)) {
          batch.sentOutput = true;
          break;
        }
      }
      sendEvent({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: typeof output === 'string' ? output : JSON.stringify(output),
        },
      });
      if (options.triggerResponse !== false) {
        requestResponse();
      }
    },
    [sendEvent, requestResponse]
  );

  /**
   * Cancel the in-progress response and flush local playback
   */
  const cancelResponse = useCallback((): void => {
    sendEvent({ type: 'response.cancel' });
    stopAudioPlayback();
  }, [sendEvent, stopAudioPlayback]);

  /** Clear the server-side input audio buffer */
  const clearInputAudio = useCallback((): void => {
    sendEvent({ type: 'input_audio_buffer.clear' });
  }, [sendEvent]);

  /** Commit the input audio buffer as a user turn (manual turn detection) */
  const commitInputAudio = useCallback((): void => {
    sendEvent({ type: 'input_audio_buffer.commit' });
  }, [sendEvent]);

  /**
   * Ask the model to respond now (manual turn control, or continuing after a server-side tool).
   * Goes through the same gate as `sendText()`, so it can never overlap another response.
   */
  const createResponse = useCallback((): void => {
    requestResponse();
  }, [requestResponse]);

  /** Approve or deny a pending MCP tool call */
  const approveMcpCall = useCallback(
    (approvalRequestId: string, approve: boolean): void => {
      sendEvent({
        type: 'conversation.item.create',
        item: { type: 'mcp_approval_response', approval_request_id: approvalRequestId, approve },
      });
    },
    [sendEvent]
  );

  /**
   * Update session configuration (agent-mode aware)
   */
  const updateSession = useCallback(
    (partialSession: Partial<VoiceLiveSessionConfig>): void => {
      sendEvent({
        type: 'session.update',
        session: buildSession({ ...configRef.current.session, ...partialSession }),
      });
    },
    [sendEvent, buildSession]
  );

  /**
   * The output audio graph (AudioContext + gain + analyser), created once per connection.
   * Triggers a re-render when the context is created so `audioContext`/`audioAnalyser` update.
   */
  const ensureGraph = useCallback((): OutputAudioGraph => {
    let graph = graphRef.current;
    if (!graph) {
      graph = new OutputAudioGraph({ log });
      graphRef.current = graph;
    }
    if (graph.ensure()) {
      forceUpdate({});
    }
    return graph;
  }, [log]);

  /** The PCM player for the WebSocket transport (lazy) */
  const ensurePlayer = useCallback((): PcmPlayer => {
    let player = playerRef.current;
    if (!player) {
      player = new PcmPlayer(ensureGraph(), {
        sourceSampleRate: configRef.current.audioSampleRate ?? 24000,
        log,
      });
      playerRef.current = player;
    }
    return player;
  }, [ensureGraph, log]);

  /** Mark the session ready (both transports) and settle a pending reconnect */
  const announceReady = useCallback((): void => {
    const session = sessionRef.current;
    if (!session || !session.scope.isActive) return;
    session.ready = true;
    setIsReady(true);
    setSessionState('listening');
    if (reconnectAttemptRef.current > 0) {
      log.info(`Reconnected after ${reconnectAttemptRef.current} attempt(s)`);
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      safeCall('onReconnected', configRef.current.onReconnected);
    }
  }, [log, safeCall]);

  /**
   * Set up the avatar media connection after `session.updated` (WebSocket transport)
   */
  const connectAvatar = useCallback(
    async (iceServers: RTCIceServer[]): Promise<void> => {
      log.debug('Setting up avatar WebRTC...');
      avatarRef.current?.close();
      const avatar = new AvatarConnection(
        {
          onVideoStream: (stream) => {
            videoStreamRef.current = stream;
            setVideoStream(stream);
          },
          onAudioStream: (stream) => {
            setAudioStream(stream);
            // Avatar sessions skip the MediaStreamDestination, so without this the public
            // `audioAnalyser` would have no input at all and visualizers would read silence
            if (stream) ensureGraph().attachRemoteStream(stream);
          },
          onError: (message) => {
            log.error(`Avatar: ${message}`);
            setError(message);
          },
        },
        { log }
      );
      avatarRef.current = avatar;
      const clientSdp = await avatar.createOffer(iceServers);
      if (avatarRef.current !== avatar) return; // torn down meanwhile
      sendEvent({ type: 'session.avatar.connect', client_sdp: clientSdp });
      log.debug('Avatar connection request sent');
    },
    [log, sendEvent, ensureGraph]
  );

  /**
   * Handle a server event (from the WebSocket or the WebRTC data channel)
   */
  const handleServerEvent = useCallback(
    async (data: VoiceLiveServerEvent): Promise<void> => {
      if (!VERBOSE_SERVER_EVENTS.has(data.type)) {
        log.debug(data.type);
      }

      const { onEvent, onTranscript, onWarning, onMcpApprovalRequest, onSessionUpdated, toolExecutor } =
        configRef.current;

      // Call custom event handler first (never let it abort our own handling). If it ends or
      // replaces the session, this event belongs to a session that no longer exists.
      if (!safeCall('onEvent', onEvent, data)) return;

      const isWebRtc = transportKindRef.current === 'webrtc';

      // Handle specific events
      switch (data.type) {
        case 'session.created': {
          if (data.session?.expires_at) {
            setSessionExpiresAt(data.session.expires_at * 1000);
          }
          if (isWebRtc) {
            // Session config was passed inside rtc.call.sdp.create
            log.debug('Session created (webrtc)');
            break;
          }
          // Configure the session before any audio flows
          log.debug('Configuring session...');
          sendEvent({ type: 'session.update', session: buildSession(configRef.current.session) });
          break;
        }

        case 'session.updated': {
          if (data.session?.expires_at) {
            setSessionExpiresAt(data.session.expires_at * 1000);
          }
          // The service echoes the effective session: keep the VAD behaviour in sync with it
          const turnDetection = (data.session as { turn_detection?: { create_response?: boolean } } | undefined)
            ?.turn_detection;
          autoCreateResponseRef.current = turnDetection ? turnDetection.create_response !== false : true;
          if (!safeCall('onSessionUpdated', onSessionUpdated, data.session as Record<string, unknown>)) {
            // The consumer disconnected/reconnected: do not set up an avatar for a dead session
            break;
          }

          if (isWebRtc) {
            // Readiness is driven by the peer connection + data channel state in WebRTC mode
            log.debug('Session configured (webrtc)');
            break;
          }
          log.debug('Session configured');

          if (data.session?.avatar?.ice_servers) {
            const avatarSession = sessionRef.current;
            try {
              await connectAvatar(data.session.avatar.ice_servers);
            } catch (err) {
              if (sessionRef.current !== avatarSession || !avatarSession?.scope.isActive) {
                // Torn down while the offer was in flight — the rejection is expected
                log.debug('Avatar offer rejected after teardown — ignoring');
                break;
              }
              log.error('Avatar setup failed:', err);
              setError(err instanceof Error ? err.message : 'Avatar setup failed');
            }
          } else {
            // Voice-only mode (no avatar) - session is ready immediately
            log.info('Voice session ready');
            announceReady();
          }
          break;
        }

        case 'session.avatar.connecting':
          if (data.server_sdp && avatarRef.current) {
            // A disconnect()/reconnect while this is pending must not mark the new (or dead)
            // session ready, nor overwrite its error state
            const avatar = avatarRef.current;
            const avatarSession = sessionRef.current;
            const isCurrent = (): boolean =>
              avatarRef.current === avatar && sessionRef.current === avatarSession && !!avatarSession?.scope.isActive;
            try {
              await avatar.applyServerSdp(data.server_sdp);
              if (!isCurrent()) {
                log.debug('Avatar SDP applied after teardown — ignoring');
                break;
              }
              log.info('Avatar WebRTC established');
              announceReady();
            } catch (err) {
              if (!isCurrent()) break;
              log.error('Failed to apply avatar SDP:', err);
              setError(err instanceof Error ? err.message : 'Failed to apply avatar SDP');
            }
          }
          break;

        case 'response.created':
          clearSpeculativeTimer();
          (responseGateRef.current as ResponseGate).onResponseCreated();
          setSessionState('speaking');
          // Reset transcript accumulator for new response
          assistantTranscriptRef.current = '';
          // Track current response for interruption handling + viseme sync
          if (data.response?.id) {
            currentResponseIdRef.current = data.response.id;
            playerRef.current?.markResponseStart();
          }
          break;

        case 'input_audio_buffer.speech_started':
          log.debug('User speaking (interrupting)...');
          setSessionState('listening');
          userTranscriptRef.current = '';
          if (!isWebRtc) {
            // Microsoft's official pattern for WebSocket barge-in: stop client-side playback
            // immediately; the server handles truncation with auto_truncate: true
            stopAudioPlayback();
          }
          break;

        case 'input_audio_buffer.speech_stopped': {
          log.debug('User stopped speaking');
          setSessionState('thinking');
          // With server VAD creating responses (the default), the service is about to start one.
          // Reserving the slot keeps a turn submitted in this window from overlapping it; the
          // reservation is speculative and self-heals if no `response.created` follows.
          // Read what the *service* reports (session.updated), because updateSession() can change
          // this at runtime — local config would go stale. Agent sessions are included: they use
          // server VAD as well, and their echo corrects the default if the agent disables it.
          if (autoCreateResponseRef.current) {
            // Announced while another response is running? The gate remembers it and takes the
            // reservation at `response.done` — the timer is armed there.
            (responseGateRef.current as ResponseGate).reserveAutomatic();
            armSpeculativeRelease();
          }
          break;
        }

        case 'conversation.item.input_audio_transcription.delta':
          if (onTranscript && data.delta) {
            userTranscriptRef.current += data.delta;
            if (!safeCall('onTranscript', onTranscript, 'user', userTranscriptRef.current, false)) break;
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          log.debug(`User said: "${data.transcript}"`);
          if (onTranscript && data.transcript) {
            if (!safeCall('onTranscript', onTranscript, 'user', data.transcript, true)) break;
          }
          userTranscriptRef.current = '';
          break;

        case 'response.audio.delta':
          // Play audio for WebSocket voice-only mode (no avatar), only for the current response
          if (isWebRtc) break;
          if (data.delta && !videoStreamRef.current && data.response_id === currentResponseIdRef.current) {
            void ensurePlayer().enqueue(data.delta);
          }
          break;

        case 'response.audio_transcript.delta':
        case 'response.text.delta':
          if (onTranscript && data.delta) {
            assistantTranscriptRef.current += data.delta;
            if (!safeCall('onTranscript', onTranscript, 'assistant', assistantTranscriptRef.current, false)) break;
          }
          break;

        case 'response.done': {
          // Emit final assistant transcript if accumulated
          if (onTranscript && assistantTranscriptRef.current) {
            const transcript = assistantTranscriptRef.current;
            assistantTranscriptRef.current = '';
            // A consumer may disconnect() on the final transcript: everything below belongs to a
            // session that would no longer exist (state, the gate, a queued flush)
            if (!safeCall('onTranscript', onTranscript, 'assistant', transcript, true)) break;
          }
          setSessionState('listening');
          // No further tool calls can arrive for this response, so a batch whose executors have
          // all settled may ask for the answer now — while the gate still counts this response as
          // running, so the request is queued into the single flush below instead of racing it.
          const doneSession = sessionRef.current;
          const doneKey = `${data.response?.id ?? currentResponseIdRef.current ?? ''}`;
          // The completed response lists its own tool calls: that is the only reliable way to know
          // whether more are still on their way over the (independent) control channel
          const toolCallCount = (data.response?.output ?? []).filter(
            (item) => (item as { type?: string }).type === 'function_call'
          ).length;
          const completions = completedResponsesRef.current as BoundedMap<string, ResponseCompletion>;
          completions.set(doneKey, {
            outstandingToolCalls: toolCallCount,
            answered: completions.get(doneKey)?.answered ?? false,
          });
          let doneBatch = toolBatchesRef.current.get(doneKey);
          // Only reserve when *we* run the tools: a consumer handling function calls manually
          // through onEvent/sendToolResult never advances a batch, so reserving one would hold
          // their follow-up until the late-call timeout on every tool turn.
          if (!doneBatch && toolCallCount > 0 && doneSession && configRef.current.toolExecutor) {
            // The response declares tool calls whose events have not arrived yet (WebRTC delivers
            // them on the other channel). Reserve the batch now, so turns submitted meanwhile are
            // held instead of being answered without the outputs.
            doneBatch = {
              pending: 0,
              sentOutput: false,
              responseDone: true,
              followUpOwed: false,
              seenCalls: 0,
              expectedCalls: toolCallCount,
              pendingCallIds: new Set<string>(),
            };
            toolBatchesRef.current.set(doneKey, doneBatch);
          }
          if (doneBatch && doneSession) {
            doneBatch.responseDone = true;
            doneBatch.expectedCalls = Math.max(doneBatch.expectedCalls, toolCallCount);
            if (batchOwesOutputs(doneBatch)) {
              // A queued user turn must NOT be sent now — the service would answer before the
              // required function_call_output exists. Hand it to the batch, whose single follow-up
              // answers the tool result and that turn together.
              doneBatch.followUpOwed =
                (responseGateRef.current as ResponseGate).consumeQueuedRequest() || doneBatch.followUpOwed;
              // ...but never wait forever for a call that may never arrive
              armToolBatchTimeout(doneKey, doneBatch, doneSession);
            }
            finishToolBatchIfReady(doneKey, doneBatch, doneSession);
          }
          // Exactly one response.create for everything requested while this response ran
          if ((responseGateRef.current as ResponseGate).onResponseDone()) {
            log.debug('Sending queued response.create');
            sendGatedResponseCreate();
          } else {
            // The gate may have taken a reservation for an automatic response announced while this
            // one was running; it must not be able to block the conversation if none arrives
            armSpeculativeRelease();
          }
          break;
        }

        case 'response.audio_transcript.done':
          if (data.transcript) {
            log.debug(`Assistant: "${data.transcript}"`);
          }
          break;

        case 'response.text.done':
          if (data.text) {
            log.debug(`Assistant (text): "${data.text}"`);
          }
          break;

        case 'conversation.item.truncated':
          log.debug(`Assistant turn truncated at ${data.audio_end_ms} ms (item ${data.item_id})`);
          break;

        case 'conversation.item.created':
          if (data.item?.type === 'mcp_approval_request') {
            log.info(`MCP approval requested: ${data.item.server_label}/${data.item.name}`);
            safeCall('onMcpApprovalRequest', onMcpApprovalRequest, {
              approvalRequestId: data.item.id ?? '',
              serverLabel: data.item.server_label ?? '',
              name: data.item.name ?? '',
              arguments: data.item.arguments ?? '',
            });
          }
          break;

        case 'response.function_call_arguments.done':
          if (toolExecutor) {
            const { name, arguments: args, call_id: callId } = data;
            // One response can contain several function calls (parallel tool calls) whose
            // executors settle at different times. Every output is sent immediately, but the
            // follow-up response waits for `response.done` *and* the last executor — only then is
            // it certain that no further tool call belongs to this response, so the model can
            // never answer from a partial result set. The batch belongs to this session: a
            // reconnect replaces the conversation, and `session.scope` says so.
            const session = sessionRef.current;
            const batchKey = `${data.response_id ?? currentResponseIdRef.current ?? ''}`;
            const completed = completedResponsesRef.current as BoundedMap<string, ResponseCompletion>;
            const completion = completed.get(batchKey);
            const batch =
              toolBatchesRef.current.get(batchKey) ??
              ({
                pending: 0,
                sentOutput: false,
                // The response may already be finished when its tool call reaches us (WebRTC), in
                // which case we also know how many calls to expect
                responseDone: completed.has(batchKey),
                followUpOwed: false,
                seenCalls: 0,
                expectedCalls: completion?.outstandingToolCalls ?? 0,
                followUpSuppressed: completion?.answered ?? false,
                pendingCallIds: new Set<string>(),
              } satisfies ToolBatch);
            batch.seenCalls += 1;
            batch.pendingCallIds.add(callId);
            batch.pending += 1;
            toolBatchesRef.current.set(batchKey, batch);
            if (session && !batch.responseDone) {
              // The batch now depends on a `response.done` that may never arrive (a dropped
              // control-channel event, or a response that fails with an `error` instead). Without
              // this watchdog it would owe its follow-up forever, silently swallowing a user turn
              // handed to it.
              armToolBatchTimeout(batchKey, batch, session);
            }
            Promise.resolve()
              .then(() => toolExecutor(name, args, callId))
              .then((result) => {
                if (result === undefined) return;
                if (sessionRef.current !== session || !session?.scope.isActive) {
                  // The session ended or reconnected while the tool was running: this output
                  // belongs to a conversation the service no longer has
                  log.debug(`Discarding ${name} result: session ended before the executor settled`);
                  return;
                }
                sendToolResult(callId, result, { triggerResponse: false });
                batch.sentOutput = true;
                batch.pendingCallIds.delete(callId);
              })
              .catch((err) => {
                log.error(`toolExecutor failed for ${name}:`, err);
                if (sessionRef.current !== session || !session?.scope.isActive) return;
                // The service waits for an output for this call_id: without one the conversation
                // stalls forever. Report the failure so the model can react to it instead.
                sendToolResult(callId, { error: err instanceof Error ? err.message : String(err) }, {
                  triggerResponse: false,
                });
                batch.sentOutput = true;
                batch.pendingCallIds.delete(callId);
              })
              .finally(() => {
                // A void executor means "no automatic output for this call": stop waiting for one
                batch.pendingCallIds.delete(callId);
                batch.pending -= 1;
                if (session) finishToolBatchIfReady(batchKey, batch, session);
              });
          }
          break;

        case 'warning':
          log.warn('Service warning:', data.warning);
          safeCall('onWarning', onWarning, data.warning);
          break;

        // Negotiation events are handled inside WebRtcTransport (answer applied / error reported)
        case 'rtc.call.sdp.created':
        case 'rtc.call.error':
          break;

        case 'error': {
          const errorCode = data.error?.code || '';
          const errorMessage = data.error?.message || 'Unknown API error';

          // Filter benign errors that occur during normal barge-in
          if (
            errorCode === 'response_cancel_not_active' ||
            errorMessage.toLowerCase().includes('no active response')
          ) {
            log.debug('Benign cancel error (ignored):', errorMessage);
            break;
          }

          log.error('API Error:', data.error);
          // The error may be the rejection of a response.create we are waiting on: no response.done
          // will follow, so the gate falls back to idle and any queued turn is sent now
          // The offending *client* event id is inside the error payload; the top-level event_id
          // identifies the server's error event itself
          if ((responseGateRef.current as ResponseGate).onError(data.error?.event_id)) {
            log.debug('Sending queued response.create after an API error');
            sendGatedResponseCreate();
          } else {
            // The gate may have taken over a reservation for an automatic response announced while
            // the rejected request was in flight — it needs its release timer
            armSpeculativeRelease();
          }
          setError(errorMessage);
          break;
        }

        default:
          break;
      }
    },
    [
      log,
      safeCall,
      sendEvent,
      sendToolResult,
      sendGatedResponseCreate,
      finishToolBatchIfReady,
      buildSession,
      ensurePlayer,
      stopAudioPlayback,
      connectAvatar,
      announceReady,
      armToolBatchTimeout,
      armSpeculativeRelease,
      clearSpeculativeTimer,
    ]
  );
  handleServerEventRef.current = handleServerEvent;

  // ===== WebRTC microphone control =====

  const startRtcMic = useCallback(async (): Promise<void> => {
    const mic = micRef.current as WebRtcMicrophone;
    // The microphone belongs to the *connection*: it is kept across reconnects and re-attached to
    // the new transport. `stopMic()`/`disconnect()` supersede a pending acquisition inside
    // `WebRtcMicrophone` itself, which then resolves to null.
    // `startMic()` before `connect()` is supported (a user gesture can pre-arm the microphone and
    // connect() passes it as `localTrack`), so a *missing* connection is fine here — only a
    // connection that has since ended invalidates the acquisition.
    const scope = connectionScopeRef.current;
    const track = await mic.start(configRef.current.audioConstraints);
    if (!track) return; // superseded by stop() while the permission prompt was open
    if (scope && !scope.isActive) {
      log.debug('Microphone acquired after disconnect — releasing it');
      mic.stop();
      return;
    }
    const transport = sessionRef.current?.transport;
    if (transport) {
      await transport.setMicrophoneTrack(track);
      // `replaceTrack` is async too: a disconnect()/stopMic() during it must still win
      if ((scope && !scope.isActive) || !mic.isActive) {
        log.debug('Microphone attached after the session ended — releasing it');
        mic.stop();
        return;
      }
    }
    setRtcMicActive(true);
    log.debug('WebRTC microphone started');
  }, [log]);

  const stopRtcMic = useCallback((): void => {
    micRef.current?.stop();
    sessionRef.current?.transport.setMicrophoneTrack(null).catch(() => undefined);
    setRtcMicActive(false);
    log.debug('WebRTC microphone stopped');
  }, [log]);

  const toggleRtcMute = useCallback((): void => {
    const mic = micRef.current as WebRtcMicrophone;
    const next = !mic.isMuted;
    mic.setMuted(next);
    setRtcMuted(next);
  }, []);

  // Unified mic API. It follows the transport of the *live* session: changing
  // `connection.transport` while connected only takes effect on the next attempt, so the controls
  // must keep operating on the microphone that is actually running until then.
  const activeTransport = sessionRef.current?.transport.kind ?? transport;
  const startMic = activeTransport === 'webrtc' ? startRtcMic : startWsMic;
  const stopMic = activeTransport === 'webrtc' ? stopRtcMic : stopWsMic;
  const toggleMute = activeTransport === 'webrtc' ? toggleRtcMute : toggleWsMute;
  const isMicActive = activeTransport === 'webrtc' ? rtcMicActive : wsMicActive;
  const isMuted = activeTransport === 'webrtc' ? rtcMuted : wsMuted;

  /**
   * Release the media/session objects of the current connection (transport, avatar, player,
   * audio graph). Used by disconnect() and between reconnect attempts (`keepAudio`).
   */
  const releaseConnection = useCallback((options: { keepAudio: boolean }): void => {
    clearConnectTimer();
    clearSpeculativeTimer();
    // Aborting the session scope is the single teardown signal: every in-flight continuation that
    // captured it (tool executors, avatar negotiation, mic attachment) discards itself
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.scope.abort();
    session?.transport.close();
    avatarRef.current?.close();
    avatarRef.current = null;
    videoStreamRef.current = null;
    setVideoStream(null);
    if (options.keepAudio) {
      // Between reconnect attempts: keep the AudioContext (user gesture) but flush playback
      playerRef.current?.stop();
      graphRef.current?.detachRemoteStream();
    } else {
      playerRef.current?.dispose();
      playerRef.current = null;
      graphRef.current?.close();
      graphRef.current = null;
      setAudioStream(null);
    }
    currentResponseIdRef.current = null;
    (responseGateRef.current as ResponseGate).reset();
    queuedResponseEventRef.current = null;
    for (const batch of toolBatchesRef.current.values()) {
      if (batch.lateCallTimer) clearTimeout(batch.lateCallTimer);
    }
    toolBatchesRef.current.clear();
    completedResponsesRef.current?.clear();
    assistantTranscriptRef.current = '';
    userTranscriptRef.current = '';
    // The expiry belonged to the session that just ended; the next session.created brings a new one
    setSessionExpiresAt(null);
  }, [clearConnectTimer, clearSpeculativeTimer]);

  /**
   * Schedule a reconnect attempt after an unexpected close, or settle into
   * 'disconnected' / 'error' when reconnecting is off or exhausted.
   */
  const handleUnexpectedClose = useCallback(
    (connectionScope: Scope, info: TransportCloseInfo): void => {
      const policy = resolveReconnectOptions(configRef.current.reconnect);
      const attempt = reconnectAttemptRef.current + 1;
      if (policy && isReconnectableClose(info) && attempt <= policy.maxAttempts) {
        const delayMs = computeBackoffDelay(attempt, policy);
        reconnectAttemptRef.current = attempt;
        setReconnectAttempt(attempt);
        setConnectionState('reconnecting');
        log.warn(
          `Connection lost (code ${info.code}${info.reason ? `, ${info.reason}` : ''}) — reconnect attempt ${attempt}/${policy.maxAttempts} in ${delayMs} ms`
        );
        // Keep the AudioContext (created on the user's gesture) but drop everything else, then
        // arm the retry *before* notifying: a throwing callback must not strand the state machine
        releaseConnection({ keepAudio: true });
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (!connectionScope.isActive) return; // disconnect()/connect() happened meanwhile
          void openConnectionRef.current?.(connectionScope, 'reconnect');
        }, delayMs);
        safeCall('onReconnecting', configRef.current.onReconnecting, attempt, delayMs);
        return;
      }
      const gaveUp = policy !== null && reconnectAttemptRef.current > 0;
      const message = gaveUp
        ? `Connection lost — giving up after ${reconnectAttemptRef.current} reconnect attempt(s)`
        : null;
      // Nothing will follow this close, so end the whole connection (microphone included).
      // The mute preference is kept: it belongs to the user, not to the connection.
      endConnectionRef.current?.({ resetMute: false });
      if (message) {
        log.error(message);
        setError(message);
        setConnectionState('error');
      } else {
        setConnectionState((state) => (state === 'error' ? state : 'disconnected'));
      }
    },
    [log, releaseConnection, safeCall]
  );
  handleUnexpectedCloseRef.current = handleUnexpectedClose;

  /**
   * Create the transport for one connection attempt and wire its callbacks. Callbacks from a
   * stale generation or a transport that has been replaced are ignored.
   */
  const createTransport = useCallback(
    (kind: TransportKind, connectionScope: Scope): LiveSession => {
      // One session record per attempt. Its scope is a child of the connection scope, so
      // `disconnect()` ends both, while a reconnect only replaces the session.
      const scope = connectionScope.child('session');
      let session: LiveSession | null = null;
      /** Callbacks from a superseded transport (or after teardown) are ignored */
      const isStale = (): boolean => sessionRef.current !== session || !scope.isActive;

      const callbacks: TransportCallbacks = {
        onOpen: () => {
          if (isStale()) return;
          clearConnectTimer();
          log.info(kind === 'webrtc' ? 'Control channel connected' : 'WebSocket connected');
          setConnectionState('connected');
          try {
            const graph = ensureGraph();
            if (kind === 'websocket' && !configRef.current.session?.avatar) {
              // Voice-only WebSocket mode: expose played audio as a MediaStream
              const stream = graph.ensureDestination();
              if (stream) setAudioStream(stream);
            }
          } catch (err) {
            // A blocked/unavailable AudioContext must not abort the connection: over WebRTC the
            // remote RTP stream plays on its own and the graph is only used for visualization.
            // (Over WebSocket, playback then fails later with a clear error from the player.)
            log.warn('Audio graph unavailable:', err);
          }
        },
        onEvent: (event) => {
          if (isStale()) return;
          void handleServerEventRef.current?.(event);
        },
        onError: (message, cause) => {
          if (isStale()) return;
          log.error(message, cause ?? '');
          setError(message);
          setConnectionState('error');
        },
        onClose: (info) => {
          if (isStale()) return;
          log.info(`Connection closed - Code: ${info.code}, Reason: ${info.reason || 'none'}, Clean: ${info.wasClean}`);
          if (!info.wasClean) {
            log.warn('Connection closed unexpectedly');
          }
          setIsReady(false);
          setSessionState('idle');
          // The transport closed itself; drop the record so releaseConnection() does not re-close it
          sessionRef.current = null;
          scope.abort();
          handleUnexpectedClose(connectionScope, info);
        },
        onReady: (reason) => {
          if (isStale()) return;
          log.debug(`Transport ready (${reason})`);
          announceReady();
        },
        onRemoteStream: (stream) => {
          if (isStale()) return;
          setAudioStream(stream);
          // Remote tracks start muted and unmute once RTP packets arrive — useful for diagnostics
          stream.getAudioTracks().forEach((track) => {
            track.addEventListener('unmute', () => log.debug('Remote audio flowing (track unmuted)'), { once: true });
          });
          ensureGraph().attachRemoteStream(stream);
        },
      };

      const transport =
        kind === 'webrtc'
          ? new WebRtcTransport(callbacks, {
              rtcConfiguration: configRef.current.connection.rtcConfiguration,
              log,
            })
          : new WebSocketTransport(callbacks, { log });
      // Closing the transport is part of ending the session, wherever the abort comes from
      scope.onAbort(() => transport.close());
      session = { scope, transport, ready: false };
      return session;
    },
    [log, ensureGraph, announceReady, handleUnexpectedClose, clearConnectTimer]
  );

  /**
   * Open a connection for the given generation (initial connect or reconnect attempt)
   */
  const openConnection = useCallback(
    async (connectionScope: Scope, mode: 'initial' | 'reconnect'): Promise<void> => {
      const { connection: currentConnection, session: currentSession } = configRef.current;
      const kind: TransportKind = currentConnection.transport ?? 'websocket';

      try {
        setError(null);
        setConnectionState(mode === 'initial' ? 'connecting' : 'reconnecting');

        // Fresh token per attempt when a provider is configured
        const token = currentConnection.getToken ? await currentConnection.getToken() : currentConnection.token;
        if (!connectionScope.isActive) return; // disconnected while acquiring the token
        const resolvedConnection = token ? { ...currentConnection, token } : currentConnection;

        const { url, isAgentMode, modeLabel } = buildVoiceLiveUrl(resolvedConnection);
        isAgentModeRef.current = isAgentMode;
        transportKindRef.current = kind;

        log.info(`${mode === 'reconnect' ? 'Reconnecting' : 'Connecting'} (${modeLabel}, ${kind}) → ${redactUrl(url)}`);
        if (mode === 'initial') {
          // Local compatibility warnings reach `onWarning` like the service's own `warning`
          // events, so an app can surface them in its UI instead of only in the console
          validateConfig(currentSession ?? {}, isAgentMode, currentConnection.model).forEach((warning) => {
            log.warn(warning);
            safeCall('onWarning', configRef.current.onWarning, {
              message: warning,
              code: CLIENT_CONFIG_WARNING_CODE,
            });
          });
          // A consumer may `disconnect()` from `onWarning`. Continuing would open a socket whose
          // scope is already aborted — its close handler runs before `connect()` and the transport
          // would be left open with nothing able to shut it down.
          if (!connectionScope.isActive) {
            log.debug('Connection ended while reporting configuration warnings');
            return;
          }
        }
        if (kind === 'webrtc') {
          validateTransport(resolvedConnection, currentSession);
        }

        // Replace whatever session is left from a previous attempt (silently)
        const previous = sessionRef.current;
        sessionRef.current = null;
        previous?.scope.abort();
        connectionScope.pruneChildren();
        // WebRTC embeds the session in `rtc.call.sdp.create` and is ready before any
        // `session.updated`, so seed the effective VAD behaviour from what we send; later server
        // echoes still correct it.
        autoCreateResponseRef.current = currentSession?.turnDetection?.createResponse !== false;
        const session = createTransport(kind, connectionScope);
        sessionRef.current = session;
        // A new conversation has no outstanding requests, whatever happened before it
        (responseGateRef.current as ResponseGate).reset();
        session.transport.connect(url, kind === 'webrtc' ? buildSession(currentSession) : {}, {
          // WebRTC: keep sending the microphone that was started before connect()/reconnect
          localTrack: kind === 'webrtc' ? micRef.current?.track ?? null : undefined,
        });

        // A socket that never opens *and* never errors (silently dropped upgrade, dead proxy)
        // would leave the hook in 'connecting' forever, and connect() refuses to run again
        const timeoutMs = configRef.current.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        clearConnectTimer();
        if (timeoutMs > 0) {
          connectTimerRef.current = setTimeout(() => {
            connectTimerRef.current = null;
            if (sessionRef.current !== session || !session.scope.isActive) return;
            if (session.transport.state === 'open') return;
            const message = `Connection timed out after ${timeoutMs} ms (control channel never opened)`;
            log.error(message);
            sessionRef.current = null;
            session.scope.abort(); // closes the transport via its onAbort handler
            setIsReady(false);
            setError(message);
            setConnectionState('error');
            // Let the reconnect policy decide whether to try again
            handleUnexpectedCloseRef.current?.(connectionScope, {
              code: CONNECT_TIMEOUT_CLOSE_CODE,
              reason: message,
              wasClean: false,
            });
          }, timeoutMs);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to connect';
        log.error('Connection error:', err);
        clearConnectTimer();
        if (!connectionScope.isActive) return; // superseded meanwhile
        if (mode === 'reconnect') {
          // A transient getToken()/setup failure must consume an attempt and continue the
          // backoff policy instead of ending the session with no transport and no timer
          handleUnexpectedCloseRef.current?.(connectionScope, {
            code: RECONNECT_SETUP_FAILED_CLOSE_CODE,
            reason: errorMessage,
            wasClean: false,
          });
          return;
        }
        // Nothing will follow a failed initial connect either: end the connection so a
        // pre-connect `startMic()` microphone is released instead of recording into nothing
        endConnectionRef.current?.({ resetMute: false });
        setError(errorMessage);
        setConnectionState('error');
      }
    },
    [log, safeCall, buildSession, createTransport, clearConnectTimer]
  );
  openConnectionRef.current = openConnection;

  /**
   * Connect to Voice Live API
   */
  const connect = useCallback(async (): Promise<void> => {
    // Idempotent: a second call while a transport is connecting/open is a no-op
    const active = sessionRef.current?.transport;
    if (active && (active.state === 'connecting' || active.state === 'open')) {
      log.warn('connect() ignored: already connecting or connected');
      return;
    }
    // A manual connect() supersedes a pending reconnect
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    greetingSentRef.current = false;

    // A fresh connection lifetime; anything still referring to the old one is now inert
    connectionScopeRef.current?.abort();
    const connectionScope = new Scope('connection');
    connectionScopeRef.current = connectionScope;
    await openConnection(connectionScope, 'initial');
  }, [log, openConnection]);

  /**
   * Disconnect from Voice Live API
   */
  /**
   * End the connection lifetime: no reconnect will follow, so the microphone (which is
   * deliberately kept *across* reconnect attempts) must be released too. Used by `disconnect()`
   * and by every terminal close — leaving the microphone live after the session ended would keep
   * the browser's recording indicator on.
   */
  const endConnection = useCallback(
    (options: { resetMute: boolean }): void => {
      connectionScopeRef.current?.abort();
      connectionScopeRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;
      greetingSentRef.current = false;

      // Stop microphone capture (both transports)
      stopWsMic();
      micRef.current?.stop();
      if (options.resetMute) micRef.current?.setMuted(false);
      setRtcMicActive(false);
      if (options.resetMute) setRtcMuted(false);

      releaseConnection({ keepAudio: false });

      setReconnectAttempt(0);
      setIsReady(false);
      setSessionState('idle');
    },
    [stopWsMic, releaseConnection]
  );

  endConnectionRef.current = endConnection;

  const disconnect = useCallback((): void => {
    log.info('Disconnecting...');
    endConnection({ resetMute: true });
    setSessionExpiresAt(null);
    setConnectionState('disconnected');
  }, [endConnection, log]);

  // Auto-connect if requested (connect is stable, so this runs once per mount / autoConnect change)
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
  }, [autoConnect, connect]);

  // Auto-start microphone when session is ready
  useEffect(() => {
    if (isReady && autoStartMic && !isMicActive) {
      log.debug('Starting microphone...');
      startMic().catch((err) => {
        log.error('Microphone error:', err);
      });
    }
  }, [isReady, autoStartMic, isMicActive, startMic, log]);

  // Send the proactive greeting once per connect() (not again after a reconnect)
  useEffect(() => {
    if (!isReady || !session?.greeting || greetingSentRef.current) return;
    greetingSentRef.current = true;
    log.debug(`Sending proactive greeting (${session.greeting.type})...`);
    // An LLM greeting is a *pair*: a system instruction item plus the response request. If the
    // conversation already started, the whole pair is dropped — sending only the instruction would
    // leave it in the conversation, silently steering the user's own turn.
    const gate = responseGateRef.current as ResponseGate;
    if (gate.isBusy || pendingToolBatch()) {
      log.debug('Conversation already started — skipping the proactive greeting');
      return;
    }
    // The greeting's own `response.create` carries a payload (the pre-generated message), so it is
    // sent through the gate rather than replaced by a bare one.
    buildGreetingEvents(session.greeting).forEach((event) => {
      if (event.type === 'response.create') {
        requestResponse({ event, dropIfBusy: true });
      } else {
        sendEvent(event);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  /**
   * Get current audio playback time in milliseconds
   * Used for synchronizing visemes with audio playback (WebSocket transport only)
   */
  const getAudioPlaybackTime = useCallback((): number | null => {
    if (transportKindRef.current === 'webrtc') return null;
    return playerRef.current?.playbackTimeMs() ?? null;
  }, []);

  return {
    connectionState,
    reconnectAttempt,
    sessionState,
    transport,
    videoStream,
    audioStream,
    audioContext: graphRef.current?.context ?? null,
    audioAnalyser: graphRef.current?.analyser ?? null,
    sessionExpiresAt,
    isReady,
    isMicActive,
    isMuted,
    error,
    connect,
    disconnect,
    startMic,
    stopMic,
    toggleMute,
    sendEvent,
    updateSession,
    sendText,
    sendToolResult,
    cancelResponse,
    clearInputAudio,
    commitInputAudio,
    createResponse,
    approveMcpCall,
    getAudioPlaybackTime,
  };
}
