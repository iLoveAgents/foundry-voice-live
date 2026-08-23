/**
 * `VoiceLiveAgent` drives `AbstractAgent` from a live voice session. These tests pin the two
 * behaviours that are easy to get wrong:
 *
 *  1. A voice turn that opens *and closes* before the pump's `runAgent()` subscribes is still
 *     delivered in full (the ReplaySubject-per-run guarantee). Miss this and the first short answer
 *     of a session silently vanishes.
 *  2. A typed turn forwards to the wire and does **not** duplicate the user's bubble — CopilotKit
 *     already added it, exactly as `HttpAgent` assumes.
 */

import { describe, it, expect } from 'vitest';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import { VoiceLiveAgent } from './VoiceLiveAgent';
import { verifyStream } from '../core/verify';
import type { VoiceLiveServerEvent } from '../core/types';

const assistantTurn = (text: string, responseId = 'r1', itemId = 'a1'): VoiceLiveServerEvent[] =>
  [
    { type: 'response.created', response: { id: responseId } },
    {
      type: 'response.audio_transcript.delta',
      response_id: responseId,
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: text,
    },
    {
      type: 'response.audio_transcript.done',
      response_id: responseId,
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      transcript: text,
    },
    { type: 'response.done', response: { id: responseId, status: 'completed', output: [] } },
  ] as unknown as VoiceLiveServerEvent[];

const assistantText = (agent: VoiceLiveAgent): string =>
  agent.messages
    .filter((m) => m.role === 'assistant')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join('');

describe('VoiceLiveAgent', () => {
  it('delivers a voice turn whose run opened and closed before the pump subscribed (the race)', async () => {
    const agent = new VoiceLiveAgent({ threadId: 't1', generateId: seq() });
    const seen: BaseEvent[] = [];
    agent.events$.subscribe((e) => seen.push(e));

    // Ingest the *entire* turn before pumping — the run is already closed when runAgent() subscribes.
    for (const ev of assistantTurn('Hello there.')) agent.ingestServerEvent(ev);
    expect(agent.hasOpenRun).toBe(false);
    expect(agent.pendingRunCount).toBe(1);

    await agent.pump();

    expect(assistantText(agent)).toBe('Hello there.');
    expect(agent.pendingRunCount).toBe(0);
    // The side channel saw a well-formed run.
    expect(seen.map((e) => e.type)).toContain(EventType.RUN_STARTED);
    expect(seen.map((e) => e.type)).toContain(EventType.RUN_FINISHED);
  });

  it('delivers a voice turn that streams in while the pump is already subscribed', async () => {
    const agent = new VoiceLiveAgent({ threadId: 't2', generateId: seq() });
    const events = assistantTurn('Streaming answer.');

    // Open the run, start the pump (subscribes and waits live), then stream the rest.
    agent.ingestServerEvent(events[0]!);
    const pumped = agent.pump();
    for (const ev of events.slice(1)) agent.ingestServerEvent(ev);
    await pumped;

    expect(assistantText(agent)).toBe('Streaming answer.');
  });

  it('accumulates messages across consecutive voice turns', async () => {
    const agent = new VoiceLiveAgent({ threadId: 't3', generateId: seq() });
    for (const ev of assistantTurn('First.', 'r1', 'a1')) agent.ingestServerEvent(ev);
    await agent.pump();
    for (const ev of assistantTurn('Second.', 'r2', 'a2')) agent.ingestServerEvent(ev);
    await agent.pump();

    expect(agent.messages.filter((m) => m.role === 'assistant')).toHaveLength(2);
    expect(assistantText(agent)).toBe('First.Second.');
  });

  it('forwards a typed turn to the wire without duplicating the user bubble', async () => {
    const agent = new VoiceLiveAgent({ threadId: 't4', generateId: seq() });
    const sent: unknown[] = [];
    agent.attachBridge({ sendEvent: (e) => sent.push(e), cancelResponse: () => {} });

    // CopilotKit adds the user message, then calls runAgent().
    agent.addMessage({ id: 'u1', role: 'user', content: 'what time is it' });
    const run = agent.runAgent();
    await tick(); // runAgent() calls run() on a microtask; let it forward to the wire
    // The wire got item.create + response.create.
    expect(sent.map((e) => (e as { type: string }).type)).toEqual([
      'conversation.item.create',
      'response.create',
    ]);
    // The service answers.
    for (const ev of assistantTurn('It is noon.', 'r1', 'a1')) agent.ingestServerEvent(ev);
    await run;

    const users = agent.messages.filter((m) => m.role === 'user');
    expect(users).toHaveLength(1); // not duplicated by the run echo
    expect(users[0]!.content).toBe('what time is it');
    expect(assistantText(agent)).toBe('It is noon.');
  });

  it('errors a typed turn cleanly when no voice session is connected', async () => {
    const agent = new VoiceLiveAgent({ threadId: 't5', generateId: seq() });
    agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
    const errors: BaseEvent[] = [];
    agent.events$.subscribe((e) => {
      if ((e as { type: EventType }).type === EventType.RUN_ERROR) errors.push(e);
    });
    await agent.runAgent().catch(() => {});
    expect(errors).toHaveLength(1);
  });

  it('routes a typed runAgent() to the wire even while a voice run is queued (not the pump)', async () => {
    // Regression: the pump used to flag its runs with a long-lived boolean, so a composer
    // runAgent() during a voice turn was misread as the pump and never forwarded to the wire.
    // Now the pump marks its own invocation, so an un-marked runAgent() is always a typed turn.
    const agent = new VoiceLiveAgent({ threadId: 't7', generateId: seq() });
    const sent: unknown[] = [];
    agent.attachBridge({ sendEvent: (e) => sent.push(e), cancelResponse: () => {} });

    // A server run is queued but not yet pumped.
    agent.ingestServerEvent(assistantTurn('voice', 'rv', 'av')[0]!);
    expect(agent.pendingRunCount).toBe(1);

    // A typed turn arrives directly (no pump marker) → it must forward to the wire...
    agent.addMessage({ id: 'u1', role: 'user', content: 'typed while speaking' });
    void agent.runAgent();
    await tick();
    expect(sent.map((e) => (e as { type: string }).type)).toEqual([
      'conversation.item.create',
      'response.create',
    ]);
    // ...and must NOT have consumed the queued voice run.
    expect(agent.pendingRunCount).toBe(1);
  });

  it('rejects a typed turn when the wire is attached but not connected (canSend false)', async () => {
    const agent = new VoiceLiveAgent({ threadId: 't8', generateId: seq() });
    const sent: unknown[] = [];
    // Bridge is attached (as the binding does on mount) but the transport is not connected.
    agent.attachBridge({
      sendEvent: (e) => sent.push(e),
      cancelResponse: () => {},
      canSend: () => false,
    });
    agent.addMessage({ id: 'u1', role: 'user', content: 'hi' });
    const errors: BaseEvent[] = [];
    agent.events$.subscribe((e) => {
      if ((e as { type: EventType }).type === EventType.RUN_ERROR) errors.push(e);
    });
    await agent.runAgent().catch(() => {});
    expect(errors).toHaveLength(1); // errored cleanly, not left generating
    expect(sent).toHaveLength(0); // nothing dropped onto a dead wire
  });

  it('barges in on an active voice run when a typed turn arrives (legal stream, cancels the wire)', async () => {
    const agent = new VoiceLiveAgent({ threadId: 'tb', generateId: seq() });
    let cancelled = 0;
    const sent: unknown[] = [];
    agent.attachBridge({
      sendEvent: (e) => sent.push(e),
      cancelResponse: () => (cancelled += 1),
      canSend: () => true,
    });
    const seen: BaseEvent[] = [];
    agent.events$.subscribe((e) => seen.push(e));

    // A voice response is in flight (run active, assistant mid-message).
    const voice = assistantTurn('speaking…', 'rv', 'av');
    agent.ingestServerEvent(voice[0]!); // response.created
    agent.ingestServerEvent(voice[1]!); // a transcript delta
    void agent.pump();
    await tick();

    // The user types → barge-in.
    agent.addMessage({ id: 'u1', role: 'user', content: 'stop, new question' });
    const run = agent.runAgent();
    await tick();
    expect(cancelled).toBe(1); // the spoken response was cancelled on the wire
    expect(sent.map((e) => (e as { type: string }).type)).toEqual([
      'conversation.item.create',
      'response.create',
    ]);

    // The service answers the typed turn; that closes its run.
    for (const ev of assistantTurn('New answer.', 'rt', 'at')) agent.ingestServerEvent(ev);
    await run;

    // The whole event stream is legal AG-UI (nothing outside a run), with both runs terminated.
    verifyStream(seen);
    expect(seen.filter((e) => e.type === EventType.RUN_STARTED)).toHaveLength(2);
    expect(seen.filter((e) => e.type === EventType.RUN_FINISHED)).toHaveLength(2);
  });

  it('cancels the response on abortRun (barge-in)', () => {
    const agent = new VoiceLiveAgent({ threadId: 't6', generateId: seq() });
    let cancelled = 0;
    agent.attachBridge({ sendEvent: () => {}, cancelResponse: () => (cancelled += 1) });
    // open a run so there is something to abort
    agent.ingestServerEvent(assistantTurn('...')[0]!);
    agent.abortRun();
    expect(cancelled).toBe(1);
    expect(agent.hasOpenRun).toBe(false);
  });
});

/** Deterministic id source so message/run ids are stable across a test run. */
function seq(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

/** Yield to the macrotask queue so an in-flight `runAgent()` can execute `run()`. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
