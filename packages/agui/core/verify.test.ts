/**
 * Direct tests for the AG-UI ordering verifier. The mapper tests exercise it indirectly; these pin
 * the termination rule specifically: a completed run must end with a terminal event, but a stream
 * that ends mid-turn (the trailing run is still in flight) is legal.
 */

import { describe, it, expect } from 'vitest';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import { verifyRun, verifyStream } from './verify';

const ev = (type: EventType, extra: Record<string, unknown> = {}): BaseEvent =>
  ({ type, ...extra }) as unknown as BaseEvent;

const started = ev(EventType.RUN_STARTED, { runId: 'r' });
const finished = ev(EventType.RUN_FINISHED, { runId: 'r' });
const msgStart = ev(EventType.TEXT_MESSAGE_START, { messageId: 'm' });
const msgContent = ev(EventType.TEXT_MESSAGE_CONTENT, { messageId: 'm', delta: 'hi' });
const msgEnd = ev(EventType.TEXT_MESSAGE_END, { messageId: 'm' });

describe('verifyRun / verifyStream', () => {
  it('accepts a complete run', () => {
    expect(() => verifyRun([started, msgStart, msgContent, msgEnd, finished])).not.toThrow();
  });

  it('throws when a run never terminates (default requires a terminal event)', () => {
    expect(() => verifyRun([started, msgStart, msgContent, msgEnd])).toThrow(/did not terminate/);
  });

  it('allows an unterminated run when requireTerminal is false', () => {
    expect(() =>
      verifyRun([started, msgStart, msgContent], { requireTerminal: false })
    ).not.toThrow();
  });

  it('names RUN_ERROR as a legal first event in the message', () => {
    expect(() => verifyRun([msgStart])).toThrow(/RUN_STARTED or RUN_ERROR/);
  });

  it('catches a run that did not close before the next one opened', () => {
    // two runs back to back, the first missing its terminal → illegal
    expect(() =>
      verifyStream([
        started,
        msgStart,
        msgEnd,
        ev(EventType.RUN_STARTED, { runId: 'r2' }),
        finished,
      ])
    ).toThrow(/did not terminate/);
  });

  it('tolerates a trailing run still in flight (stream ended mid-turn)', () => {
    expect(() => verifyStream([started, msgStart, msgContent])).not.toThrow();
  });
});
