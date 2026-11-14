/**
 * The doctor's job is to be right about a backend the developer cannot see into. These tests drive
 * it with synthetic SSE streams — a clean streaming answer, a single-block answer, keepalive
 * comments, a wrong content-type, and an illegal stream — and pin the verdict for each.
 */

import { describe, it, expect } from 'vitest';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import { probeEndpoint } from './probe';

let idCounter = 0;
const genId = (): string => `id-${++idCounter}`;

/** Build a fetch that replays the given SSE records for every request. */
function fetchReturning(
  records: string[],
  init: { contentType?: string; status?: number } = {}
): typeof fetch {
  return (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          for (const r of records) controller.enqueue(enc.encode(r));
          controller.close();
        },
      }),
      {
        status: init.status ?? 200,
        headers: { 'content-type': init.contentType ?? 'text/event-stream' },
      }
    )) as unknown as typeof fetch;
}

const rec = (ev: BaseEvent): string => `data: ${JSON.stringify(ev)}\n\n`;

function streamingAnswer(deltas: string[]): string[] {
  const runId = 'r1';
  const messageId = 'm1';
  const out: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId: 't', runId } as unknown as BaseEvent,
    { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as unknown as BaseEvent,
    ...deltas.map(
      (d) => ({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: d }) as unknown as BaseEvent
    ),
    { type: EventType.TEXT_MESSAGE_END, messageId } as unknown as BaseEvent,
    { type: EventType.RUN_FINISHED, threadId: 't', runId } as unknown as BaseEvent,
  ];
  return out.map(rec);
}

describe('probeEndpoint', () => {
  it('rates a fast, multi-delta streaming backend READY', async () => {
    const report = await probeEndpoint({
      url: 'https://x/agui',
      fetchImpl: fetchReturning(streamingAnswer(['Hello ', 'there, ', 'friend.'])),
      checkContinuity: false,
      generateId: genId,
    });
    expect(report.ok).toBe(true);
    expect(report.features.textStreaming).toBe(true);
    expect(report.voiceReadiness.verdict).toBe('ready');
    expect(report.voiceReadiness.chunkableDeltas).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('rates a single-block answer USABLE, not READY', async () => {
    const report = await probeEndpoint({
      url: 'https://x/agui',
      fetchImpl: fetchReturning(streamingAnswer(['The whole answer in one shot.'])),
      checkContinuity: false,
      generateId: genId,
    });
    expect(report.ok).toBe(true);
    expect(report.voiceReadiness.verdict).toBe('usable');
    expect(report.voiceReadiness.chunkableDeltas).toBe(false);
    expect(report.voiceReadiness.reasons.join(' ')).toContain('single block');
  });

  it('counts SSE keepalive comments', async () => {
    const records = [': keepalive\n\n', ...streamingAnswer(['Hi.']), ': ping\n\n'];
    const report = await probeEndpoint({
      url: 'https://x/agui',
      fetchImpl: fetchReturning(records),
      checkContinuity: false,
      generateId: genId,
    });
    expect(report.features.keepalives).toBe(true);
    expect(report.runs[0]!.keepalives).toBe(2);
  });

  it('flags an illegal stream (content before RUN_STARTED) as UNFIT and names the event', async () => {
    const bad = [
      rec({
        type: EventType.TEXT_MESSAGE_START,
        messageId: 'm',
        role: 'assistant',
      } as unknown as BaseEvent),
      rec({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm',
        delta: 'oops',
      } as unknown as BaseEvent),
    ];
    const report = await probeEndpoint({
      url: 'https://x/agui',
      fetchImpl: fetchReturning(bad),
      checkContinuity: false,
      generateId: genId,
    });
    expect(report.ok).toBe(false);
    expect(report.voiceReadiness.verdict).toBe('unfit');
    // The doctor names the offending event, so a developer knows exactly what broke the rule.
    expect(report.errors.join(' ')).toContain('TEXT_MESSAGE_START');
    expect(report.errors.join(' ')).toContain('outside any run');
  });

  it('reports a wrong content-type as a transport error, not a verify error', async () => {
    const report = await probeEndpoint({
      url: 'https://x/agui',
      fetchImpl: fetchReturning(['{"not":"sse"}'], { contentType: 'application/json' }),
      checkContinuity: false,
      generateId: genId,
    });
    expect(report.ok).toBe(false);
    expect(report.errors.join(' ')).toContain('text/event-stream');
    expect(report.voiceReadiness.verdict).toBe('unfit');
  });

  it('does not count a user-role echo as assistant output', async () => {
    // A backend that only echoes the prompt as a user message produced no answer.
    const runId = 'r1';
    const echo = [
      { type: EventType.RUN_STARTED, threadId: 't', runId },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'u1', role: 'user' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'u1', delta: 'the prompt echoed back' },
      { type: EventType.TEXT_MESSAGE_END, messageId: 'u1' },
      { type: EventType.RUN_FINISHED, threadId: 't', runId },
    ].map((e) => rec(e as unknown as BaseEvent));
    const report = await probeEndpoint({
      url: 'https://x/agui',
      fetchImpl: fetchReturning(echo),
      checkContinuity: false,
      generateId: genId,
    });
    expect(report.features.textStreaming).toBe(false);
    expect(report.voiceReadiness.answerCharCount).toBe(0);
    expect(report.voiceReadiness.verdict).toBe('unfit');
  });

  it('reports thread continuity when a second parentRunId run also streams cleanly', async () => {
    const report = await probeEndpoint({
      url: 'https://x/agui',
      fetchImpl: fetchReturning(streamingAnswer(['Sure.', ' Done.'])),
      checkContinuity: true,
      generateId: genId,
    });
    expect(report.features.threadContinuity).toBe(true);
    expect(report.runs).toHaveLength(2);
  });
});
