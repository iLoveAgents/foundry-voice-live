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
 * Close codes that say *this request* is unacceptable, so reconnecting with the same URL and
 * credentials would fail identically. Retrying them only delays the error the caller must see.
 *
 * - `1003` unsupported data
 * - `1008` policy violation — the proxy closes with this when the connection parameters are
 *   invalid, and services use it for authorization failures
 * - `1010` a required extension was refused
 */
const FATAL_CLOSE_CODES = new Set([1003, 1008, 1010]);

/**
 * Whether a control-channel close should trigger a reconnect attempt: anything that was not
 * a clean, normal closure (network drops, 1006 abnormal closure, server restarts, timeouts) and
 * not a rejection of the request itself.
 */
export function isReconnectableClose(info: TransportCloseInfo): boolean {
  if (info.wasClean && NORMAL_CLOSE_CODES.has(info.code)) return false;
  if (FATAL_CLOSE_CODES.has(info.code)) return false;
  return true;
}
