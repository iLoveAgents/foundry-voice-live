/**
 * Server event parsing shared by the transports.
 */

import type { VoiceLiveServerEvent } from '../types/events';

/**
 * Parse a raw control-channel / data-channel message. Returns null for non-JSON payloads
 * or JSON that is not an object with a string `type`.
 */
export function parseServerEvent(raw: string): VoiceLiveServerEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  if (typeof (parsed as { type?: unknown }).type !== 'string') return null;
  return parsed as VoiceLiveServerEvent;
}

/**
 * Bounded set of seen `event_id`s used to drop events the WebRTC service delivers on both the
 * control channel and the data channel.
 */
export class SeenEventIds {
  private readonly ids = new Set<string>();

  constructor(private readonly maxSize: number = 500) {}

  /** Whether `id` is currently remembered, without recording it */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** Returns true when `id` was already seen (and records it otherwise) */
  seenBefore(id: string): boolean {
    if (this.ids.has(id)) return true;
    this.ids.add(id);
    if (this.ids.size > this.maxSize) {
      // Drop the oldest half (Set iterates in insertion order)
      const iterator = this.ids.values();
      for (let i = 0; i < this.maxSize / 2; i++) {
        const next = iterator.next();
        if (next.done) break;
        this.ids.delete(next.value);
      }
    }
    return false;
  }

  get size(): number {
    return this.ids.size;
  }

  clear(): void {
    this.ids.clear();
  }
}
