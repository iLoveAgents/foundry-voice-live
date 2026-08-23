/**
 * Types shared by the pure mapper core.
 *
 * Nothing in `core/` imports React, rxjs or the DOM. Voice Live types are imported type-only, so
 * this directory runs in bare Node — which is what makes it unit-testable without a browser.
 */

import type { BaseEvent } from '@ag-ui/core';
import type {
  ConnectionState,
  SessionState,
  VoiceLiveClientEvent,
  VoiceLiveServerEvent,
} from '@iloveagents/foundry-voice-live-react';

export type { BaseEvent, VoiceLiveClientEvent, VoiceLiveServerEvent };

/** Why a run was closed */
export type RunClosedReason =
  | 'response_done'
  | 'cancelled'
  | 'error'
  | 'interrupted'
  | 'idle'
  | 'session_end';

/**
 * What one call into the mapper produced.
 *
 * Events are returned rather than emitted through callbacks so the ordering is explicit and a test
 * can assert on the exact sequence. `runOpened` / `runClosed` are the signals the run pump uses to
 * start and finish AG-UI runs; they are *also* reflected in `events` as RUN_STARTED / RUN_FINISHED.
 */
export interface MapperOutput {
  events: BaseEvent[];
  runOpened?: { runId: string };
  runClosed?: { runId: string; reason: RunClosedReason };
}

/**
 * Facts the wire does not carry. The React glue feeds these from hook state and from its own
 * write side (Voice Live never echoes a `function_call_output`, so a tool result must come from
 * whoever sent it).
 */
export type HostEvent =
  | { type: 'connection_state'; state: ConnectionState }
  | { type: 'ready' }
  | { type: 'mic'; active: boolean; muted: boolean }
  | { type: 'tool_result'; callId: string; output: unknown }
  | { type: 'tool_error'; callId: string; error: string }
  | { type: 'reconnecting'; attempt: number; delayMs: number }
  | { type: 'reconnected' }
  | { type: 'disconnected' };

/** The voice-specific state published through STATE_SNAPSHOT / STATE_DELTA under `state.voice` */
export interface VoiceState {
  connectionState: ConnectionState;
  sessionState: SessionState;
  isReady: boolean;
  isMicActive: boolean;
  isMuted: boolean;
  transport: 'websocket' | 'webrtc';
  /** Epoch ms, from `session.created` / `session.updated` */
  sessionExpiresAt: number | null;
  /** Service-side model or BYOM deployment, as echoed in `session.*` */
  model: string | null;
  currentResponseId: string | null;
  avatar: { connected: boolean; speaking: boolean };
  /** Accumulated across responses */
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  lastError: { message: string; code?: string } | null;
}

export interface VoiceLiveAguiMapperOptions {
  threadId: string;
  /** Injected so tests are deterministic */
  generateId?: () => string;
  /** Injected clock (ms) for the idle watchdog */
  now?: () => number;
  /** Forward unmodelled Voice Live events as AG-UI `RAW` (high-rate media events are always dropped) */
  passthroughRaw?: boolean;
  /** Force-close a run that sees no activity for this long (a dropped `response.done`) */
  runIdleTimeoutMs?: number;
  /** Initial transport, reflected in state until the host reports otherwise */
  transport?: 'websocket' | 'webrtc';
}

/** Read-only view of the mapper's internal state, for diagnostics and tests */
export interface MapperSnapshot {
  runId: string | null;
  /** `item_id` of the assistant or user message currently open, if any */
  openMessageId: string | null;
  openToolCallIds: string[];
  /** Tool calls the current response declared but whose events have not arrived yet */
  clusterOwesCalls: boolean;
  state: VoiceState;
}
