/**
 * `useVoiceLiveAgentBinding` — run a Voice Live session and stream it into a `VoiceLiveAgent`.
 *
 * This owns the `useVoiceLive` call so it can inject the one callback that matters — `onEvent` —
 * and turn every server event into AG-UI. When the mapper opens a run, it pumps the agent so
 * `runAgent()` fires and CopilotKit sees the turn. It also:
 *   - attaches the write side (`sendEvent`, `cancelResponse`) so typed turns and barge-in reach the wire,
 *   - reflects readiness / mic / connection state into `agent.state.voice` between turns, and
 *   - runs an idle watchdog that closes a run orphaned by a dropped connection.
 *
 * It returns the full `UseVoiceLiveReturn`, so the component keeps every control it would have had
 * calling `useVoiceLive` directly (connect, mute, disconnect, audio stream, …).
 *
 * Memoize `config.connection` (and `config.session`) in the caller: `useVoiceLive` re-establishes
 * the session when they change identity, exactly as it would without this binding.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useVoiceLive, Scope } from '@iloveagents/foundry-voice-live-react';
import type {
  ToolResult,
  UseVoiceLiveConfig,
  UseVoiceLiveReturn,
  VoiceLiveServerEvent,
} from '@iloveagents/foundry-voice-live-react';
import type { VoiceLiveAgent } from '../agent';

export interface UseVoiceLiveAgentBindingOptions {
  /** Idle-watchdog interval, ms; closes a run orphaned by a dropped connection. Default 15000. */
  idleTickMs?: number;
}

export function useVoiceLiveAgentBinding(
  agent: VoiceLiveAgent,
  config: UseVoiceLiveConfig,
  options: UseVoiceLiveAgentBindingOptions = {}
): UseVoiceLiveReturn {
  // Hold the caller's latest callbacks in a ref so the wrapped callbacks stay referentially stable
  // and never re-establish the session, yet always dispatch to the current handler.
  const configRef = useRef(config);
  configRef.current = config;

  // The bridge's canSend() reads the live connection state through this ref (the bridge object is
  // attached once and must not go stale). prevConnectionRef gates the one-time mount 'disconnected'.
  const connectionStateRef = useRef<UseVoiceLiveReturn['connectionState']>('disconnected');
  const readyRef = useRef(false);
  const sessionScopeRef = useRef<Scope | null>(null);
  const prevConnectionRef = useRef<UseVoiceLiveReturn['connectionState'] | null>(null);

  const onEvent = useCallback(
    (event: VoiceLiveServerEvent) => {
      // Ingest first, and never let a throwing consumer callback strand the bridge: useVoiceLive
      // catches exceptions around this wrapper, so if the caller's onEvent threw before we ingested,
      // the run would hang until the idle watchdog. Ingest is guaranteed; the callback is guarded.
      if (event.type === 'session.created') {
        sessionScopeRef.current?.abort();
        sessionScopeRef.current = new Scope('agui-session');
      }
      const { runOpened } = agent.ingestServerEvent(event);
      if (runOpened) void agent.pump();
      try {
        configRef.current.onEvent?.(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[useVoiceLiveAgentBinding] consumer onEvent threw:', err);
      }
    },
    [agent]
  );

  // Forward tool outputs the app produces into the agent as `tool_result`/`tool_error`, so the
  // mapper can emit TOOL_CALL_RESULT and close the tool cluster (Voice Live never echoes the output).
  const toolExecutor = useCallback(
    async (name: string, args: string, callId: string): Promise<void | ToolResult> => {
      const original = configRef.current.toolExecutor;
      const scope = sessionScopeRef.current;
      try {
        const result = original ? await original(name, args, callId) : undefined;
        // A returned result is auto-sent by useVoiceLive; mirror it to the agent. `undefined` means
        // the app will send it later via sendToolResult (wrapped below), so don't forward here.
        if (result !== undefined && scope?.isActive)
          agent.ingestHostEvent({ type: 'tool_result', callId, output: result });
        return result;
      } catch (err) {
        if (scope?.isActive)
          agent.ingestHostEvent({
            type: 'tool_error',
            callId,
            error: err instanceof Error ? err.message : String(err),
          });
        throw err;
      }
    },
    [agent]
  );

  const onReconnecting = useCallback(
    (attempt: number, delayMs: number) => {
      sessionScopeRef.current?.abort();
      readyRef.current = false;
      agent.ingestHostEvent({ type: 'reconnecting', attempt, delayMs });
      configRef.current.onReconnecting?.(attempt, delayMs);
    },
    [agent]
  );

  const onReconnected = useCallback(() => {
    agent.ingestHostEvent({ type: 'reconnected' });
    configRef.current.onReconnected?.();
  }, [agent]);

  const voice = useVoiceLive({
    ...config,
    onEvent,
    onReconnecting,
    onReconnected,
    // Only wrap when the caller actually provided an executor — passing one otherwise would change
    // how useVoiceLive treats tool calls.
    ...(config.toolExecutor ? { toolExecutor } : {}),
  });

  connectionStateRef.current = voice.connectionState;
  readyRef.current = voice.isReady;

  // Wire the write side once the session controls exist (and whenever their identity changes).
  // canSend() reflects the live connection so a typed turn while disconnected is rejected, not dropped.
  useEffect(() => {
    agent.attachBridge({
      sendEvent: voice.sendEvent,
      cancelResponse: voice.cancelResponse,
      canSend: () => connectionStateRef.current === 'connected' && readyRef.current,
    });
  }, [agent, voice.sendEvent, voice.cancelResponse]);

  // Reflect connection state. Only forward 'disconnected' on a real transition *away from* a live
  // state — never for the initial mount value, which would close the mapper before it ever connected.
  useEffect(() => {
    agent.ingestHostEvent({ type: 'connection_state', state: voice.connectionState });
    const prev = prevConnectionRef.current;
    if (voice.connectionState !== 'connected') sessionScopeRef.current?.abort();
    if (
      (voice.connectionState === 'disconnected' || voice.connectionState === 'error') &&
      prev !== null &&
      prev !== 'disconnected'
    ) {
      agent.ingestHostEvent({ type: 'disconnected' });
    }
    prevConnectionRef.current = voice.connectionState;
  }, [agent, voice.connectionState]);

  // Advertise the active transport in voice state (the agent's initial value can be stale, e.g. a
  // default-websocket agent bound to a webrtc session).
  useEffect(() => {
    agent.ingestHostEvent({ type: 'transport', transport: voice.transport });
  }, [agent, voice.transport]);

  // Readiness both ways: an auto-reconnect can drop `isReady` back to false without a full
  // disconnect, and consumers must not re-enable input while the replacement session is not ready.
  useEffect(() => {
    agent.ingestHostEvent({ type: 'ready', ready: voice.isReady });
  }, [agent, voice.isReady]);

  useEffect(() => {
    agent.ingestHostEvent({ type: 'mic', active: voice.isMicActive, muted: voice.isMuted });
  }, [agent, voice.isMicActive, voice.isMuted]);

  // Idle watchdog: a run whose closing event never arrived (dropped socket) is force-closed.
  useEffect(() => {
    const ms = options.idleTickMs ?? 15000;
    const id = setInterval(() => {
      const { runOpened } = agent.tick(Date.now());
      if (runOpened) void agent.pump();
    }, ms);
    return () => clearInterval(id);
  }, [agent, options.idleTickMs]);

  // Wrap sendToolResult so a deferred tool output (the app sends it itself, rather than returning it
  // from the executor) also reaches the agent as a tool_result. Together with the executor wrapper,
  // exactly one path forwards each result, so the tool cluster always closes.
  const sendToolResult = useCallback<UseVoiceLiveReturn['sendToolResult']>(
    (callId, output, opts) => {
      agent.ingestHostEvent({ type: 'tool_result', callId, output });
      voice.sendToolResult(callId, output, opts);
    },
    [agent, voice.sendToolResult]
  );

  const disconnect = useCallback((): void => {
    sessionScopeRef.current?.abort();
    readyRef.current = false;
    agent.ingestHostEvent({ type: 'disconnected' });
    voice.disconnect();
  }, [agent, voice.disconnect]);

  useEffect(
    () => () => {
      sessionScopeRef.current?.abort();
      readyRef.current = false;
      agent.detachBridge();
      agent.ingestHostEvent({ type: 'disconnected' });
    },
    [agent]
  );

  return { ...voice, sendToolResult, disconnect };
}
