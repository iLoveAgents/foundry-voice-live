import { describe, it, expect } from 'vitest';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import { VoiceLiveAguiMapper } from './mapper';
import { sequentialIds } from './ids';
import { verifyStream } from './verify';
import type { VoiceLiveServerEvent } from './types';

function mapper(opts: Partial<{ passthroughRaw: boolean; now: () => number }> = {}) {
  return new VoiceLiveAguiMapper({
    threadId: 'thread-1',
    generateId: sequentialIds('gen'),
    now: opts.now,
    passthroughRaw: opts.passthroughRaw,
  });
}

/** Feed a list of server events; return every AG-UI event produced, verified as a legal stream */
function run(m: VoiceLiveAguiMapper, events: VoiceLiveServerEvent[]): BaseEvent[] {
  const out: BaseEvent[] = [];
  for (const e of events) out.push(...m.handleServerEvent(e).events);
  verifyStream(out);
  return out;
}

type E = BaseEvent & Record<string, unknown>;
const types = (events: BaseEvent[]): EventType[] => events.map((e) => (e as E).type as EventType);
const ofType = (events: BaseEvent[], t: EventType): E[] =>
  (events as E[]).filter((e) => e.type === t);
const first = (events: BaseEvent[], t: EventType): E => {
  const found = ofType(events, t)[0];
  if (!found) throw new Error(`no ${t} event found`);
  return found;
};

describe('VoiceLiveAguiMapper — assistant turn', () => {
  it('maps a streamed assistant response to one message inside one run', () => {
    const m = mapper();
    const events = run(m, [
      { type: 'response.created', response: { id: 'resp-1' } },
      {
        type: 'response.audio_transcript.delta',
        response_id: 'resp-1',
        item_id: 'item-a',
        output_index: 0,
        content_index: 0,
        delta: 'Hel',
      },
      {
        type: 'response.audio_transcript.delta',
        response_id: 'resp-1',
        item_id: 'item-a',
        output_index: 0,
        content_index: 0,
        delta: 'lo.',
      },
      {
        type: 'response.audio_transcript.done',
        response_id: 'resp-1',
        item_id: 'item-a',
        output_index: 0,
        content_index: 0,
        transcript: 'Hello.',
      },
      { type: 'response.done', response: { id: 'resp-1', status: 'completed', output: [] } },
    ]);
    expect(types(events)).toEqual([
      EventType.RUN_STARTED,
      EventType.STEP_STARTED,
      EventType.STATE_DELTA, // sessionState → speaking, currentResponseId
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STATE_DELTA, // sessionState → listening (before the run closes)
      EventType.STEP_FINISHED,
      EventType.RUN_FINISHED,
    ]);
    const start = first(events, EventType.TEXT_MESSAGE_START);
    expect(start.messageId).toBe('item-a'); // messageId comes from item_id, not a counter
    expect(start.role).toBe('assistant');
    // deltas concatenate to exactly the final transcript (no duplication)
    const content = ofType(events, EventType.TEXT_MESSAGE_CONTENT)
      .map((e) => e.delta)
      .join('');
    expect(content).toBe('Hello.');
  });

  it('emits the remainder when the final text extends the accumulated deltas', () => {
    const m = mapper();
    const events = run(m, [
      { type: 'response.created', response: { id: 'r' } },
      {
        type: 'response.text.delta',
        response_id: 'r',
        item_id: 'i',
        output_index: 0,
        content_index: 0,
        delta: 'Hi',
      },
      {
        type: 'response.text.done',
        response_id: 'r',
        item_id: 'i',
        output_index: 0,
        content_index: 0,
        text: 'Hi there',
      },
      { type: 'response.done', response: { id: 'r', status: 'completed', output: [] } },
    ]);
    const content = ofType(events, EventType.TEXT_MESSAGE_CONTENT)
      .map((e) => e.delta)
      .join('');
    expect(content).toBe('Hi there');
  });

  it('snapshots the corrected text when the transcriber revises earlier words', () => {
    const m = mapper();
    const events = run(m, [
      { type: 'response.created', response: { id: 'r' } },
      {
        type: 'response.audio_transcript.delta',
        response_id: 'r',
        item_id: 'i',
        output_index: 0,
        content_index: 0,
        delta: 'their',
      },
      {
        type: 'response.audio_transcript.done',
        response_id: 'r',
        item_id: 'i',
        output_index: 0,
        content_index: 0,
        transcript: 'there',
      },
      { type: 'response.done', response: { id: 'r', status: 'completed', output: [] } },
    ]);
    const custom = ofType(events, EventType.CUSTOM).find(
      (e) => e.name === 'voice.transcript.corrected'
    );
    expect(custom).toBeDefined();
    expect((custom!.value as { text: string }).text).toBe('there');
  });

  it('emits a whole message atomically when no deltas preceded the .done', () => {
    const m = mapper();
    const events = run(m, [
      { type: 'response.created', response: { id: 'r' } },
      {
        type: 'response.text.done',
        response_id: 'r',
        item_id: 'i',
        output_index: 0,
        content_index: 0,
        text: 'Complete.',
      },
      { type: 'response.done', response: { id: 'r', status: 'completed', output: [] } },
    ]);
    expect(ofType(events, EventType.TEXT_MESSAGE_START)).toHaveLength(1);
    expect(first(events, EventType.TEXT_MESSAGE_CONTENT).delta).toBe('Complete.');
    expect(ofType(events, EventType.TEXT_MESSAGE_END)).toHaveLength(1);
  });
});

describe('VoiceLiveAguiMapper — user turn', () => {
  it('streams user transcription as a user message', () => {
    const m = mapper();
    const events = run(m, [
      { type: 'input_audio_buffer.speech_started', audio_start_ms: 0 },
      {
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'u1',
        content_index: 0,
        delta: 'what ',
      },
      {
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'u1',
        content_index: 0,
        delta: 'time',
      },
      {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'u1',
        content_index: 0,
        transcript: 'what time',
      },
    ]);
    const start = first(events, EventType.TEXT_MESSAGE_START);
    expect(start.role).toBe('user');
    expect(start.messageId).toBe('u1');
  });
});

describe('VoiceLiveAguiMapper — tool calls', () => {
  it('keeps one run open across a tool cluster and answers via a host tool result', () => {
    const m = mapper();
    const out: BaseEvent[] = [];
    const push = (e: VoiceLiveServerEvent) => out.push(...m.handleServerEvent(e).events);

    push({ type: 'response.created', response: { id: 'r1' } });
    push({
      type: 'response.output_item.added',
      response_id: 'r1',
      output_index: 0,
      item: { id: 'fc1', type: 'function_call', name: 'get_weather', call_id: 'call-1' },
    });
    push({
      type: 'response.function_call_arguments.delta',
      response_id: 'r1',
      item_id: 'fc1',
      output_index: 0,
      call_id: 'call-1',
      delta: '{"city"',
    });
    push({
      type: 'response.function_call_arguments.done',
      response_id: 'r1',
      item_id: 'fc1',
      output_index: 0,
      call_id: 'call-1',
      name: 'get_weather',
      arguments: '{"city":"Berlin"}',
    });
    // response.done declares the function call → the run must NOT close here
    push({
      type: 'response.done',
      response: {
        id: 'r1',
        status: 'completed',
        output: [{ id: 'fc1', type: 'function_call', call_id: 'call-1', name: 'get_weather' }],
      },
    });
    expect(ofType(out, EventType.RUN_FINISHED)).toHaveLength(0);
    // host sends the tool output, then the follow-up response speaks the answer
    out.push(
      ...m.handleHostEvent({ type: 'tool_result', callId: 'call-1', output: { temp: 21 } }).events
    );
    push({ type: 'response.created', response: { id: 'r2' } });
    push({
      type: 'response.audio_transcript.delta',
      response_id: 'r2',
      item_id: 'ia',
      output_index: 0,
      content_index: 0,
      delta: '21C.',
    });
    push({
      type: 'response.audio_transcript.done',
      response_id: 'r2',
      item_id: 'ia',
      output_index: 0,
      content_index: 0,
      transcript: '21C.',
    });
    push({ type: 'response.done', response: { id: 'r2', status: 'completed', output: [] } });

    verifyStream(out);
    expect(ofType(out, EventType.RUN_STARTED)).toHaveLength(1); // one run for the whole cluster
    expect(ofType(out, EventType.RUN_FINISHED)).toHaveLength(1);
    const result = first(out, EventType.TOOL_CALL_RESULT);
    expect(result.toolCallId).toBe('call-1');
    expect(result.content).toBe('{"temp":21}');
    const toolStart = first(out, EventType.TOOL_CALL_START);
    expect(toolStart.toolCallName).toBe('get_weather');
    expect(toolStart.parentMessageId).toBe('fc1');
  });

  it('produces a valid string tool result for non-serializable outputs (no throw, no undefined)', () => {
    // JSON.stringify returns undefined for `undefined`/functions and throws on BigInt/circular —
    // the mapper must still emit a string TOOL_CALL_RESULT.content in every case.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const cases: unknown[] = [undefined, 10n, circular, () => 0];
    for (const output of cases) {
      const m = mapper();
      const result = first(
        m.handleHostEvent({ type: 'tool_result', callId: 'c', output }).events,
        EventType.TOOL_CALL_RESULT
      );
      expect(typeof result.content).toBe('string');
      expect((result.content as string).length).toBeGreaterThan(0);
    }
  });

  it('buffers arguments until the tool name is known, emitting one clean START at .done', () => {
    const m = mapper();
    const out: BaseEvent[] = [];
    const push = (e: VoiceLiveServerEvent) => out.push(...m.handleServerEvent(e).events);
    push({ type: 'response.created', response: { id: 'r' } });
    // no output_item.added → name unknown; deltas must be buffered, not emitted as ARGS with no START
    push({
      type: 'response.function_call_arguments.delta',
      response_id: 'r',
      item_id: 'fc',
      output_index: 0,
      call_id: 'c',
      delta: '{"x":',
    });
    push({
      type: 'response.function_call_arguments.done',
      response_id: 'r',
      item_id: 'fc',
      output_index: 0,
      call_id: 'c',
      name: 'do_it',
      arguments: '{"x":1}',
    });
    push({
      type: 'response.done',
      response: {
        id: 'r',
        status: 'completed',
        output: [{ id: 'fc', type: 'function_call', call_id: 'c', name: 'do_it' }],
      },
    });
    out.push(...m.handleHostEvent({ type: 'tool_result', callId: 'c', output: 'ok' }).events);
    push({ type: 'response.created', response: { id: 'r2' } });
    push({ type: 'response.done', response: { id: 'r2', status: 'completed', output: [] } });
    verifyStream(out);
    expect(ofType(out, EventType.TOOL_CALL_START)).toHaveLength(1);
    expect(first(out, EventType.TOOL_CALL_START).toolCallName).toBe('do_it');
  });

  it('handles response.done arriving before the tool-call args (WebRTC reordering)', () => {
    const m = mapper();
    const out: BaseEvent[] = [];
    const push = (e: VoiceLiveServerEvent) => out.push(...m.handleServerEvent(e).events);
    push({ type: 'response.created', response: { id: 'r' } });
    // the terminal response.done (with the declared call) arrives FIRST
    push({
      type: 'response.done',
      response: {
        id: 'r',
        status: 'completed',
        output: [{ id: 'fc', type: 'function_call', call_id: 'c', name: 'f' }],
      },
    });
    expect(ofType(out, EventType.RUN_FINISHED)).toHaveLength(0); // run stays open, the call is owed
    // ...then the call events, out of order
    push({
      type: 'response.function_call_arguments.done',
      response_id: 'r',
      item_id: 'fc',
      output_index: 0,
      call_id: 'c',
      name: 'f',
      arguments: '{}',
    });
    out.push(...m.handleHostEvent({ type: 'tool_result', callId: 'c', output: 'x' }).events);
    push({ type: 'response.created', response: { id: 'r2' } });
    push({ type: 'response.done', response: { id: 'r2', status: 'completed', output: [] } });
    verifyStream(out);
    expect(ofType(out, EventType.RUN_FINISHED)).toHaveLength(1);
  });
});

describe('VoiceLiveAguiMapper — barge-in, cancel, error', () => {
  it('ends the open message and run on barge-in, keeping the partial text', () => {
    const m = mapper();
    const out: BaseEvent[] = [];
    const push = (e: VoiceLiveServerEvent) => out.push(...m.handleServerEvent(e).events);
    push({ type: 'response.created', response: { id: 'r' } });
    push({
      type: 'response.audio_transcript.delta',
      response_id: 'r',
      item_id: 'i',
      output_index: 0,
      content_index: 0,
      delta: 'The answer is',
    });
    push({ type: 'input_audio_buffer.speech_started', audio_start_ms: 100 }); // barge-in
    verifyStream(out);
    const idx = types(out);
    expect(idx).toContain(EventType.TEXT_MESSAGE_END);
    expect(ofType(out, EventType.CUSTOM).some((e) => e.name === 'voice.interrupted')).toBe(true);
    expect(ofType(out, EventType.RUN_FINISHED)).toHaveLength(1);
    // no content after the END
    const endPos = idx.indexOf(EventType.TEXT_MESSAGE_END);
    expect(idx.slice(endPos + 1)).not.toContain(EventType.TEXT_MESSAGE_CONTENT);
  });

  it('closes the run on barge-in that lands after response.created but before the first delta', () => {
    // Regression: previously the barge-in only closed the run if an assistant message was already
    // open, so an interrupt in the created→first-delta window left the run open and the next user
    // turn was appended to it (no fresh RUN_STARTED).
    const m = mapper();
    const out: BaseEvent[] = [];
    const push = (e: VoiceLiveServerEvent) => out.push(...m.handleServerEvent(e).events);
    push({ type: 'response.created', response: { id: 'r' } });
    push({ type: 'input_audio_buffer.speech_started', audio_start_ms: 100 }); // barge-in, no delta yet
    push({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'u1',
      content_index: 0,
      transcript: 'stop',
    });
    verifyStream(out);
    expect(ofType(out, EventType.RUN_FINISHED)).toHaveLength(1); // the interrupted run closed
    expect(ofType(out, EventType.RUN_STARTED)).toHaveLength(2); // and a fresh run opened for the user
  });

  it('clears currentResponseId when a response completes (no stale id between turns)', () => {
    const m = mapper();
    run(m, [
      { type: 'response.created', response: { id: 'resp-9' } },
      {
        type: 'response.audio_transcript.done',
        response_id: 'resp-9',
        item_id: 'i',
        output_index: 0,
        content_index: 0,
        transcript: 'done',
      },
      { type: 'response.done', response: { id: 'resp-9', status: 'completed', output: [] } },
    ]);
    expect(m.snapshot.state.currentResponseId).toBeNull();
  });

  it('closes with RUN_FINISHED on a cancelled response and RUN_ERROR on a failed one', () => {
    const cancelled = run(mapper(), [
      { type: 'response.created', response: { id: 'r' } },
      { type: 'response.done', response: { id: 'r', status: 'cancelled', output: [] } },
    ]);
    expect(ofType(cancelled, EventType.RUN_FINISHED)).toHaveLength(1);
    expect(
      ofType(cancelled, EventType.CUSTOM).some((e) => e.name === 'voice.response.cancelled')
    ).toBe(true);

    const failed = run(mapper(), [
      { type: 'response.created', response: { id: 'r' } },
      {
        type: 'response.done',
        response: {
          id: 'r',
          status: 'failed',
          status_details: { error: { message: 'boom', code: 'x' } },
          output: [],
        },
      },
    ]);
    expect(ofType(failed, EventType.RUN_ERROR)).toHaveLength(1);
    expect(first(failed, EventType.RUN_ERROR).message).toBe('boom');
  });
});

describe('VoiceLiveAguiMapper — dedup, idle, reconnect, close', () => {
  it('produces byte-identical output for a duplicated event_id', () => {
    const once = run(mapper(), [
      { type: 'response.created', event_id: 'e1', response: { id: 'r' } },
      {
        type: 'response.done',
        event_id: 'e2',
        response: { id: 'r', status: 'completed', output: [] },
      },
    ]);
    const m = mapper();
    const twice: BaseEvent[] = [];
    for (const e of [
      { type: 'response.created', event_id: 'e1', response: { id: 'r' } },
      { type: 'response.created', event_id: 'e1', response: { id: 'r' } }, // duplicate
      {
        type: 'response.done',
        event_id: 'e2',
        response: { id: 'r', status: 'completed', output: [] },
      },
    ] as VoiceLiveServerEvent[]) {
      twice.push(...m.handleServerEvent(e).events);
    }
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('force-closes an idle run via tick()', () => {
    const t = 1000;
    const m = new VoiceLiveAguiMapper({
      threadId: 't',
      generateId: sequentialIds('g'),
      now: () => t,
      runIdleTimeoutMs: 5000,
    });
    const out: BaseEvent[] = [];
    out.push(...m.handleServerEvent({ type: 'response.created', response: { id: 'r' } }).events);
    out.push(...m.tick(t + 4000).events); // not yet idle
    expect(ofType(out, EventType.RUN_FINISHED)).toHaveLength(0);
    out.push(...m.tick(t + 6000).events); // idle
    expect(ofType(out, EventType.RUN_FINISHED)).toHaveLength(1);
  });

  it('resets item maps on a new session.created so a recycled item_id cannot resurrect a message', () => {
    const m = mapper();
    const out: BaseEvent[] = [];
    const push = (e: VoiceLiveServerEvent) => out.push(...m.handleServerEvent(e).events);
    push({ type: 'response.created', response: { id: 'r' } });
    push({
      type: 'response.audio_transcript.delta',
      response_id: 'r',
      item_id: 'shared',
      output_index: 0,
      content_index: 0,
      delta: 'x',
    });
    push({ type: 'input_audio_buffer.speech_started' }); // barge-in closes the run + message
    push({ type: 'session.created', session: { id: 's2', model: 'gpt-4.1' } });
    // a new turn reusing item id 'shared' must open a fresh message
    push({ type: 'response.created', response: { id: 'r2' } });
    push({
      type: 'response.audio_transcript.delta',
      response_id: 'r2',
      item_id: 'shared',
      output_index: 0,
      content_index: 0,
      delta: 'y',
    });
    push({ type: 'response.done', response: { id: 'r2', status: 'completed', output: [] } });
    verifyStream(out);
    expect(ofType(out, EventType.STATE_SNAPSHOT)).toHaveLength(1); // from session.created
  });

  it('force-closes a run still open when a new session.created arrives (reconnect)', () => {
    // Regression: on auto-reconnect the service sends a fresh session.created. If a run was still
    // open, the mapper must close it, or the next turn is appended to the stale run (which may owe
    // tool calls) instead of opening a new RUN_STARTED.
    const m = mapper();
    const out: BaseEvent[] = [];
    const push = (e: VoiceLiveServerEvent): void => {
      out.push(...m.handleServerEvent(e).events);
    };
    push({ type: 'response.created', response: { id: 'r' } });
    push({
      type: 'response.audio_transcript.delta',
      response_id: 'r',
      item_id: 'i',
      output_index: 0,
      content_index: 0,
      delta: 'mid-answer',
    });
    // reconnect mid-response — no response.done for 'r'
    push({ type: 'session.created', session: { id: 's2', model: 'gpt-4.1' } });
    // the replacement session's first turn must open a fresh run
    push({ type: 'response.created', response: { id: 'r2' } });
    push({ type: 'response.done', response: { id: 'r2', status: 'completed', output: [] } });
    verifyStream(out);
    expect(ofType(out, EventType.RUN_FINISHED)).toHaveLength(2); // stale run closed + the new one
    expect(ofType(out, EventType.RUN_STARTED)).toHaveLength(2);
    expect(m.snapshot.state.currentResponseId).toBeNull();
  });

  it('resets isReady when the host reports the session is no longer ready', () => {
    const m = mapper();
    m.handleHostEvent({ type: 'ready', ready: true });
    expect(m.snapshot.state.isReady).toBe(true);
    m.handleHostEvent({ type: 'ready', ready: false });
    expect(m.snapshot.state.isReady).toBe(false);
  });

  it('close() ends open spans and is idempotent', () => {
    const m = mapper();
    const out: BaseEvent[] = [];
    out.push(...m.handleServerEvent({ type: 'response.created', response: { id: 'r' } }).events);
    out.push(
      ...m.handleServerEvent({
        type: 'response.audio_transcript.delta',
        response_id: 'r',
        item_id: 'i',
        output_index: 0,
        content_index: 0,
        delta: 'hi',
      }).events
    );
    const first = m.close();
    out.push(...first.events);
    verifyStream(out); // the run opened earlier and close() must balance every open span
    expect(ofType(first.events, EventType.TEXT_MESSAGE_END)).toHaveLength(1);
    expect(ofType(first.events, EventType.RUN_FINISHED)).toHaveLength(1);
    const second = m.close();
    expect(second.events).toEqual([]);
  });
});

describe('VoiceLiveAguiMapper — state and custom events', () => {
  it('publishes voice state as a snapshot then deltas', () => {
    const m = mapper();
    const out: BaseEvent[] = [];
    out.push(
      ...m.handleServerEvent({
        type: 'session.created',
        session: { id: 's', model: 'gpt-4.1', expires_at: 1000 },
      }).events
    );
    out.push(...m.handleHostEvent({ type: 'ready' }).events);
    out.push(...m.handleHostEvent({ type: 'mic', active: true, muted: false }).events);
    const snap = first(out, EventType.STATE_SNAPSHOT);
    expect((snap.snapshot as { voice: { model: string } }).voice.model).toBe('gpt-4.1');
    expect(ofType(out, EventType.STATE_DELTA).length).toBeGreaterThanOrEqual(2);
    expect(m.snapshot.state.isReady).toBe(true);
    expect(m.snapshot.state.isMicActive).toBe(true);
  });

  it('drops high-rate media events even with passthroughRaw', () => {
    const m = mapper({ passthroughRaw: true });
    const out: BaseEvent[] = [];
    const push = (e: VoiceLiveServerEvent) => out.push(...m.handleServerEvent(e).events);
    push({ type: 'response.created', response: { id: 'r' } });
    push({
      type: 'response.audio.delta',
      response_id: 'r',
      item_id: 'i',
      output_index: 0,
      content_index: 0,
      delta: 'AAAA',
    });
    push({
      type: 'response.animation_viseme.delta',
      response_id: 'r',
      item_id: 'i',
      output_index: 0,
      content_index: 0,
      audio_offset_ms: 0,
      viseme_id: 1,
    });
    expect(ofType(out, EventType.RAW)).toHaveLength(0);
  });

  it('surfaces MCP approval requests and service tool lifecycle as CUSTOM', () => {
    const m = mapper();
    const out: BaseEvent[] = [];
    out.push(
      ...m.handleServerEvent({
        type: 'conversation.item.created',
        item: {
          id: 'ap1',
          type: 'mcp_approval_request',
          server_label: 'srv',
          name: 'do',
          arguments: '{}',
        },
      }).events
    );
    out.push(
      ...m.handleServerEvent({
        type: 'response.mcp_call.in_progress',
        item_id: 'm1',
      } as VoiceLiveServerEvent).events
    );
    expect(ofType(out, EventType.CUSTOM).some((e) => e.name === 'voice.mcp.approval_request')).toBe(
      true
    );
    expect(ofType(out, EventType.CUSTOM).some((e) => e.name === 'voice.service_tool_call')).toBe(
      true
    );
  });
});
