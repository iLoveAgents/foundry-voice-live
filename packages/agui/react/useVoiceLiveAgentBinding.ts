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
import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';
import type {
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

  const onEvent = useCallback(
    (event: VoiceLiveServerEvent) => {
      configRef.current.onEvent?.(event);
      const { runOpened } = agent.ingestServerEvent(event);
      if (runOpened) void agent.pump();
    },
    [agent]
  );

  const onReconnecting = useCallback(
    (attempt: number, delayMs: number) => {
      configRef.current.onReconnecting?.(attempt, delayMs);
      agent.ingestHostEvent({ type: 'reconnecting', attempt, delayMs });
    },
    [agent]
  );

  const onReconnected = useCallback(() => {
    configRef.current.onReconnected?.();
    agent.ingestHostEvent({ type: 'reconnected' });
  }, [agent]);

  const voice = useVoiceLive({ ...config, onEvent, onReconnecting, onReconnected });

  // Wire the write side once the session controls exist (and whenever their identity changes).
  useEffect(() => {
    agent.attachBridge({ sendEvent: voice.sendEvent, cancelResponse: voice.cancelResponse });
  }, [agent, voice.sendEvent, voice.cancelResponse]);

  // Reflect connection state; a drop to 'disconnected' also closes any orphaned run.
  useEffect(() => {
    agent.ingestHostEvent({ type: 'connection_state', state: voice.connectionState });
    if (voice.connectionState === 'disconnected') {
      agent.ingestHostEvent({ type: 'disconnected' });
    }
  }, [agent, voice.connectionState]);

  useEffect(() => {
    if (voice.isReady) agent.ingestHostEvent({ type: 'ready' });
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

  return voice;
}
