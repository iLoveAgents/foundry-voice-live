/**
 * The `state.voice` object and the JSON-Patch deltas that keep it in sync.
 *
 * AG-UI's `STATE_DELTA` carries RFC 6902 patches. Every change to the voice state goes through
 * `patchVoiceState`, which returns the patch operations *and* the next state, so the mapper never
 * mutates and a test can replay the patches with any JSON-Patch library and compare.
 */

import type { VoiceState } from './types';

/** A single RFC 6902 operation (the subset the bridge emits) */
export interface JsonPatchOp {
  op: 'replace' | 'add';
  path: string;
  value: unknown;
}

export function initialVoiceState(transport: 'websocket' | 'webrtc' = 'websocket'): VoiceState {
  return {
    connectionState: 'disconnected',
    sessionState: 'idle',
    isReady: false,
    isMicActive: false,
    isMuted: false,
    transport,
    sessionExpiresAt: null,
    model: null,
    currentResponseId: null,
    avatar: { connected: false, speaking: false },
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastError: null,
  };
}

/** Escape a key for a JSON Pointer segment */
function pointerSegment(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Compute the patch that turns `prev` into `prev` with `changes` applied, one operation per
 * top-level key that actually changed. Nested objects (`avatar`, `usage`) are replaced whole —
 * they are tiny, and a whole-object replace is simpler to reason about than deep diffs.
 */
export function patchVoiceState(
  prev: VoiceState,
  changes: Partial<VoiceState>
): { next: VoiceState; ops: JsonPatchOp[] } {
  const ops: JsonPatchOp[] = [];
  const next: VoiceState = { ...prev };
  for (const key of Object.keys(changes) as (keyof VoiceState)[]) {
    const value = changes[key];
    if (value === undefined) continue;
    if (JSON.stringify(prev[key]) === JSON.stringify(value)) continue;
    (next as unknown as Record<string, unknown>)[key] = value;
    ops.push({ op: 'replace', path: `/voice/${pointerSegment(key)}`, value });
  }
  return { next, ops };
}

/** The full AG-UI state object the bridge publishes (`{ voice: … }`) */
export function toAguiState(state: VoiceState): { voice: VoiceState } {
  return { voice: state };
}
