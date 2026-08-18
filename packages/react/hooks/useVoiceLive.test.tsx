/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * useVoiceLive — WebSocket transport behaviour (fake WebSocket / AudioContext)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceLive } from './useVoiceLive';
import { FakeWebSocket, installBrowserFakes } from './testFakes';
import type { UseVoiceLiveConfig } from '../types/voiceLive';

let restore: () => void;

beforeEach(() => {
  restore = installBrowserFakes();
});

afterEach(() => {
  restore();
});

const baseConfig: UseVoiceLiveConfig = {
  connection: { resourceName: 'my-res', apiKey: 'secret' },
  session: { instructions: 'Be nice.' },
  autoStartMic: false,
  logLevel: 'none',
};

async function connectAndOpen(config: UseVoiceLiveConfig) {
  const hook = renderHook(() => useVoiceLive(config));
  await act(async () => {
    await hook.result.current.connect();
  });
  const ws = FakeWebSocket.instances[0]!;
  await act(async () => {
    ws.open();
  });
  return { hook, ws };
}

async function deliver(ws: FakeWebSocket, event: object) {
  await act(async () => {
    ws.receive(event);
  });
}

describe('useVoiceLive (websocket)', () => {
  it('connects with the documented URL and sends session.update after session.created', async () => {
    const { hook, ws } = await connectAndOpen(baseConfig);

    expect(ws.url).toContain('wss://my-res.services.ai.azure.com/voice-live/realtime?');
    expect(ws.url).toContain('api-version=2026-07-15');
    expect(ws.url).toContain('api-key=secret');
    expect(hook.result.current.connectionState).toBe('connected');
    expect(hook.result.current.transport).toBe('websocket');

    await deliver(ws, { type: 'session.created', session: { id: 's1', expires_at: 1_700_000_000 } });
    const update = ws.lastSent('session.update');
    expect(update).toBeDefined();
    expect(update.session.instructions).toBe('Be nice.');
    expect(update.session.turn_detection.type).toBe('azure_semantic_vad');
    expect(hook.result.current.sessionExpiresAt).toBe(1_700_000_000 * 1000);
    expect(hook.result.current.isReady).toBe(false);

    await deliver(ws, { type: 'session.updated', session: { id: 's1' } });
    expect(hook.result.current.isReady).toBe(true);
    expect(hook.result.current.sessionState).toBe('listening');
    hook.unmount();
  });

  it('uses the agent session builder in agent mode (proxy URL) and for updateSession', async () => {
    const { hook, ws } = await connectAndOpen({
      ...baseConfig,
      connection: { proxyUrl: 'ws://localhost:8080/ws?agentName=agent&projectName=proj' },
    });
    expect(ws.url).toBe('ws://localhost:8080/ws?agentName=agent&projectName=proj');

    await deliver(ws, { type: 'session.created', session: {} });
    const update = ws.lastSent('session.update');
    expect(update.session).not.toHaveProperty('instructions');
    expect(update.session.turn_detection.type).toBe('azure_semantic_vad');

    await act(async () => {
      hook.result.current.updateSession({ instructions: 'ignored in agent mode', voice: 'en-US-AvaNeural' });
    });
    const second = ws.sent.filter((e) => e.type === 'session.update')[1];
    expect(second.session).not.toHaveProperty('instructions');
    expect(second.session.voice).toEqual({ name: 'en-US-AvaNeural' });
    hook.unmount();
  });

  it('sends the pre-generated greeting with the correct wire format once ready', async () => {
    const { hook, ws } = await connectAndOpen({
      ...baseConfig,
      session: { greeting: { type: 'pregenerated', text: 'Welcome!' } },
    });
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });

    const create = ws.lastSent('response.create');
    expect(create.response.pre_generated_assistant_message).toEqual({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Welcome!' }],
    });
    hook.unmount();
  });

  it('accumulates user and assistant transcripts', async () => {
    const onTranscript = vi.fn();
    const { hook, ws } = await connectAndOpen({ ...baseConfig, onTranscript });
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });

    await deliver(ws, { type: 'conversation.item.input_audio_transcription.delta', item_id: 'i', delta: 'Hel' });
    await deliver(ws, { type: 'conversation.item.input_audio_transcription.delta', item_id: 'i', delta: 'lo' });
    expect(onTranscript).toHaveBeenLastCalledWith('user', 'Hello', false);
    await deliver(ws, {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'i',
      transcript: 'Hello there',
    });
    expect(onTranscript).toHaveBeenLastCalledWith('user', 'Hello there', true);

    await deliver(ws, { type: 'response.created', response: { id: 'r1' } });
    expect(hook.result.current.sessionState).toBe('speaking');
    await deliver(ws, {
      type: 'response.audio_transcript.delta',
      response_id: 'r1',
      item_id: 'a',
      output_index: 0,
      content_index: 0,
      delta: 'Hi ',
    });
    await deliver(ws, {
      type: 'response.text.delta',
      response_id: 'r1',
      item_id: 'a',
      output_index: 0,
      content_index: 0,
      delta: 'you',
    });
    expect(onTranscript).toHaveBeenLastCalledWith('assistant', 'Hi you', false);
    await deliver(ws, { type: 'response.done', response: { id: 'r1' } });
    expect(onTranscript).toHaveBeenLastCalledWith('assistant', 'Hi you', true);
    expect(hook.result.current.sessionState).toBe('listening');
    hook.unmount();
  });

  it('auto-sends tool results returned by toolExecutor and stays quiet for void executors', async () => {
    const toolExecutor = vi.fn(async (name: string) => (name === 'get_time' ? { time: '12:00' } : undefined));
    const { hook, ws } = await connectAndOpen({ ...baseConfig, toolExecutor });
    await deliver(ws, { type: 'session.created', session: {} });

    await deliver(ws, {
      type: 'response.function_call_arguments.done',
      response_id: 'r',
      item_id: 'i',
      output_index: 0,
      call_id: 'call_1',
      name: 'get_time',
      arguments: '{}',
    });
    // Let the executor promise settle
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toolExecutor).toHaveBeenCalledWith('get_time', '{}', 'call_1');
    const output = ws.lastSent('conversation.item.create');
    expect(output.item).toEqual({ type: 'function_call_output', call_id: 'call_1', output: '{"time":"12:00"}' });
    // The output goes out immediately; the follow-up response waits for response.done, because
    // only then is it certain that no further tool call belongs to this response
    expect(ws.lastSent('response.create')).toBeUndefined();
    await deliver(ws, { type: 'response.done', response: { id: 'r' } });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);

    const before = ws.sent.length;
    await deliver(ws, {
      type: 'response.function_call_arguments.done',
      response_id: 'r2',
      item_id: 'i2',
      output_index: 0,
      call_id: 'call_2',
      name: 'noop',
      arguments: '{}',
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await deliver(ws, { type: 'response.done', response: { id: 'r2' } });
    // A void executor produces no output, so it must not request a response either
    expect(ws.sent.length).toBe(before);
    hook.unmount();
  });

  it('exposes typed senders with the correct payloads', async () => {
    const { hook, ws } = await connectAndOpen(baseConfig);

    await act(async () => {
      hook.result.current.sendText('Hello');
      hook.result.current.sendToolResult('call_9', 'done', { triggerResponse: false });
      hook.result.current.approveMcpCall('req_1', true);
      hook.result.current.cancelResponse();
      hook.result.current.clearInputAudio();
      hook.result.current.commitInputAudio();
    });

    expect(ws.sent).toEqual([
      {
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello' }] },
      },
      { type: 'response.create', event_id: expect.stringMatching(/^evt_\d+$/) },
      { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: 'call_9', output: 'done' } },
      {
        type: 'conversation.item.create',
        item: { type: 'mcp_approval_response', approval_request_id: 'req_1', approve: true },
      },
      { type: 'response.cancel' },
      { type: 'input_audio_buffer.clear' },
      { type: 'input_audio_buffer.commit' },
    ]);
    hook.unmount();
  });

  it('surfaces MCP approval requests, warnings and errors', async () => {
    const onMcpApprovalRequest = vi.fn();
    const onWarning = vi.fn();
    const onEvent = vi.fn();
    const { hook, ws } = await connectAndOpen({ ...baseConfig, onMcpApprovalRequest, onWarning, onEvent });

    await deliver(ws, {
      type: 'conversation.item.created',
      item: { id: 'req_1', type: 'mcp_approval_request', server_label: 'mslearn', name: 'search', arguments: '{"q":"x"}' },
    });
    expect(onMcpApprovalRequest).toHaveBeenCalledWith({
      approvalRequestId: 'req_1',
      serverLabel: 'mslearn',
      name: 'search',
      arguments: '{"q":"x"}',
    });

    await deliver(ws, { type: 'warning', warning: { message: 'slow', code: 'latency' } });
    expect(onWarning).toHaveBeenCalledWith({ message: 'slow', code: 'latency' });

    // benign cancel errors are ignored, real errors surface
    await deliver(ws, { type: 'error', error: { code: 'response_cancel_not_active', message: 'no active response' } });
    expect(hook.result.current.error).toBeNull();
    await deliver(ws, { type: 'error', error: { code: 'invalid_request_error', message: 'Bad session' } });
    expect(hook.result.current.error).toBe('Bad session');

    expect(onEvent).toHaveBeenCalledTimes(4);
    hook.unmount();
  });

  it('is quiet by default (no info/debug console output)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const { hook, ws } = await connectAndOpen({ ...baseConfig, logLevel: undefined });
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });
    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    info.mockRestore();
    debug.mockRestore();
    hook.unmount();
  });

  it('reports configuration problems as errors instead of throwing', async () => {
    const hook = renderHook(() => useVoiceLive({ ...baseConfig, connection: { resourceName: 'r' } }));
    await act(async () => {
      await hook.result.current.connect();
    });
    expect(hook.result.current.connectionState).toBe('error');
    expect(hook.result.current.error).toMatch(/apiKey or token/);
    hook.unmount();
  });

  it('defers response.create while a response is in progress (no overlapping responses)', async () => {
    const toolExecutor = vi.fn(async () => ({ ok: true }));
    const { hook, ws } = await connectAndOpen({ ...baseConfig, toolExecutor });
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });

    // A response containing a function call is still running when the result comes back
    await deliver(ws, { type: 'response.created', response: { id: 'r1' } });
    await deliver(ws, {
      type: 'response.function_call_arguments.done',
      response_id: 'r1',
      item_id: 'i',
      output_index: 0,
      call_id: 'call_1',
      name: 'lookup',
      arguments: '{}',
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // function_call_output was sent immediately, response.create was NOT (response r1 still active)
    expect(ws.lastSent('conversation.item.create').item.type).toBe('function_call_output');
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(0);

    // sendText while the response is active is also deferred
    await act(async () => {
      hook.result.current.sendText('and this?');
    });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(0);

    // response.done releases exactly one deferred response.create
    await deliver(ws, { type: 'response.done', response: { id: 'r1' } });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
    hook.unmount();
  });

  it('keeps connect() stable across re-renders and ignores duplicate connect calls', async () => {
    let renders = 0;
    const hook = renderHook(() => {
      renders++;
      // Inline objects/closures on every render — must not change connect identity
      return useVoiceLive({
        connection: { resourceName: 'my-res', apiKey: 'secret' },
        session: { instructions: `Render ${renders}` },
        onTranscript: () => undefined,
        autoStartMic: false,
        logLevel: 'none',
      });
    });
    const firstConnect = hook.result.current.connect;
    hook.rerender();
    expect(hook.result.current.connect).toBe(firstConnect);

    await act(async () => {
      await hook.result.current.connect();
    });
    await act(async () => {
      await hook.result.current.connect(); // duplicate while CONNECTING
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    // The latest session config is used when the socket connects
    hook.rerender();
    const ws = FakeWebSocket.instances[0]!;
    await act(async () => {
      ws.open();
      ws.receive({ type: 'session.created', session: {} });
    });
    expect(ws.lastSent('session.update').session.instructions).toMatch(/^Render \d+$/);
    hook.unmount();
  });

  it('disconnect closes the socket and resets state', async () => {
    const { hook, ws } = await connectAndOpen(baseConfig);
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });
    await act(async () => {
      hook.result.current.disconnect();
    });
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(hook.result.current.connectionState).toBe('disconnected');
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.sessionState).toBe('idle');
    hook.unmount();
  });

  it('sends every parallel tool output before requesting a single response', async () => {
    // Two function calls in one response whose executors settle after response.done:
    // the first result must not start a response without the second output
    let resolveA: (v: object) => void = () => undefined;
    let resolveB: (v: object) => void = () => undefined;
    const toolExecutor = vi.fn((name: string) =>
      name === 'a'
        ? new Promise<object>((r) => {
            resolveA = r;
          })
        : new Promise<object>((r) => {
            resolveB = r;
          })
    );
    const { ws } = await connectAndOpen({ ...baseConfig, toolExecutor });
    await deliver(ws, { type: 'session.created', session: { id: 's1' } });
    await deliver(ws, { type: 'session.updated', session: { id: 's1' } });
    await deliver(ws, { type: 'response.created', response: { id: 'resp-1' } });
    await deliver(ws, {
      type: 'response.function_call_arguments.done',
      response_id: 'resp-1',
      call_id: 'call-a',
      name: 'a',
      arguments: '{}',
    });
    await deliver(ws, {
      type: 'response.function_call_arguments.done',
      response_id: 'resp-1',
      call_id: 'call-b',
      name: 'b',
      arguments: '{}',
    });
    // The response finishes while both tools are still running
    await deliver(ws, { type: 'response.done', response: { id: 'resp-1' } });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(0);

    await act(async () => {
      resolveA({ ok: 'a' });
    });
    // First output is sent, but no response yet — the second output is still missing
    const outputs = () => ws.sent.filter((e) => e.type === 'conversation.item.create');
    expect(outputs()).toHaveLength(1);
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(0);

    await act(async () => {
      resolveB({ ok: 'b' });
    });
    expect(outputs()).toHaveLength(2);
    expect(outputs().map((e) => e.item.call_id)).toEqual(['call-a', 'call-b']);
    // Exactly one response for the whole batch
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
  });

  it('does not request a response when no executor returned a result', async () => {
    const toolExecutor = vi.fn(async () => undefined);
    const { ws } = await connectAndOpen({ ...baseConfig, toolExecutor });
    await deliver(ws, { type: 'session.created', session: { id: 's1' } });
    await deliver(ws, { type: 'session.updated', session: { id: 's1' } });
    await deliver(ws, {
      type: 'response.function_call_arguments.done',
      response_id: 'resp-1',
      call_id: 'call-a',
      name: 'a',
      arguments: '{}',
    });
    await act(async () => undefined);
    expect(toolExecutor).toHaveBeenCalled();
    expect(ws.sent.filter((e) => e.type === 'conversation.item.create')).toHaveLength(0);
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(0);
  });

  it('sends only one response.create when two turns are submitted before the server answers', async () => {
    const { hook, ws } = await connectAndOpen(baseConfig);
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });

    // Two sends in a row: response.created has not arrived yet, so the conversation still *looks*
    // idle — without request tracking both would be sent and the service would reject the second
    await act(async () => {
      hook.result.current.sendText('first');
      hook.result.current.sendText('second');
    });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
    expect(ws.sent.filter((e) => e.type === 'conversation.item.create')).toHaveLength(2);

    // the deferred one goes out when the first response completes
    await deliver(ws, { type: 'response.created', response: { id: 'r1' } });
    await deliver(ws, { type: 'response.done', response: { id: 'r1' } });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(2);

    // an API error clears the outstanding request so later turns still work
    await act(async () => {
      hook.result.current.sendText('third');
    });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(2);
    await deliver(ws, { type: 'error', error: { message: 'rejected', code: 'x' } });
    await act(async () => {
      hook.result.current.sendText('fourth');
    });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(3);
    hook.unmount();
  });

  it('stops handling an event when a consumer callback disconnects from onEvent', async () => {
    let hookRef: { current: ReturnType<typeof useVoiceLive> } | null = null;
    const onEvent = vi.fn((event: { type: string }) => {
      if (event.type === 'session.updated') {
        hookRef?.current.disconnect();
      }
    });
    const config = { ...baseConfig, onEvent };
    const hook = renderHook(() => useVoiceLive(config));
    hookRef = hook.result as never;
    await act(async () => {
      await hook.result.current.connect();
    });
    const ws = FakeWebSocket.instances[0]!;
    await act(async () => {
      ws.open();
      ws.receive({ type: 'session.created', session: {} });
    });
    await act(async () => {
      ws.receive({ type: 'session.updated', session: {} });
    });
    // announceReady() must not resurrect a session the consumer just ended
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.connectionState).toBe('disconnected');
    hook.unmount();
  });

  it('gives every response.create an id, including queued flushes', async () => {
    const { hook, ws } = await connectAndOpen(baseConfig);
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });
    await act(async () => {
      hook.result.current.sendText('first');
      hook.result.current.sendText('second'); // queued
    });
    await deliver(ws, { type: 'response.created', response: { id: 'r1' } });
    await deliver(ws, { type: 'response.done', response: { id: 'r1' } });

    const creates = ws.sent.filter((e) => e.type === 'response.create');
    expect(creates).toHaveLength(2);
    // both the direct request and the flushed one carry an id, so an error naming it can be
    // correlated with the request it rejected
    for (const create of creates) {
      expect(create.event_id).toMatch(/^evt_\d+$/);
    }
    expect(creates[0].event_id).not.toBe(creates[1].event_id);
    hook.unmount();
  });

  it('answers a tool call whose response.done arrived first (WebRTC channel ordering)', async () => {
    // Over WebRTC the lifecycle events (data channel) and function-call events (control channel)
    // are independent, so response.done can precede the tool call it belongs to
    const toolExecutor = vi.fn(async () => ({ temp: 21 }));
    const { hook, ws } = await connectAndOpen({ ...baseConfig, toolExecutor });
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });
    await deliver(ws, { type: 'response.created', response: { id: 'resp-1' } });
    await deliver(ws, { type: 'response.done', response: { id: 'resp-1' } });
    // ...the tool event arrives afterwards
    await deliver(ws, {
      type: 'response.function_call_arguments.done',
      response_id: 'resp-1',
      call_id: 'call-1',
      name: 'get_weather',
      arguments: '{}',
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const output = ws.lastSent('conversation.item.create');
    expect(output.item.call_id).toBe('call-1');
    // without remembering the completed response the batch would wait forever and the assistant
    // would never speak the result
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
    hook.unmount();
  });

  it('holds a user turn submitted mid-tool-call until the output is on the wire', async () => {
    let resolveTool: (v: object) => void = () => undefined;
    const toolExecutor = vi.fn(
      () =>
        new Promise<object>((r) => {
          resolveTool = r;
        })
    );
    const { hook, ws } = await connectAndOpen({ ...baseConfig, toolExecutor });
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });
    await deliver(ws, { type: 'response.created', response: { id: 'resp-1' } });
    await deliver(ws, {
      type: 'response.function_call_arguments.done',
      response_id: 'resp-1',
      call_id: 'call-1',
      name: 'slow',
      arguments: '{}',
    });

    // the user types while the tool is still running
    await act(async () => {
      hook.result.current.sendText('and what about tomorrow?');
    });
    await deliver(ws, { type: 'response.done', response: { id: 'resp-1' } });
    // the turn must NOT be answered yet: the function_call_output does not exist
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(0);

    await act(async () => {
      resolveTool({ ok: true });
    });
    const items = ws.sent.filter((e) => e.type === 'conversation.item.create');
    expect(items.map((e) => e.item.type)).toEqual(['message', 'function_call_output']);
    // one response answers the tool result and the user's message together
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
    hook.unmount();
  });

  it('still answers a queued turn when every executor returns void', async () => {
    const toolExecutor = vi.fn(async () => undefined);
    const { hook, ws } = await connectAndOpen({ ...baseConfig, toolExecutor });
    await deliver(ws, { type: 'session.created', session: {} });
    await deliver(ws, { type: 'session.updated', session: {} });
    await deliver(ws, { type: 'response.created', response: { id: 'resp-1' } });
    await deliver(ws, {
      type: 'response.function_call_arguments.done',
      response_id: 'resp-1',
      call_id: 'call-1',
      name: 'fire_and_forget',
      arguments: '{}',
    });
    await act(async () => {
      hook.result.current.sendText('meanwhile...');
    });
    await deliver(ws, { type: 'response.done', response: { id: 'resp-1' } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    // no tool output was produced, but the user's turn must still get its answer
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
    hook.unmount();
  });
});
