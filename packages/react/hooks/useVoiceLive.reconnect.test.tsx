/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * useVoiceLive — auto-reconnect, token provider and avatar plumbing (fake browser APIs)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceLive } from './useVoiceLive';
import {
  FakeWebSocket,
  FakePeerConnection,
  FakeAudioWorkletNode,
  installBrowserFakes,
  makeFakeMicStream,
} from './testFakes';
import type { UseVoiceLiveConfig } from '../types/voiceLive';

let restore: () => void;

beforeEach(() => {
  restore = installBrowserFakes();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  restore();
});

const baseConfig: UseVoiceLiveConfig = {
  connection: { resourceName: 'my-res', apiKey: 'secret' },
  session: { instructions: 'Be nice.' },
  autoStartMic: false,
  logLevel: 'none',
};

async function connectAndReady(config: UseVoiceLiveConfig) {
  const hook = renderHook(() => useVoiceLive(config));
  await act(async () => {
    await hook.result.current.connect();
  });
  const ws = FakeWebSocket.instances.at(-1)!;
  await act(async () => {
    ws.open();
    ws.receive({ type: 'session.created', session: { id: 's1' } });
    ws.receive({ type: 'session.updated', session: { id: 's1' } });
  });
  expect(hook.result.current.isReady).toBe(true);
  return { hook, ws };
}

describe('useVoiceLive (reconnect)', () => {
  it('stays disconnected after an unexpected close when reconnect is off', async () => {
    const { hook, ws } = await connectAndReady(baseConfig);
    await act(async () => {
      ws.drop(1006);
    });
    expect(hook.result.current.connectionState).toBe('disconnected');
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.reconnectAttempt).toBe(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects with backoff after an unclean close and reports the lifecycle', async () => {
    const onReconnecting = vi.fn();
    const onReconnected = vi.fn();
    const onTranscript = vi.fn();
    const { hook, ws } = await connectAndReady({
      ...baseConfig,
      reconnect: { initialDelayMs: 100, jitter: 0, maxAttempts: 3 },
      onReconnecting,
      onReconnected,
      onTranscript,
    });

    await act(async () => {
      ws.drop(1006, 'network');
    });
    expect(hook.result.current.connectionState).toBe('reconnecting');
    expect(hook.result.current.reconnectAttempt).toBe(1);
    expect(hook.result.current.isReady).toBe(false);
    expect(onReconnecting).toHaveBeenCalledWith(1, 100);
    expect(FakeWebSocket.instances).toHaveLength(1); // not before the delay

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws2 = FakeWebSocket.instances[1]!;
    expect(ws2.url).toBe(ws.url);

    await act(async () => {
      ws2.open();
      ws2.receive({ type: 'session.created', session: { id: 's2' } });
      ws2.receive({ type: 'session.updated', session: { id: 's2' } });
    });
    expect(hook.result.current.connectionState).toBe('connected');
    expect(hook.result.current.isReady).toBe(true);
    expect(hook.result.current.reconnectAttempt).toBe(0);
    expect(onReconnected).toHaveBeenCalledTimes(1);
    // the new socket configured its session and receives traffic
    expect(ws2.lastSent('session.update')).toBeTruthy();
    await act(async () => {
      ws2.receive({ type: 'response.audio_transcript.delta', delta: 'hi' });
    });
    expect(onTranscript).toHaveBeenCalledWith('assistant', 'hi', false);
    // events from the dead socket are ignored
    const calls = onTranscript.mock.calls.length;
    ws.receive({ type: 'response.audio_transcript.delta', delta: 'ghost' });
    expect(onTranscript).toHaveBeenCalledTimes(calls);
  });

  it('gives up after maxAttempts and surfaces an error', async () => {
    const { hook, ws } = await connectAndReady({
      ...baseConfig,
      reconnect: { initialDelayMs: 10, jitter: 0, maxAttempts: 2 },
    });
    await act(async () => {
      ws.drop(1006);
    });
    for (let attempt = 1; attempt <= 2; attempt++) {
      expect(hook.result.current.reconnectAttempt).toBe(attempt);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * Math.pow(2, attempt - 1));
      });
      const next = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        next.open();
        next.drop(1006);
      });
    }
    expect(hook.result.current.connectionState).toBe('error');
    expect(hook.result.current.error).toMatch(/giving up after 2 reconnect attempt/);
    expect(hook.result.current.reconnectAttempt).toBe(0);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('does not reconnect after a clean close, disconnect() or on a manual connect() during the wait', async () => {
    const config = { ...baseConfig, reconnect: { initialDelayMs: 100, jitter: 0 } };
    const clean = await connectAndReady(config);
    await act(async () => {
      clean.ws.close(1000, 'bye');
    });
    expect(clean.hook.result.current.connectionState).toBe('disconnected');
    clean.hook.unmount();

    FakeWebSocket.reset();
    const { hook, ws } = await connectAndReady(config);
    await act(async () => {
      ws.drop(1006);
    });
    expect(hook.result.current.connectionState).toBe('reconnecting');
    act(() => {
      hook.result.current.disconnect();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(hook.result.current.connectionState).toBe('disconnected');

    // manual connect() while a reconnect is pending supersedes it
    await act(async () => {
      await hook.result.current.connect();
    });
    const ws3 = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws3.open();
      ws3.drop(1006);
    });
    expect(hook.result.current.connectionState).toBe('reconnecting');
    await act(async () => {
      await hook.result.current.connect();
    });
    expect(hook.result.current.connectionState).toBe('connecting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    // exactly one new socket from the manual connect, none from the cancelled timer
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('uses getToken for every attempt and does not resend the greeting after a reconnect', async () => {
    let n = 0;
    const getToken = vi.fn(async () => `tok-${++n}`);
    const { hook, ws } = await connectAndReady({
      ...baseConfig,
      connection: { resourceName: 'my-res', getToken },
      session: { greeting: { type: 'pregenerated', text: 'Hello!' } },
      reconnect: { initialDelayMs: 10, jitter: 0 },
    });
    expect(ws.url).toContain(encodeURIComponent('Bearer tok-1'));
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);

    await act(async () => {
      ws.drop(1006);
      await vi.advanceTimersByTimeAsync(10);
    });
    const ws2 = FakeWebSocket.instances.at(-1)!;
    expect(ws2.url).toContain(encodeURIComponent('Bearer tok-2'));
    await act(async () => {
      ws2.open();
      ws2.receive({ type: 'session.created', session: { id: 's2' } });
      ws2.receive({ type: 'session.updated', session: { id: 's2' } });
    });
    expect(hook.result.current.isReady).toBe(true);
    expect(ws2.sent.filter((e) => e.type === 'response.create')).toHaveLength(0);

    // a fresh connect() greets again
    act(() => hook.result.current.disconnect());
    await act(async () => {
      await hook.result.current.connect();
    });
    const ws3 = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws3.open();
      ws3.receive({ type: 'session.created', session: { id: 's3' } });
      ws3.receive({ type: 'session.updated', session: { id: 's3' } });
    });
    expect(ws3.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
    expect(getToken).toHaveBeenCalledTimes(3);
  });

  it('reconnects the WebRTC transport after a negotiation timeout and re-attaches the mic track', async () => {
    const { hook } = { hook: renderHook(() => useVoiceLive({
      ...baseConfig,
      connection: { resourceName: 'my-res', apiKey: 'secret', transport: 'webrtc' },
      autoStartMic: true,
      reconnect: { initialDelayMs: 10, jitter: 0 },
    })) };
    await act(async () => {
      await hook.result.current.connect();
    });
    const ws = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws.open();
    });
    await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());
    const pc = FakePeerConnection.instances.at(-1)!;
    await act(async () => {
      pc.setConnectionState('connected');
      pc.dataChannels[0]!.open();
    });
    expect(hook.result.current.isReady).toBe(true);
    await vi.waitFor(() => expect(hook.result.current.isMicActive).toBe(true));

    // control channel drops → reconnect with a new peer connection carrying the existing mic track
    await act(async () => {
      ws.drop(1006);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(hook.result.current.connectionState).toBe('reconnecting');
    const ws2 = FakeWebSocket.instances.at(-1)!;
    expect(ws2).not.toBe(ws);
    await act(async () => {
      ws2.open();
    });
    await vi.waitFor(() => expect(ws2.lastSent('rtc.call.sdp.create')).toBeTruthy());
    const pc2 = FakePeerConnection.instances.at(-1)!;
    expect(pc2).not.toBe(pc);
    // the mic track was passed as the transceiver track of the new offer
    expect(pc2.transceivers[0]!.kindOrTrack).toMatchObject({ kind: 'audio' });
    await act(async () => {
      pc2.setConnectionState('connected');
      pc2.dataChannels[0]!.open();
    });
    expect(hook.result.current.connectionState).toBe('connected');
    expect(hook.result.current.isReady).toBe(true);
    expect(hook.result.current.isMicActive).toBe(true);
  });

  it('keeps retrying when a reconnect attempt fails during setup (transient getToken error)', async () => {
    let calls = 0;
    const getToken = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error('token endpoint unavailable');
      return `tok-${calls}`;
    });
    const onReconnecting = vi.fn();
    const { hook, ws } = await connectAndReady({
      ...baseConfig,
      connection: { resourceName: 'my-res', getToken },
      reconnect: { initialDelayMs: 10, jitter: 0, maxAttempts: 3 },
      onReconnecting,
    });

    await act(async () => {
      ws.drop(1006);
    });
    // Attempt 1 fails while acquiring the token — the policy must consume the attempt and continue
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(hook.result.current.connectionState).toBe('reconnecting');
    expect(hook.result.current.reconnectAttempt).toBe(2);
    expect(FakeWebSocket.instances).toHaveLength(1); // no transport was created for the failed attempt

    // Attempt 2 gets a token and connects
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    const ws2 = FakeWebSocket.instances.at(-1)!;
    expect(ws2).not.toBe(ws);
    await act(async () => {
      ws2.open();
      ws2.receive({ type: 'session.created', session: { id: 's2' } });
      ws2.receive({ type: 'session.updated', session: { id: 's2' } });
    });
    expect(hook.result.current.connectionState).toBe('connected');
    expect(hook.result.current.reconnectAttempt).toBe(0);
    expect(onReconnecting).toHaveBeenCalledTimes(2);
  });

  it('releases a microphone whose permission prompt resolves after disconnect', async () => {
    const { stream, track } = makeFakeMicStream();
    let release: (s: MediaStream) => void = () => undefined;
    const restoreFakes = installBrowserFakes({
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          release = resolve;
        }),
    });
    try {
      const hook = renderHook(() =>
        useVoiceLive({
          ...baseConfig,
          connection: { resourceName: 'my-res', apiKey: 'secret', transport: 'webrtc' },
          autoStartMic: false,
        })
      );
      await act(async () => {
        await hook.result.current.connect();
      });
      const ws = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        ws.open();
      });
      await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());

      // Mic request is still pending when the user disconnects
      const micPromise = hook.result.current.startMic();
      act(() => {
        hook.result.current.disconnect();
      });
      await act(async () => {
        release(stream as unknown as MediaStream);
        await micPromise;
      });

      // The late track must be stopped, not left live and reported as active
      expect(track.stop).toHaveBeenCalled();
      expect(hook.result.current.isMicActive).toBe(false);
    } finally {
      restoreFakes();
    }
  });

  it('ignores an avatar SDP that is applied after the session was torn down', async () => {
    const hook = renderHook(() =>
      useVoiceLive({
        ...baseConfig,
        session: { instructions: 'Be nice.', avatar: { character: 'lisa', style: 'casual-sitting' } },
      })
    );
    await act(async () => {
      await hook.result.current.connect();
    });
    const ws = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws.open();
      ws.receive({ type: 'session.created', session: { id: 's1' } });
    });
    // Avatar mode: the service returns ICE servers, the SDK offers and waits for the answer
    await act(async () => {
      ws.receive({
        type: 'session.updated',
        session: { id: 's1', avatar: { ice_servers: [{ urls: 'turn:relay.example' }] } },
      });
    });
    await vi.waitFor(() => expect(ws.lastSent('session.avatar.connect')).toBeTruthy());
    expect(hook.result.current.isReady).toBe(false);

    // Make applying the server SDP pend, then tear the session down while it is in flight
    const pc = FakePeerConnection.instances.at(-1)!;
    let applyAnswer: () => void = () => undefined;
    pc.setRemoteDescription = (): Promise<void> =>
      new Promise<void>((resolve) => {
        applyAnswer = resolve;
      });
    const serverSdp = btoa(JSON.stringify({ type: 'answer', sdp: 'v=0 answer' }));
    await act(async () => {
      ws.receive({ type: 'session.avatar.connecting', server_sdp: serverSdp });
    });
    act(() => {
      hook.result.current.disconnect();
    });
    await act(async () => {
      applyAnswer();
    });

    // The dead negotiation must not mark the session ready
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.connectionState).toBe('disconnected');
    expect(hook.result.current.error).toBeNull();
  });

  it('fails a connect that never opens instead of sitting in connecting forever', async () => {
    const hook = renderHook(() =>
      useVoiceLive({ ...baseConfig, connectTimeoutMs: 5000 })
    );
    await act(async () => {
      await hook.result.current.connect();
    });
    expect(hook.result.current.connectionState).toBe('connecting');
    const ws = FakeWebSocket.instances.at(-1)!;
    // socket neither opens nor errors (silently dropped upgrade / dead proxy)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(hook.result.current.connectionState).toBe('error');
    expect(hook.result.current.error).toMatch(/timed out after 5000 ms/i);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    // ...and connect() works again (the guard no longer sees a 'connecting' transport)
    await act(async () => {
      await hook.result.current.connect();
    });
    expect(hook.result.current.connectionState).toBe('connecting');
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('retries a timed-out connect when reconnect is enabled, and cancels the timer once open', async () => {
    const hook = renderHook(() =>
      useVoiceLive({ ...baseConfig, connectTimeoutMs: 1000, reconnect: { initialDelayMs: 10, jitter: 0 } })
    );
    await act(async () => {
      await hook.result.current.connect();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(hook.result.current.connectionState).toBe('reconnecting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const ws2 = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws2.open();
      ws2.receive({ type: 'session.created', session: { id: 's1' } });
      ws2.receive({ type: 'session.updated', session: { id: 's1' } });
    });
    expect(hook.result.current.connectionState).toBe('connected');
    // the timer was cleared on open: advancing well past the timeout must not tear the session down
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(hook.result.current.connectionState).toBe('connected');
    expect(hook.result.current.isReady).toBe(true);
  });

  it('discards a tool result whose executor settles after a reconnect', async () => {
    let resolveTool: (v: object) => void = () => undefined;
    const toolExecutor = vi.fn(
      () =>
        new Promise<object>((r) => {
          resolveTool = r;
        })
    );
    const { hook, ws } = await connectAndReady({
      ...baseConfig,
      toolExecutor,
      reconnect: { initialDelayMs: 10, jitter: 0 },
    });
    await act(async () => {
      ws.receive({ type: 'response.created', response: { id: 'resp-1' } });
      ws.receive({
        type: 'response.function_call_arguments.done',
        response_id: 'resp-1',
        call_id: 'call-a',
        name: 'slow',
        arguments: '{}',
      });
    });

    // Connection drops and reconnects while the tool is still running
    await act(async () => {
      ws.drop(1006);
      await vi.advanceTimersByTimeAsync(10);
    });
    const ws2 = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws2.open();
      ws2.receive({ type: 'session.created', session: { id: 's2' } });
      ws2.receive({ type: 'session.updated', session: { id: 's2' } });
    });
    expect(hook.result.current.isReady).toBe(true);

    await act(async () => {
      resolveTool({ ok: true });
    });
    // The output belongs to a conversation the new session does not have: it must not be sent,
    // and it must not trigger a response there
    expect(ws2.sent.filter((e) => e.type === 'conversation.item.create')).toHaveLength(0);
    expect(ws2.sent.filter((e) => e.type === 'response.create')).toHaveLength(0);
  });

  it('releases a microphone acquired after stopMic() was called', async () => {
    const { stream, track } = makeFakeMicStream();
    let release: (s: MediaStream) => void = () => undefined;
    const restoreFakes = installBrowserFakes({
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          release = resolve;
        }),
    });
    try {
      const hook = renderHook(() =>
        useVoiceLive({
          ...baseConfig,
          connection: { resourceName: 'my-res', apiKey: 'secret', transport: 'webrtc' },
          autoStartMic: false,
        })
      );
      await act(async () => {
        await hook.result.current.connect();
      });
      const ws = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        ws.open();
      });
      await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());

      const micPromise = hook.result.current.startMic();
      act(() => {
        hook.result.current.stopMic(); // user changed their mind while the prompt was open
      });
      await act(async () => {
        release(stream as unknown as MediaStream);
        await micPromise;
      });
      expect(track.stop).toHaveBeenCalled();
      expect(hook.result.current.isMicActive).toBe(false);
    } finally {
      restoreFakes();
    }
  });

  it('survives throwing consumer callbacks and still reconnects', async () => {
    const onReconnecting = vi.fn(() => {
      throw new Error('consumer bug');
    });
    const onEvent = vi.fn(() => {
      throw new Error('consumer bug');
    });
    const { hook, ws } = await connectAndReady({
      ...baseConfig,
      onEvent,
      onReconnecting,
      reconnect: { initialDelayMs: 10, jitter: 0 },
    });
    // a throwing onEvent must not abort our own handling: session.update was still sent
    expect(onEvent).toHaveBeenCalled();
    expect(ws.lastSent('session.update')).toBeTruthy();

    await act(async () => {
      ws.drop(1006);
    });
    expect(onReconnecting).toHaveBeenCalled();
    // the retry was armed before the callback threw
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const ws2 = FakeWebSocket.instances.at(-1)!;
    expect(ws2).not.toBe(ws);
    await act(async () => {
      ws2.open();
      ws2.receive({ type: 'session.created', session: { id: 's2' } });
      ws2.receive({ type: 'session.updated', session: { id: 's2' } });
    });
    expect(hook.result.current.connectionState).toBe('connected');
    expect(hook.result.current.isReady).toBe(true);
  });

  it('reports a failed tool executor to the model instead of stalling the conversation', async () => {
    const toolExecutor = vi.fn(async () => {
      throw new Error('backend down');
    });
    const { ws } = await connectAndReady({ ...baseConfig, toolExecutor });
    await act(async () => {
      ws.receive({ type: 'response.created', response: { id: 'r1' } });
      ws.receive({
        type: 'response.function_call_arguments.done',
        response_id: 'r1',
        call_id: 'call-a',
        name: 'lookup',
        arguments: '{}',
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const output = ws.lastSent('conversation.item.create');
    expect(output.item.call_id).toBe('call-a');
    expect(JSON.parse(output.item.output)).toEqual({ error: 'backend down' });
    // ...and the follow-up response still happens once the response is done
    await act(async () => {
      ws.receive({ type: 'response.done', response: { id: 'r1' } });
    });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
  });

  it('clears the session expiry when the session ends', async () => {
    const { hook, ws } = await connectAndReady(baseConfig);
    await act(async () => {
      ws.receive({ type: 'session.updated', session: { id: 's1', expires_at: 1_800_000_000 } });
    });
    expect(hook.result.current.sessionExpiresAt).toBe(1_800_000_000_000);
    act(() => {
      hook.result.current.disconnect();
    });
    // a stale expiry would keep a countdown UI ticking against a dead session
    expect(hook.result.current.sessionExpiresAt).toBeNull();
  });

  it('reconnects after a mid-call WebRTC media failure', async () => {
    const hook = renderHook(() =>
      useVoiceLive({
        ...baseConfig,
        connection: { resourceName: 'my-res', apiKey: 'secret', transport: 'webrtc' },
        reconnect: { initialDelayMs: 10, jitter: 0 },
      })
    );
    await act(async () => {
      await hook.result.current.connect();
    });
    const ws = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws.open();
    });
    await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());
    const pc = FakePeerConnection.instances.at(-1)!;
    await act(async () => {
      pc.setConnectionState('connected');
      pc.dataChannels[0]!.open();
    });
    expect(hook.result.current.isReady).toBe(true);

    // network change mid-call
    await act(async () => {
      pc.setConnectionState('failed');
    });
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.connectionState).toBe('reconnecting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const ws2 = FakeWebSocket.instances.at(-1)!;
    expect(ws2).not.toBe(ws);
    await act(async () => {
      ws2.open();
    });
    await vi.waitFor(() => expect(ws2.lastSent('rtc.call.sdp.create')).toBeTruthy());
    const pc2 = FakePeerConnection.instances.at(-1)!;
    await act(async () => {
      pc2.setConnectionState('connected');
      pc2.dataChannels[0]!.open();
    });
    expect(hook.result.current.connectionState).toBe('connected');
    expect(hook.result.current.isReady).toBe(true);
  });

  it('does not stream microphone audio while reconnecting or before the session is configured', async () => {
    const { stream } = makeFakeMicStream();
    const restoreFakes = installBrowserFakes({ getUserMedia: async () => stream as unknown as MediaStream });
    try {
      const hook = renderHook(() =>
        useVoiceLive({ ...baseConfig, autoStartMic: false, reconnect: { initialDelayMs: 10, jitter: 0 } })
      );
      await act(async () => {
        await hook.result.current.connect();
      });
      const ws = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        ws.open();
      });
      // socket open but session.updated not yet received: audio must not be forwarded
      const worklet = FakeAudioWorkletNode.instances.at(-1);
      const pushAudio = (): void => {
        const node = FakeAudioWorkletNode.instances.at(-1);
        node?.port.onmessage?.({ data: new Int16Array(2400).buffer });
      };
      await act(async () => {
        await hook.result.current.startMic();
      });
      pushAudio();
      expect(ws.sent.filter((e) => e.type === 'input_audio_buffer.append')).toHaveLength(0);
      expect(worklet ?? true).toBeTruthy();

      await act(async () => {
        ws.receive({ type: 'session.created', session: { id: 's1' } });
        ws.receive({ type: 'session.updated', session: { id: 's1' } });
      });
      pushAudio();
      expect(ws.sent.filter((e) => e.type === 'input_audio_buffer.append')).toHaveLength(1);

      // during the reconnect backoff there is no session: chunks are dropped silently
      await act(async () => {
        ws.drop(1006);
      });
      pushAudio();
      pushAudio();
      const ws2 = FakeWebSocket.instances.at(-1)!;
      expect(ws2).toBe(ws); // still waiting for the retry
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      const fresh = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        fresh.open();
      });
      pushAudio();
      expect(fresh.sent.filter((e) => e.type === 'input_audio_buffer.append')).toHaveLength(0);
      await act(async () => {
        fresh.receive({ type: 'session.created', session: { id: 's2' } });
        fresh.receive({ type: 'session.updated', session: { id: 's2' } });
      });
      pushAudio();
      expect(fresh.sent.filter((e) => e.type === 'input_audio_buffer.append')).toHaveLength(1);
    } finally {
      restoreFakes();
    }
  });

  it('reconnects after a remote 1001 (service going away)', async () => {
    const { hook, ws } = await connectAndReady({
      ...baseConfig,
      reconnect: { initialDelayMs: 10, jitter: 0 },
    });
    await act(async () => {
      ws.close(1001, 'going away'); // clean, but sent by the service on restart
    });
    expect(hook.result.current.connectionState).toBe('reconnecting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const ws2 = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws2.open();
      ws2.receive({ type: 'session.created', session: { id: 's2' } });
      ws2.receive({ type: 'session.updated', session: { id: 's2' } });
    });
    expect(hook.result.current.connectionState).toBe('connected');
  });

  it('ignores an avatar offer that rejects after teardown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalCreateOffer = FakePeerConnection.prototype.createOffer;
    try {
      const hook = renderHook(() =>
        useVoiceLive({
          ...baseConfig,
          session: { instructions: 'Be nice.', avatar: { character: 'lisa', style: 'casual-sitting' } },
        })
      );
      await act(async () => {
        await hook.result.current.connect();
      });
      const ws = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        ws.open();
        ws.receive({ type: 'session.created', session: { id: 's1' } });
      });
      // make the offer fail, but only after the app has disconnected
      let failOffer: (err: Error) => void = () => undefined;
      FakePeerConnection.prototype.createOffer = () =>
        new Promise((_resolve, reject) => {
          failOffer = reject;
        }) as never;
      await act(async () => {
        ws.receive({
          type: 'session.updated',
          session: { id: 's1', avatar: { ice_servers: [{ urls: 'turn:relay.example' }] } },
        });
      });
      act(() => {
        hook.result.current.disconnect();
      });
      await act(async () => {
        failOffer(new Error('peer connection closed'));
        await Promise.resolve();
      });
      // the rejection belongs to a session that is gone — it must not surface as an error
      expect(hook.result.current.error).toBeNull();
      expect(hook.result.current.connectionState).toBe('disconnected');
    } finally {
      FakePeerConnection.prototype.createOffer = originalCreateOffer;
      errorSpy.mockRestore();
    }
  });

  it('keeps a pre-connect microphone acquisition (startMic before connect)', async () => {
    const { stream, track } = makeFakeMicStream();
    const restoreFakes = installBrowserFakes({ getUserMedia: async () => stream as unknown as MediaStream });
    try {
      const hook = renderHook(() =>
        useVoiceLive({
          ...baseConfig,
          connection: { resourceName: 'my-res', apiKey: 'secret', transport: 'webrtc' },
          autoStartMic: false,
        })
      );
      // A user gesture can arm the microphone before connecting; connect() then passes it as
      // localTrack, so the acquisition must survive having no connection yet
      await act(async () => {
        await hook.result.current.startMic();
      });
      expect(hook.result.current.isMicActive).toBe(true);
      expect(track.stop).not.toHaveBeenCalled();

      await act(async () => {
        await hook.result.current.connect();
      });
      const ws = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        ws.open();
      });
      await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());
      const pc = FakePeerConnection.instances.at(-1)!;
      // the pre-started track is the transceiver's track, not a late replaceTrack
      expect(pc.transceivers[0]!.kindOrTrack).toMatchObject({ kind: 'audio' });
      expect(hook.result.current.isMicActive).toBe(true);
    } finally {
      restoreFakes();
    }
  });

  it('does not let a send that never left the client block later turns', async () => {
    const { hook, ws } = await connectAndReady({
      ...baseConfig,
      reconnect: { initialDelayMs: 10, jitter: 0 },
    });
    await act(async () => {
      ws.drop(1006);
    });
    expect(hook.result.current.connectionState).toBe('reconnecting');
    // sending during backoff cannot reach the service — it must not occupy the response gate
    await act(async () => {
      hook.result.current.sendText('lost turn');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const ws2 = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws2.open();
      ws2.receive({ type: 'session.created', session: { id: 's2' } });
      ws2.receive({ type: 'session.updated', session: { id: 's2' } });
    });
    // the new session answers normally instead of queueing forever
    await act(async () => {
      hook.result.current.sendText('new turn');
    });
    expect(ws2.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
  });

  it('a stale tool batch does not evict the new session batch under the same response id', async () => {
    let resolveTool: (v: object) => void = () => undefined;
    const toolExecutor = vi.fn(
      () =>
        new Promise<object>((r) => {
          resolveTool = r;
        })
    );
    const { hook, ws } = await connectAndReady({
      ...baseConfig,
      toolExecutor,
      reconnect: { initialDelayMs: 10, jitter: 0 },
    });
    // session A: a tool call for response id "resp-1" that never settles before the drop
    await act(async () => {
      ws.receive({ type: 'response.created', response: { id: 'resp-1' } });
      ws.receive({
        type: 'response.function_call_arguments.done',
        response_id: 'resp-1',
        call_id: 'call-a',
        name: 'slow',
        arguments: '{}',
      });
      ws.drop(1006);
      await vi.advanceTimersByTimeAsync(10);
    });
    const ws2 = FakeWebSocket.instances.at(-1)!;
    await act(async () => {
      ws2.open();
      ws2.receive({ type: 'session.created', session: { id: 's2' } });
      ws2.receive({ type: 'session.updated', session: { id: 's2' } });
    });
    // session B reuses the same (per-session) response id and has its own tool call
    let resolveB: (v: object) => void = () => undefined;
    toolExecutor.mockImplementationOnce(
      () =>
        new Promise<object>((r) => {
          resolveB = r;
        })
    );
    await act(async () => {
      ws2.receive({ type: 'response.created', response: { id: 'resp-1' } });
      ws2.receive({
        type: 'response.function_call_arguments.done',
        response_id: 'resp-1',
        call_id: 'call-b',
        name: 'slow',
        arguments: '{}',
      });
      ws2.receive({ type: 'response.done', response: { id: 'resp-1' } });
    });
    // the stale executor from session A settles now — it must not delete session B's batch
    await act(async () => {
      resolveTool({ ok: 'stale' });
    });
    await act(async () => {
      resolveB({ ok: 'fresh' });
    });
    const outputs = ws2.sent.filter((e) => e.type === 'conversation.item.create');
    expect(outputs).toHaveLength(1);
    expect(outputs[0].item.call_id).toBe('call-b');
    // B's follow-up response still happens
    expect(ws2.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
    expect(hook.result.current.isReady).toBe(true);
  });

  it('stops the microphone when a close settles terminally (no reconnect)', async () => {
    const { stream, track } = makeFakeMicStream();
    const restoreFakes = installBrowserFakes({ getUserMedia: async () => stream as unknown as MediaStream });
    try {
      const hook = renderHook(() =>
        useVoiceLive({
          ...baseConfig,
          connection: { resourceName: 'my-res', apiKey: 'secret', transport: 'webrtc' },
          autoStartMic: true,
        })
      );
      await act(async () => {
        await hook.result.current.connect();
      });
      const ws = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        ws.open();
      });
      await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());
      const pc = FakePeerConnection.instances.at(-1)!;
      await act(async () => {
        pc.setConnectionState('connected');
        pc.dataChannels[0]!.open();
      });
      await vi.waitFor(() => expect(hook.result.current.isMicActive).toBe(true));

      // reconnect is disabled, so this close is the end of the connection
      await act(async () => {
        ws.drop(1006);
      });
      expect(hook.result.current.connectionState).toBe('disconnected');
      // leaving the track live would keep the browser's recording indicator on
      expect(track.stop).toHaveBeenCalled();
      expect(hook.result.current.isMicActive).toBe(false);
    } finally {
      restoreFakes();
    }
  });

  it('keeps the microphone across reconnect attempts but releases it when they are exhausted', async () => {
    const { stream, track } = makeFakeMicStream();
    const restoreFakes = installBrowserFakes({ getUserMedia: async () => stream as unknown as MediaStream });
    try {
      const hook = renderHook(() =>
        useVoiceLive({
          ...baseConfig,
          connection: { resourceName: 'my-res', apiKey: 'secret', transport: 'webrtc' },
          autoStartMic: true,
          reconnect: { initialDelayMs: 10, jitter: 0, maxAttempts: 1 },
        })
      );
      await act(async () => {
        await hook.result.current.connect();
      });
      const ws = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        ws.open();
      });
      await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());
      const pc = FakePeerConnection.instances.at(-1)!;
      await act(async () => {
        pc.setConnectionState('connected');
        pc.dataChannels[0]!.open();
      });
      await vi.waitFor(() => expect(hook.result.current.isMicActive).toBe(true));

      await act(async () => {
        ws.drop(1006);
      });
      // during backoff the microphone is deliberately kept (it belongs to the connection)
      expect(hook.result.current.connectionState).toBe('reconnecting');
      expect(track.stop).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      const ws2 = FakeWebSocket.instances.at(-1)!;
      await act(async () => {
        ws2.open();
        ws2.drop(1006); // the only allowed attempt fails
      });
      expect(hook.result.current.connectionState).toBe('error');
      expect(track.stop).toHaveBeenCalled();
      expect(hook.result.current.isMicActive).toBe(false);
    } finally {
      restoreFakes();
    }
  });

  it('createResponse() is serialized like every other turn', async () => {
    const { hook, ws } = await connectAndReady(baseConfig);
    await act(async () => {
      hook.result.current.createResponse();
      hook.result.current.createResponse(); // a second one must be queued, not sent
    });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
    await act(async () => {
      ws.receive({ type: 'response.created', response: { id: 'r1' } });
      ws.receive({ type: 'response.done', response: { id: 'r1' } });
    });
    expect(ws.sent.filter((e) => e.type === 'response.create')).toHaveLength(2);
  });
});
