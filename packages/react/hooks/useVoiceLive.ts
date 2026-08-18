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
  const transportRef = useRef<VoiceLiveTransport | null>(null);
  const transportKindRef = useRef<TransportKind>(transport);
  const graphRef = useRef<OutputAudioGraph | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const avatarRef = useRef<AvatarConnection | null>(null);
  const micRef = useRef<WebRtcMicrophone | null>(null);
  if (!micRef.current) micRef.current = new WebRtcMicrophone();

  // ===== Protocol state =====
  const isAgentModeRef = useRef<boolean>(false);
  const currentResponseIdRef = useRef<string | null>(null);
  const responseActiveRef = useRef<boolean>(false);
  const pendingResponseCreateRef = useRef<boolean>(false);
  const assistantTranscriptRef = useRef<string>('');
  const userTranscriptRef = useRef<string>('');
  const videoStreamRef = useRef<MediaStream | null>(null);
  const greetingSentRef = useRef<boolean>(false);

  // ===== Connection generation + reconnect bookkeeping =====
  // `connectIdRef` changes on every connect()/disconnect(); callbacks from an older generation
  // (or from a transport that is no longer current) are ignored.
  const connectIdRef = useRef<number>(0);
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs so transport callbacks always see the latest closures
  const sendEventRef = useRef<(event: VoiceLiveClientEvent | VoiceLiveEvent) => void>();
  const handleServerEventRef = useRef<(event: VoiceLiveServerEvent) => void>();
  const openConnectionRef = useRef<(connectId: number, mode: 'initial' | 'reconnect') => Promise<void>>();

  /**
   * Handle audio data from microphone (WebSocket transport)
   * Converts to base64 and sends to Voice Live API
   */
  const handleAudioData = useCallback((audioData: ArrayBuffer): void => {
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
  const sendEvent = useCallback(
    (event: VoiceLiveClientEvent | VoiceLiveEvent): void => {
      const active = transportRef.current;
      if (active && active.state === 'open') {
        if (!VERBOSE_CLIENT_EVENTS.has(event.type)) {
          log.debug('Sending:', event.type);
        }
        active.send(JSON.stringify(event));
      } else {
        log.warn('Not connected, cannot send event:', event.type);
      }
    },
    [log]
  );
  sendEventRef.current = sendEvent;

  /**
   * Ask the model for a response. If a response is still in progress the request is deferred
   * until `response.done` (Voice Live rejects overlapping responses).
   */
  const requestResponse = useCallback((): void => {
    if (responseActiveRef.current) {
      pendingResponseCreateRef.current = true;
      log.debug('Response in progress — deferring response.create until response.done');
      return;
    }
    sendEvent({ type: 'response.create' });
  }, [sendEvent, log]);

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
    setIsReady(true);
    setSessionState('listening');
    if (reconnectAttemptRef.current > 0) {
      log.info(`Reconnected after ${reconnectAttemptRef.current} attempt(s)`);
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      configRef.current.onReconnected?.();
    }
  }, [log]);

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
          onAudioStream: (stream) => setAudioStream(stream),
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
    [log, sendEvent]
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

      // Call custom event handler if provided
      onEvent?.(data);

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
          onSessionUpdated?.(data.session as Record<string, unknown>);

          if (isWebRtc) {
            // Readiness is driven by the peer connection + data channel state in WebRTC mode
            log.debug('Session configured (webrtc)');
            break;
          }
          log.debug('Session configured');

          if (data.session?.avatar?.ice_servers) {
            try {
              await connectAvatar(data.session.avatar.ice_servers);
            } catch (err) {
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
            try {
              await avatarRef.current.applyServerSdp(data.server_sdp);
              log.info('Avatar WebRTC established');
              announceReady();
            } catch (err) {
              log.error('Failed to apply avatar SDP:', err);
              setError(err instanceof Error ? err.message : 'Failed to apply avatar SDP');
            }
          }
          break;

        case 'response.created':
          responseActiveRef.current = true;
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

        case 'input_audio_buffer.speech_stopped':
          log.debug('User stopped speaking');
          setSessionState('thinking');
          break;

        case 'conversation.item.input_audio_transcription.delta':
          if (onTranscript && data.delta) {
            userTranscriptRef.current += data.delta;
            onTranscript('user', userTranscriptRef.current, false);
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          log.debug(`User said: "${data.transcript}"`);
          if (onTranscript && data.transcript) {
            onTranscript('user', data.transcript, true);
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
            onTranscript('assistant', assistantTranscriptRef.current, false);
          }
          break;

        case 'response.done':
          responseActiveRef.current = false;
          // Emit final assistant transcript if accumulated
          if (onTranscript && assistantTranscriptRef.current) {
            onTranscript('assistant', assistantTranscriptRef.current, true);
            assistantTranscriptRef.current = '';
          }
          setSessionState('listening');
          // A response.create requested while this response was running goes out now
          if (pendingResponseCreateRef.current) {
            pendingResponseCreateRef.current = false;
            log.debug('Sending deferred response.create');
            sendEvent({ type: 'response.create' });
          }
          break;

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
            onMcpApprovalRequest?.({
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
            Promise.resolve()
              .then(() => toolExecutor(name, args, callId))
              .then((result) => {
                if (result !== undefined) {
                  sendToolResult(callId, result);
                }
              })
              .catch((err) => {
                log.error(`toolExecutor failed for ${name}:`, err);
              });
          }
          break;

        case 'warning':
          log.warn('Service warning:', data.warning);
          onWarning?.(data.warning);
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
          setError(errorMessage);
          break;
        }

        default:
          break;
      }
    },
    [log, sendEvent, sendToolResult, buildSession, ensurePlayer, stopAudioPlayback, connectAvatar, announceReady]
  );
  handleServerEventRef.current = handleServerEvent;

  // ===== WebRTC microphone control =====

  const startRtcMic = useCallback(async (): Promise<void> => {
    const mic = micRef.current as WebRtcMicrophone;
    const track = await mic.start(configRef.current.audioConstraints);
    if (track && transportRef.current) {
      await transportRef.current.setMicrophoneTrack(track);
    }
    setRtcMicActive(true);
    log.debug('WebRTC microphone started');
  }, [log]);

  const stopRtcMic = useCallback((): void => {
    micRef.current?.stop();
    transportRef.current?.setMicrophoneTrack(null).catch(() => undefined);
    setRtcMicActive(false);
    log.debug('WebRTC microphone stopped');
  }, [log]);

  const toggleRtcMute = useCallback((): void => {
    const mic = micRef.current as WebRtcMicrophone;
    const next = !mic.isMuted;
    mic.setMuted(next);
    setRtcMuted(next);
  }, []);

  // Unified mic API (dispatches on transport)
  const startMic = transport === 'webrtc' ? startRtcMic : startWsMic;
  const stopMic = transport === 'webrtc' ? stopRtcMic : stopWsMic;
  const toggleMute = transport === 'webrtc' ? toggleRtcMute : toggleWsMute;
  const isMicActive = transport === 'webrtc' ? rtcMicActive : wsMicActive;
  const isMuted = transport === 'webrtc' ? rtcMuted : wsMuted;

  /**
   * Release the media/session objects of the current connection (transport, avatar, player,
   * audio graph). Used by disconnect() and between reconnect attempts (`keepAudio`).
   */
  const releaseConnection = useCallback((options: { keepAudio: boolean }): void => {
    transportRef.current?.close();
    transportRef.current = null;
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
    responseActiveRef.current = false;
    pendingResponseCreateRef.current = false;
    assistantTranscriptRef.current = '';
    userTranscriptRef.current = '';
  }, []);

  /**
   * Schedule a reconnect attempt after an unexpected close, or settle into
   * 'disconnected' / 'error' when reconnecting is off or exhausted.
   */
  const handleUnexpectedClose = useCallback(
    (connectId: number, info: TransportCloseInfo): void => {
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
        configRef.current.onReconnecting?.(attempt, delayMs);
        // Keep the AudioContext (created on the user's gesture) but drop everything else
        releaseConnection({ keepAudio: true });
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (connectIdRef.current !== connectId) return; // disconnect()/connect() happened meanwhile
          void openConnectionRef.current?.(connectId, 'reconnect');
        }, delayMs);
        return;
      }
      if (policy && reconnectAttemptRef.current > 0) {
        const message = `Connection lost — giving up after ${reconnectAttemptRef.current} reconnect attempt(s)`;
        log.error(message);
        setError(message);
        setConnectionState('error');
      } else {
        setConnectionState((state) => (state === 'error' ? state : 'disconnected'));
      }
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      releaseConnection({ keepAudio: false });
    },
    [log, releaseConnection]
  );

  /**
   * Create the transport for one connection attempt and wire its callbacks. Callbacks from a
   * stale generation or a transport that has been replaced are ignored.
   */
  const createTransport = useCallback(
    (kind: TransportKind, connectId: number): VoiceLiveTransport => {
      let created: VoiceLiveTransport | null = null;
      const isStale = (): boolean => connectIdRef.current !== connectId || transportRef.current !== created;

      const callbacks: TransportCallbacks = {
        onOpen: () => {
          if (isStale()) return;
          log.info(kind === 'webrtc' ? 'Control channel connected' : 'WebSocket connected');
          setConnectionState('connected');
          const graph = ensureGraph();
          if (kind === 'websocket' && !configRef.current.session?.avatar) {
            // Voice-only WebSocket mode: expose played audio as a MediaStream
            const stream = graph.ensureDestination();
            if (stream) setAudioStream(stream);
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
          transportRef.current = null; // already closed — releaseConnection() must not close it again
          handleUnexpectedClose(connectId, info);
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

      created =
        kind === 'webrtc'
          ? new WebRtcTransport(callbacks, {
              rtcConfiguration: configRef.current.connection.rtcConfiguration,
              log,
            })
          : new WebSocketTransport(callbacks, { log });
      return created;
    },
    [log, ensureGraph, announceReady, handleUnexpectedClose]
  );

  /**
   * Open a connection for the given generation (initial connect or reconnect attempt)
   */
  const openConnection = useCallback(
    async (connectId: number, mode: 'initial' | 'reconnect'): Promise<void> => {
      const { connection: currentConnection, session: currentSession } = configRef.current;
      const kind: TransportKind = currentConnection.transport ?? 'websocket';

      try {
        setError(null);
        setConnectionState(mode === 'initial' ? 'connecting' : 'reconnecting');

        // Fresh token per attempt when a provider is configured
        const token = currentConnection.getToken ? await currentConnection.getToken() : currentConnection.token;
        if (connectIdRef.current !== connectId) return; // disconnected while acquiring the token
        const resolvedConnection = token ? { ...currentConnection, token } : currentConnection;

        const { url, isAgentMode, modeLabel } = buildVoiceLiveUrl(resolvedConnection);
        isAgentModeRef.current = isAgentMode;
        transportKindRef.current = kind;

        log.info(`${mode === 'reconnect' ? 'Reconnecting' : 'Connecting'} (${modeLabel}, ${kind}) → ${redactUrl(url)}`);
        if (mode === 'initial') {
          validateConfig(currentSession ?? {}, isAgentMode, currentConnection.model).forEach((warning) =>
            log.warn(warning)
          );
        }
        if (kind === 'webrtc') {
          validateTransport(resolvedConnection, currentSession);
        }

        // Replace whatever transport is left from a previous attempt (silently)
        transportRef.current?.close();
        const nextTransport = createTransport(kind, connectId);
        transportRef.current = nextTransport;
        nextTransport.connect(url, kind === 'webrtc' ? buildSession(currentSession) : {}, {
          // WebRTC: keep sending the microphone that was started before connect()/reconnect
          localTrack: kind === 'webrtc' ? micRef.current?.track ?? null : undefined,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to connect';
        log.error('Connection error:', err);
        setError(errorMessage);
        setConnectionState('error');
      }
    },
    [log, buildSession, createTransport]
  );
  openConnectionRef.current = openConnection;

  /**
   * Connect to Voice Live API
   */
  const connect = useCallback(async (): Promise<void> => {
    // Idempotent: a second call while a transport is connecting/open is a no-op
    const active = transportRef.current;
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

    const connectId = ++connectIdRef.current;
    await openConnection(connectId, 'initial');
  }, [log, openConnection]);

  /**
   * Disconnect from Voice Live API
   */
  const disconnect = useCallback((): void => {
    log.info('Disconnecting...');
    connectIdRef.current++;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptRef.current = 0;
    greetingSentRef.current = false;

    // Stop microphone capture (both transports)
    stopWsMic();
    micRef.current?.stop();
    micRef.current?.setMuted(false);
    setRtcMicActive(false);
    setRtcMuted(false);

    releaseConnection({ keepAudio: false });

    setSessionExpiresAt(null);
    setReconnectAttempt(0);
    setIsReady(false);
    setSessionState('idle');
    setConnectionState('disconnected');
  }, [stopWsMic, releaseConnection, log]);

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
    buildGreetingEvents(session.greeting).forEach((event) => sendEvent(event));
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
    approveMcpCall,
    getAudioPlaybackTime,
  };
}
