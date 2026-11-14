/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createWebRtcOffer,
  waitForIceGathering,
  buildRtcSdpCreateEvent,
  applyRtcSdpAnswer,
  formatRtcCallError,
  closeWebRtc,
} from './webrtcTransport';
import { buildMicConstraints } from './audioHelpers';
import { VOICE_LIVE_DATA_CHANNEL } from './constants';

/** Minimal RTCPeerConnection stand-in (jsdom has no WebRTC) */
class FakePeerConnection extends EventTarget {
  iceGatheringState: RTCIceGatheringState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  ontrack: ((ev: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  transceivers: Array<{ kindOrTrack: unknown; init: RTCRtpTransceiverInit | undefined }> = [];
  dataChannels: FakeDataChannel[] = [];
  remote: { type: string; sdp: string } | null = null;
  closed = false;

  constructor(public configuration?: RTCConfiguration) {
    super();
  }
  addTransceiver(kindOrTrack: unknown, init?: RTCRtpTransceiverInit) {
    const t = { kindOrTrack, init, sender: { replaceTrack: vi.fn() } };
    this.transceivers.push(t);
    return t as unknown as RTCRtpTransceiver;
  }
  createDataChannel(label: string) {
    const dc = new FakeDataChannel(label);
    this.dataChannels.push(dc);
    return dc as unknown as RTCDataChannel;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' } as RTCSessionDescriptionInit;
  }
  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = { type: desc.type as string, sdp: desc.sdp as string };
  }
  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.remote = { type: desc.type as string, sdp: desc.sdp as string };
  }
  close() {
    this.closed = true;
  }
  completeIce() {
    this.iceGatheringState = 'complete';
    this.dispatchEvent(new Event('icegatheringstatechange'));
  }
}

class FakeDataChannel {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  closed = false;
  constructor(public label: string) {}
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForIceGathering', () => {
  it('resolves immediately when gathering is already complete', async () => {
    const pc = new FakePeerConnection();
    pc.iceGatheringState = 'complete';
    await expect(waitForIceGathering(pc as unknown as RTCPeerConnection)).resolves.toBeUndefined();
  });

  it('resolves when the state changes to complete', async () => {
    const pc = new FakePeerConnection();
    const p = waitForIceGathering(pc as unknown as RTCPeerConnection, 10_000);
    pc.completeIce();
    await expect(p).resolves.toBeUndefined();
  });

  it('resolves after the timeout even if gathering never completes', async () => {
    vi.useFakeTimers();
    const pc = new FakePeerConnection();
    const p = waitForIceGathering(pc as unknown as RTCPeerConnection, 3000);
    vi.advanceTimersByTime(3000);
    await expect(p).resolves.toBeUndefined();
  });
});

describe('createWebRtcOffer', () => {
  it('creates the data channel, a sendrecv audio transceiver and returns the SDP offer', async () => {
    const pc = new FakePeerConnection();
    const onRemoteStream = vi.fn();
    const onDataChannelMessage = vi.fn();
    const onConnectionStateChange = vi.fn();

    const p = createWebRtcOffer({
      rtcConfiguration: { iceServers: [] },
      onRemoteStream,
      onDataChannelMessage,
      onConnectionStateChange,
      createPeerConnection: (cfg) => {
        expect(cfg).toEqual({ iceServers: [] });
        return pc as unknown as RTCPeerConnection;
      },
    });
    pc.completeIce();
    const { handle, sdpOffer } = await p;

    expect(sdpOffer).toBe('v=0 offer');
    expect(handle.pc).toBe(pc);
    expect(pc.dataChannels[0]?.label).toBe(VOICE_LIVE_DATA_CHANNEL);
    expect(pc.transceivers[0]).toMatchObject({
      kindOrTrack: 'audio',
      init: { direction: 'sendrecv' },
    });

    // Data channel messages and connection state changes are forwarded
    pc.dataChannels[0]!.onmessage!({ data: '{"type":"response.created"}' } as MessageEvent);
    expect(onDataChannelMessage).toHaveBeenCalledWith('{"type":"response.created"}');
    pc.connectionState = 'connected';
    pc.onconnectionstatechange!();
    expect(onConnectionStateChange).toHaveBeenCalledWith('connected');

    // Remote track → stream
    const stream = { id: 'remote' } as unknown as MediaStream;
    pc.ontrack!({ streams: [stream], track: {} } as unknown as RTCTrackEvent);
    expect(onRemoteStream).toHaveBeenCalledWith(stream);
  });

  it('adds the local track when provided', async () => {
    const pc = new FakePeerConnection();
    pc.iceGatheringState = 'complete';
    const track = { kind: 'audio' } as unknown as MediaStreamTrack;
    await createWebRtcOffer({
      localTrack: track,
      onRemoteStream: vi.fn(),
      onDataChannelMessage: vi.fn(),
      onConnectionStateChange: vi.fn(),
      createPeerConnection: () => pc as unknown as RTCPeerConnection,
    });
    expect(pc.transceivers[0]?.kindOrTrack).toBe(track);
  });
});

describe('message helpers', () => {
  it('buildRtcSdpCreateEvent has the exact wire shape', () => {
    expect(buildRtcSdpCreateEvent('sdp', { modalities: ['text', 'audio'] })).toEqual({
      type: 'rtc.call.sdp.create',
      sdp_offer: 'sdp',
      session: { modalities: ['text', 'audio'] },
    });
    expect(buildRtcSdpCreateEvent('sdp')).toEqual({
      type: 'rtc.call.sdp.create',
      sdp_offer: 'sdp',
    });
  });

  it('applyRtcSdpAnswer sets the remote answer', async () => {
    const pc = new FakePeerConnection();
    await applyRtcSdpAnswer(pc as unknown as RTCPeerConnection, 'v=0 answer');
    expect(pc.remote).toEqual({ type: 'answer', sdp: 'v=0 answer' });
  });

  it('formatRtcCallError includes code, message and operation', () => {
    expect(
      formatRtcCallError({
        type: 'rtc.call.error',
        operation: 'rtc.call.sdp.create',
        error: {
          type: 'invalid_request_error',
          code: 'missing_sdp',
          message: 'SDP offer is required',
        },
      })
    ).toBe(
      'WebRTC call error — missing_sdp: SDP offer is required (operation: rtc.call.sdp.create)'
    );
  });

  it('buildMicConstraints merges overrides onto sane defaults', () => {
    expect(buildMicConstraints()).toEqual({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    expect(buildMicConstraints(true)).toEqual(buildMicConstraints());
    expect(buildMicConstraints({ deviceId: 'mic-1', echoCancellation: false })).toEqual({
      audio: {
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        deviceId: 'mic-1',
      },
    });
    expect(buildMicConstraints(undefined, 24000).audio).toMatchObject({
      sampleRate: 24000,
      channelCount: 1,
    });
  });

  it('closeWebRtc stops tracks and closes channel + peer connection', () => {
    const pc = new FakePeerConnection();
    const dc = pc.createDataChannel('x') as unknown as FakeDataChannel;
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    closeWebRtc(
      {
        pc: pc as unknown as RTCPeerConnection,
        dataChannel: dc as unknown as RTCDataChannel,
        audioTransceiver: {} as RTCRtpTransceiver,
      },
      stream
    );
    expect(stop).toHaveBeenCalled();
    expect(dc.closed).toBe(true);
    expect(pc.closed).toBe(true);
    // tolerant of null handle
    expect(() => closeWebRtc(null, stream)).not.toThrow();
  });
});
