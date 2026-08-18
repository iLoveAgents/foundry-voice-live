/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * useVoiceLive — auto-reconnect, token provider and avatar plumbing (fake browser APIs)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceLive } from './useVoiceLive';
import { FakeWebSocket, FakePeerConnection, installBrowserFakes } from './testFakes';
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
});
