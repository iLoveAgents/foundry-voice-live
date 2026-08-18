/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketTransport } from './websocketTransport';
import {
  WebRtcTransport,
  RTC_NEGOTIATION_TIMEOUT_CLOSE_CODE,
  RTC_SDP_ANSWER_FAILED_CLOSE_CODE,
  RTC_CALL_ERROR_CLOSE_CODE,
  RTC_MEDIA_FAILED_CLOSE_CODE,
  CONTROL_CHANNEL_SETUP_FAILED_CLOSE_CODE,
} from './webrtcTransport';
import type { TransportCallbacks } from './types';
import { FakeWebSocket, FakePeerConnection, installBrowserFakes } from '../../hooks/testFakes';

function makeCallbacks(): TransportCallbacks & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onOpen: vi.fn(),
    onEvent: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
    onReady: vi.fn(),
    onRemoteStream: vi.fn(),
  } as any;
}

let restore: () => void;
beforeEach(() => {
  restore = installBrowserFakes();
});
afterEach(() => {
  restore();
  vi.useRealTimers();
});

describe('WebSocketTransport', () => {
  it('reports terminally when the socket cannot be constructed', () => {
    const cb = makeCallbacks();
    const t = new WebSocketTransport(cb, {
      createWebSocket: () => {
        throw new SyntaxError('bad url');
      },
    });
    t.connect('not a url');
    // no handlers will ever fire, so a silent return would hang the caller forever
    expect(cb.onError).toHaveBeenCalledWith(expect.stringMatching(/Failed to open the WebSocket/), expect.anything());
    expect(cb.onClose).toHaveBeenCalledWith({
      code: CONTROL_CHANNEL_SETUP_FAILED_CLOSE_CODE,
      reason: expect.stringMatching(/Failed to open the WebSocket/),
      wasClean: false,
    });
    expect(t.state).toBe('closed');
  });

  it('reports open, parsed events and close', () => {
    const cb = makeCallbacks();
    const t = new WebSocketTransport(cb);
    expect(t.state).toBe('idle');
    t.connect('wss://x/voice-live/realtime?api-version=1');
    expect(t.state).toBe('connecting');
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    expect(t.state).toBe('open');
    expect(cb.onOpen).toHaveBeenCalledTimes(1);

    ws.receive({ type: 'session.created', session: { id: 's1' } });
    expect(cb.onEvent).toHaveBeenCalledWith({ type: 'session.created', session: { id: 's1' } });

    ws.onmessage?.({ data: 'not json' });
    expect(cb.onEvent).toHaveBeenCalledTimes(1);

    expect(t.send(JSON.stringify({ type: 'response.create' }))).toBe(true);
    expect(ws.lastSent('response.create')).toBeTruthy();

    ws.drop(1006);
    expect(t.state).toBe('closed');
    expect(cb.onClose).toHaveBeenCalledWith({ code: 1006, reason: '', wasClean: false });
  });

  it('send() returns false before open and close() is silent', () => {
    const cb = makeCallbacks();
    const t = new WebSocketTransport(cb);
    t.connect('wss://x');
    expect(t.send('{}')).toBe(false);
    const ws = FakeWebSocket.instances[0]!;
    ws.fail();
    expect(cb.onError).toHaveBeenCalledWith('WebSocket connection error', expect.anything());
    // connecting again while a socket exists is a programming error
    expect(() => t.connect('wss://y')).toThrow(/create a new transport/);
    t.close();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(cb.onClose).not.toHaveBeenCalled();
    expect(t.state).toBe('closed');
  });
});

describe('WebRtcTransport', () => {
  const session = { modalities: ['audio'] };

  async function openNegotiated(cb = makeCallbacks(), options: ConstructorParameters<typeof WebRtcTransport>[1] = {}) {
    const t = new WebRtcTransport(cb, options);
    t.connect('wss://x/voice-live/realtime/calls?api-version=p', session);
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    // ws.onopen awaits the offer promise (microtasks)
    await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());
    const pc = FakePeerConnection.instances.at(-1)!;
    return { t, ws, pc, cb };
  }

  it('sends rtc.call.sdp.create with the session on open and applies the answer', async () => {
    const { t, ws, pc, cb } = await openNegotiated();
    expect(t.kind).toBe('webrtc');
    const create = ws.lastSent('rtc.call.sdp.create');
    expect(create.sdp_offer).toBe('v=0 offer');
    expect(create.session).toEqual(session);
    expect(cb.onOpen).toHaveBeenCalledTimes(1);

    ws.receive({ type: 'rtc.call.sdp.created', event_id: 'e1', sdp_answer: 'v=0 answer' });
    await vi.waitFor(() => expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' }));
    // negotiation events are still forwarded to the caller
    expect(cb.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'rtc.call.sdp.created' }));
  });

  it('announces readiness only when media is connected AND the data channel is open', async () => {
    const { pc, cb } = await openNegotiated();
    const dc = pc.dataChannels[0]!;
    pc.setConnectionState('connected');
    expect(cb.onReady).not.toHaveBeenCalled();
    dc.open();
    expect(cb.onReady).toHaveBeenCalledWith('media + data channel');
    // idempotent
    pc.setConnectionState('connected');
    expect(cb.onReady).toHaveBeenCalledTimes(1);
  });

  it('does not announce readiness off a media path that dropped before it started', async () => {
    vi.useFakeTimers();
    const { pc, cb } = await openNegotiated(makeCallbacks(), { dataChannelFallbackMs: 100 });
    pc.setConnectionState('connected');
    // a transient outage before the events channel ever opened
    pc.setConnectionState('disconnected');
    await vi.advanceTimersByTimeAsync(200);
    expect(cb.onReady).not.toHaveBeenCalled();

    // a data channel opening while media is down must not announce readiness either
    pc.dataChannels[0]!.open();
    expect(cb.onReady).not.toHaveBeenCalled();

    // ...and readiness follows once media is actually back
    pc.setConnectionState('connected');
    expect(cb.onReady).toHaveBeenCalledWith('media + data channel');
  });

  it('completes terminal cleanup even when the consumer onError throws', async () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    (cb.onError as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('consumer bug');
    });
    const { t, pc } = await openNegotiated(cb, { negotiationTimeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    // the close must still happen, or the caller could neither reconnect nor connect() again
    expect(cb.onClose).toHaveBeenCalledWith(
      expect.objectContaining({ code: RTC_NEGOTIATION_TIMEOUT_CLOSE_CODE, wasClean: false })
    );
    expect(t.state).toBe('closed');
    expect(pc.closed).toBe(true);
  });

  it('keeps a throwing onEvent from stranding the negotiation', async () => {
    const cb = makeCallbacks();
    (cb.onEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('consumer bug');
    });
    const { ws, pc } = await openNegotiated(cb);
    ws.receive({ type: 'rtc.call.sdp.created', event_id: 'e1', sdp_answer: 'v=0 answer' });
    // the answer must still be applied even though the consumer's handler threw
    await vi.waitFor(() => expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' }));
  });

  it('falls back to media-only readiness when the data channel never opens', async () => {
    vi.useFakeTimers();
    const { pc, cb } = await openNegotiated(makeCallbacks(), { dataChannelFallbackMs: 100 });
    pc.setConnectionState('connected');
    expect(cb.onReady).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(cb.onReady).toHaveBeenCalledWith('media only');
  });

  it('de-duplicates events delivered on both channels and delivers data-channel events', async () => {
    const { ws, pc, cb } = await openNegotiated();
    const dc = pc.dataChannels[0]!;
    dc.receive({ type: 'input_audio_buffer.speech_started', event_id: 'dup' });
    ws.receive({ type: 'input_audio_buffer.speech_started', event_id: 'dup' });
    dc.receive({ type: 'response.done', event_id: 'other' });
    const types = (cb.onEvent as any).mock.calls.map((c: any[]) => c[0].type);
    expect(types.filter((x: string) => x === 'input_audio_buffer.speech_started')).toHaveLength(1);
    expect(types).toContain('response.done');
  });

  it('exposes the remote stream and treats a media failure as terminal', async () => {
    const { t, pc, cb } = await openNegotiated();
    pc.emitRemoteTrack({ id: 'remote', getAudioTracks: () => [] });
    expect(cb.onRemoteStream).toHaveBeenCalledWith(expect.objectContaining({ id: 'remote' }));

    // 'disconnected' can recover on its own — it must NOT tear the session down
    pc.setConnectionState('disconnected');
    expect(cb.onClose).not.toHaveBeenCalled();
    expect(t.state).toBe('open');

    // 'failed' is terminal (network change / NAT rebind mid-call): close so the caller can retry
    pc.setConnectionState('failed');
    expect(cb.onError).toHaveBeenCalledWith(expect.stringMatching(/UDP may be blocked/));
    expect(cb.onClose).toHaveBeenCalledWith({
      code: RTC_MEDIA_FAILED_CLOSE_CODE,
      reason: expect.stringMatching(/UDP may be blocked/),
      wasClean: false,
    });
    expect(t.state).toBe('closed');
  });

  it('treats rtc.call.error as terminal: reports it, tears down and closes so the caller can retry', async () => {
    const { t, ws, pc, cb } = await openNegotiated();
    ws.receive({ type: 'rtc.call.error', event_id: 'err', error: { code: 'session_error', message: 'bad sdp' } });
    // the consumer must still receive the event itself (with operation/rtc_call_id/details),
    // which means dispatching it before the teardown that follows
    expect(cb.onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'rtc.call.error' }));
    expect(cb.onError).toHaveBeenCalledWith(expect.stringMatching(/session_error: bad sdp/), expect.anything());
    expect(pc.closed).toBe(true);
    // The service rejected the call: leaving the transport 'open' would block both reconnect
    // and a fresh connect()
    expect(cb.onClose).toHaveBeenCalledWith({
      code: RTC_CALL_ERROR_CLOSE_CODE,
      reason: expect.stringMatching(/session_error: bad sdp/),
      wasClean: false,
    });
    expect(t.state).toBe('closed');
  });

  it('times out waiting for the SDP answer: error + unclean close, and a late answer is ignored', async () => {
    vi.useFakeTimers();
    const { t, ws, pc, cb } = await openNegotiated(makeCallbacks(), { negotiationTimeoutMs: 50 });
    vi.advanceTimersByTime(50);
    expect(cb.onError).toHaveBeenCalledWith('Timed out waiting for the WebRTC SDP answer');
    expect(cb.onClose).toHaveBeenCalledWith({
      code: RTC_NEGOTIATION_TIMEOUT_CLOSE_CODE,
      reason: expect.stringMatching(/timeout/),
      wasClean: false,
    });
    expect(t.state).toBe('closed');
    expect(pc.closed).toBe(true);
    // handlers are detached: a late answer does nothing
    ws.receive({ type: 'rtc.call.sdp.created', sdp_answer: 'late' });
    expect(pc.remoteDescription).toBeNull();
  });

  it('closes the transport when the SDP answer cannot be applied (so the caller can reconnect)', async () => {
    const { t, ws, pc, cb } = await openNegotiated();
    pc.setRemoteDescription = async () => {
      throw new Error('incompatible SDP');
    };
    ws.receive({ type: 'rtc.call.sdp.created', event_id: 'e1', sdp_answer: 'v=0 broken' });

    await vi.waitFor(() =>
      expect(cb.onError).toHaveBeenCalledWith('Failed to apply WebRTC SDP answer', expect.anything())
    );
    // Without the close the state would stay 'open' → connect() refused and no reconnect
    expect(cb.onClose).toHaveBeenCalledWith({
      code: RTC_SDP_ANSWER_FAILED_CLOSE_CODE,
      reason: 'Failed to apply WebRTC SDP answer',
      wasClean: false,
    });
    expect(t.state).toBe('closed');
    expect(pc.closed).toBe(true);
  });

  it('queues events sent before the call exists and flushes them after rtc.call.sdp.create', async () => {
    const cb = makeCallbacks();
    const t = new WebRtcTransport(cb, {});
    // the contract says events may be sent once onOpen fires — for WebRTC the call does not exist
    // until the offer is negotiated, so they must be held rather than sent into nothing
    (cb.onOpen as ReturnType<typeof vi.fn>).mockImplementation(() => {
      t.send(JSON.stringify({ type: 'session.update', session: {} }));
    });
    t.connect('wss://x/calls', { modalities: ['audio'] });
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    expect(ws.sent).toHaveLength(0); // nothing before the offer

    await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());
    // ...and the queued event follows it, in order
    expect(ws.sent.map((e) => e.type)).toEqual(['rtc.call.sdp.create', 'session.update']);
  });

  it('stops handling an event when the consumer closes the transport from onEvent', async () => {
    const cb = makeCallbacks();
    const { t, ws, pc } = await openNegotiated(cb);
    (cb.onEvent as ReturnType<typeof vi.fn>).mockImplementation((event: { type: string }) => {
      if (event.type === 'rtc.call.error') t.close();
    });
    const closesBefore = (cb.onClose as ReturnType<typeof vi.fn>).mock.calls.length;
    ws.receive({ type: 'rtc.call.error', event_id: 'e', error: { code: 'x', message: 'nope' } });

    // close() promises no further callbacks, so the terminal handling must not run afterwards
    expect((cb.onClose as ReturnType<typeof vi.fn>).mock.calls.length).toBe(closesBefore);
    expect(t.state).toBe('closed');
    expect(pc.closed).toBe(true);
  });

  it('attaches the microphone track once the transceiver exists (before and after negotiation)', async () => {
    const cb = makeCallbacks();
    const t = new WebRtcTransport(cb);
    t.connect('wss://x/calls', session);
    const early = { kind: 'audio' } as any;
    // requested before the transceiver exists: the promise stays open until it is really attached,
    // so the caller cannot report a live microphone that is not sending anything
    let attached = false;
    const earlyAttach = t.setMicrophoneTrack(early).then(() => {
      attached = true;
    });
    await Promise.resolve();
    expect(attached).toBe(false);

    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    await vi.waitFor(() => expect(ws.lastSent('rtc.call.sdp.create')).toBeTruthy());
    const pc = FakePeerConnection.instances.at(-1)!;
    const sender = pc.transceivers[0]!.sender;
    await earlyAttach;
    expect(sender.replaceTrack).toHaveBeenCalledWith(early);

    const late = { kind: 'audio', id: 'late' } as any;
    await t.setMicrophoneTrack(late);
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(late);
    await t.setMicrophoneTrack(null);
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(null);
  });

  it('reports a deferred microphone attachment that fails, instead of resolving optimistically', async () => {
    const cb = makeCallbacks();
    const t = new WebRtcTransport(cb, {
      createPeerConnection: () => {
        const pc = new FakePeerConnection();
        const transceiver = { sender: { replaceTrack: vi.fn(async () => { throw new Error('device gone'); }) } };
        pc.addTransceiver = () => transceiver as never;
        return pc as unknown as RTCPeerConnection;
      },
    });
    t.connect('wss://x/calls', {});
    const attach = t.setMicrophoneTrack({ kind: 'audio' } as never);
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    await expect(attach).rejects.toThrow('device gone');
  });

  it('settles a pending microphone attachment when the transport closes first', async () => {
    const cb = makeCallbacks();
    const t = new WebRtcTransport(cb);
    t.connect('wss://x/calls', {});
    const attach = t.setMicrophoneTrack({ kind: 'audio' } as never);
    t.close();
    await expect(attach).rejects.toThrow(/closed before the microphone was attached/);
  });

  it('close() detaches everything without firing onClose; a control-channel drop closes media', async () => {
    const first = await openNegotiated();
    first.t.close();
    expect(first.pc.closed).toBe(true);
    expect(first.pc.dataChannels[0]!.closed).toBe(true);
    expect(first.cb.onClose).not.toHaveBeenCalled();
    expect(first.t.send('{}')).toBe(false);

    const second = await openNegotiated();
    second.ws.drop(1006, 'gone');
    expect(second.pc.closed).toBe(true);
    expect(second.cb.onClose).toHaveBeenCalledWith({ code: 1006, reason: 'gone', wasClean: false });
  });

  it('does not leave a peer connection behind when offer creation fails', async () => {
    const cb = makeCallbacks();
    let created: FakePeerConnection | null = null;
    const t = new WebRtcTransport(cb, {
      createPeerConnection: () => {
        created = new FakePeerConnection();
        created.createOffer = async () => {
          throw new Error('createOffer failed');
        };
        return created as unknown as RTCPeerConnection;
      },
    });
    t.connect('wss://x/calls', {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    await vi.waitFor(() => expect(cb.onError).toHaveBeenCalled());
    // the caller never receives a handle for a failed offer, so createWebRtcOffer must clean up
    expect(created!.closed).toBe(true);
    expect(created!.dataChannels[0]!.closed).toBe(true);
  });

  it('invalidates an in-flight negotiation when the control socket closes first', async () => {
    vi.useFakeTimers();
    const cb = makeCallbacks();
    let releaseGathering: () => void = () => undefined;
    const t = new WebRtcTransport(cb, {
      negotiationTimeoutMs: 50,
      createPeerConnection: () => {
        const pc = new FakePeerConnection();
        pc.iceGatheringState = 'gathering';
        // hold ICE gathering open so the offer is still pending when the socket closes
        pc.addEventListener = ((type: string, listener: () => void) => {
          if (type === 'icegatheringstatechange') {
            releaseGathering = () => {
              pc.iceGatheringState = 'complete';
              listener();
            };
          }
        }) as never;
        return pc as unknown as RTCPeerConnection;
      },
    });
    t.connect('wss://x/calls', {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.drop(1006); // control channel dies while the offer is still gathering
    expect(cb.onClose).toHaveBeenCalledTimes(1);

    releaseGathering();
    await vi.advanceTimersByTimeAsync(200);
    // the stale continuation must not send SDP on the dead socket, nor arm a negotiation timer
    expect(ws.lastSent('rtc.call.sdp.create')).toBeUndefined();
    expect(cb.onClose).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalledWith('Timed out waiting for the WebRTC SDP answer');
  });

  it('stays silent when a pending offer rejects after the control socket closed', async () => {
    const cb = makeCallbacks();
    let failOffer: (err: Error) => void = () => undefined;
    const t = new WebRtcTransport(cb, {
      createPeerConnection: () => {
        const pc = new FakePeerConnection();
        pc.createOffer = () =>
          new Promise((_resolve, reject) => {
            failOffer = reject;
          }) as never;
        return pc as unknown as RTCPeerConnection;
      },
    });
    t.connect('wss://x/calls', {});
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    ws.drop(1006); // the control channel dies first and reports it
    expect(cb.onClose).toHaveBeenCalledTimes(1);

    failOffer(new Error('peer connection closed'));
    await vi.waitFor(() => expect(cb.onClose).toHaveBeenCalledTimes(1));
    // the rejection is a consequence of that close, not a second failure
    expect(cb.onError).not.toHaveBeenCalledWith(
      expect.stringMatching(/Failed to create WebRTC offer/),
      expect.anything()
    );
  });

  it('reports terminally and releases the offer when the socket cannot be constructed', async () => {
    const cb = makeCallbacks();
    let pc: FakePeerConnection | null = null;
    const t = new WebRtcTransport(cb, {
      createWebSocket: () => {
        throw new SyntaxError("The URL 'not a url' is invalid");
      },
      createPeerConnection: () => {
        pc = new FakePeerConnection();
        return pc as unknown as RTCPeerConnection;
      },
    });
    t.connect('not a url', {});

    expect(cb.onError).toHaveBeenCalledWith(expect.stringMatching(/Failed to open the control channel/), expect.anything());
    expect(cb.onClose).toHaveBeenCalledWith({
      code: CONTROL_CHANNEL_SETUP_FAILED_CLOSE_CODE,
      reason: expect.stringMatching(/Failed to open the control channel/),
      wasClean: false,
    });
    expect(t.state).toBe('closed');
    // the offer started before the socket: it must not leave a peer connection behind
    await vi.waitFor(() => expect(pc!.closed).toBe(true));
  });

  it('reports offer failures as errors and closes the control channel', async () => {
    const cb = makeCallbacks();
    const t = new WebRtcTransport(cb, {
      createPeerConnection: () => {
        throw new Error('no webrtc here');
      },
    });
    t.connect('wss://x/calls', session);
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.open();
    await vi.waitFor(() =>
      expect(cb.onError).toHaveBeenCalledWith('Failed to create WebRTC offer: no webrtc here', expect.anything())
    );
    expect(cb.onClose).toHaveBeenCalled();
    expect(t.state).toBe('closed');
  });
});
