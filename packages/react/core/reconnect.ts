/**
 * Auto-reconnect policy (pure): exponential backoff with jitter and a close-code filter.
 */

import type { ReconnectOptions } from '../types/voiceLive';
import type { TransportCloseInfo } from './transports/types';

export type { ReconnectOptions };

export const DEFAULT_RECONNECT_OPTIONS: ReconnectOptions = {
  maxAttempts: 5,
  initialDelayMs: 500,
  maxDelayMs: 8000,
  jitter: 0.2,
};

/**
 * Normalize the `reconnect` hook option: `undefined`/`false` → disabled (null),
 * `true` → defaults, object → defaults overridden.
 */
export function resolveReconnectOptions(
  input: boolean | Partial<ReconnectOptions> | undefined
): ReconnectOptions | null {
  if (!input) return null;
  if (input === true) return { ...DEFAULT_RECONNECT_OPTIONS };
  return { ...DEFAULT_RECONNECT_OPTIONS, ...input };
}

/**
 * Delay for the given attempt (1-based): `initialDelayMs * 2^(attempt-1)`, capped at
 * `maxDelayMs`, ± `jitter`.
 */
export function computeBackoffDelay(
  attempt: number,
  options: ReconnectOptions,
  random: () => number = Math.random
): number {
  const exponential = options.initialDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(options.maxDelayMs, exponential);
  const spread = capped * options.jitter;
  const jittered = capped + (random() * 2 - 1) * spread;
  return Math.max(0, Math.round(jittered));
}

/**
 * Close codes that indicate a normal, intentional end of the session.
 *
 * `1001 Going Away` is deliberately **not** in this set: on a client it means "navigating away",
 * but we never observe our own — `disconnect()` detaches the transport callbacks first — so a 1001
 * that reaches us came from the service shutting down or restarting, which is exactly what the
 * reconnect policy is for.
 */
const NORMAL_CLOSE_CODES = new Set([1000]);

/**
 * Whether a control-channel close should trigger a reconnect attempt: anything that was not
 * a clean, normal closure (network drops, 1006 abnormal closure, server restarts, timeouts).
 */
export function isReconnectableClose(info: TransportCloseInfo): boolean {
  if (info.wasClean && NORMAL_CLOSE_CODES.has(info.code)) return false;
  return true;
}
