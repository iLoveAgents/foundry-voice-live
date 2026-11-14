import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceLiveWebRTCTransport, type VoiceLiveWebRTCTransportOptions } from './webRTCTransport';

class FakeChannel {
  readyState = 'connecting';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];
  send(value: string): void { this.sent.push(value); }
  close = vi.fn(() => { this.readyState = 'closed'; this.onclose?.(); });
  open(): void { this.readyState = 'open'; this.onopen?.(); }
  receive(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) }); }
}

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string, public protocols?: string[]) { FakeSocket.instances.push(this); }
  send(value: string): void { this.sent.push(value); }
  close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
  open(): void { this.readyState = 1; this.onopen?.(); }
  receive(value: unknown): void { this.onmessage?.({ data: JSON.stringify(value) }); }
}

class FakePeer extends EventTarget {
  static instances: FakePeer[] = [];
  static initialIceState = 'complete';
  connectionState = 'new';
  iceConnectionState = 'new';
  iceGatheringState = FakePeer.initialIceState;
  localDescription: RTCSessionDescriptionInit | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null = null;
  channel = new FakeChannel();
  sender = { replaceTrack: vi.fn().mockResolvedValue(undefined), getStats: vi.fn().mockResolvedValue(new Map()) };
  addTransceiver = vi.fn(() => ({ sender: this.sender }));
  createDataChannel = vi.fn(() => this.channel);
  createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' });
  setLocalDescription = vi.fn(async (offer: RTCSessionDescriptionInit) => { this.localDescription = offer; });
  setRemoteDescription = vi.fn().mockResolvedValue(undefined);
  close = vi.fn(() => { this.connectionState = 'closed'; this.onconnectionstatechange?.(); });
  constructor(public config?: RTCConfiguration) { super(); FakePeer.instances.push(this); }
  setState(state: string): void { this.connectionState = state; this.onconnectionstatechange?.(); }
  finishIce(): void { this.iceGatheringState = 'complete'; this.dispatchEvent(new Event('icegatheringstatechange')); }
}

interface FakeMedia {
  stream: MediaStream;
  track: MediaStreamTrack;
  stop: ReturnType<typeof vi.fn>;
}

function media(): FakeMedia {
  const track = { id: 'mic-track', label: 'Test microphone', muted: false, getSettings: () => ({ deviceId: 'device-1' }), kind: 'audio', enabled: true, readyState: 'live', stop: vi.fn() };
  track.stop.mockImplementation(() => { track.readyState = 'ended'; });
  return {
    track: track as unknown as MediaStreamTrack,
    stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream,
    stop: track.stop,
  };
}

const getUserMedia = vi.fn();
const transports: VoiceLiveWebRTCTransport[] = [];

function setup(overrides: Partial<VoiceLiveWebRTCTransportOptions> = {}): {
  transport: VoiceLiveWebRTCTransport;
  options: VoiceLiveWebRTCTransportOptions;
} {
  const options: VoiceLiveWebRTCTransportOptions = {
    url: 'wss://example.services.ai.azure.com/voice-live/realtime/calls?api-version=2026-07-15',
    session: { modalities: ['text', 'audio'], voice: { type: 'openai', name: 'alloy' } },
    autoStartMic: false,
    onEvent: vi.fn(), onAudioStream: vi.fn(), onStateChange: vi.fn(), onMicStateChange: vi.fn(),
    ...overrides,
  };
  const transport = new VoiceLiveWebRTCTransport(options);
  transports.push(transport);
  return { transport, options };
}

async function flush(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve(); }

async function begin(transport: VoiceLiveWebRTCTransport): Promise<{ connected: Promise<void>; socket: FakeSocket; peer: FakePeer }> {
  const connected = transport.connect();
  // Tests explicitly assert rejections; attach a handler before asynchronous failure paths run.
  void connected.catch(() => {});
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1]!;
  const peer = FakePeer.instances[FakePeer.instances.length - 1]!;
  socket.open();
  await flush();
  return { connected, socket, peer };
}

async function ready(transport: VoiceLiveWebRTCTransport): Promise<{ socket: FakeSocket; peer: FakePeer }> {
  const { connected, socket, peer } = await begin(transport);
  socket.receive({ type: 'rtc.call.sdp.created', sdp_answer: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' });
  peer.setState('connected');
  peer.channel.open();
  await connected;
  return { socket, peer };
}

beforeEach(() => {
  FakeSocket.instances = [];
  FakePeer.instances = [];
  FakePeer.initialIceState = 'complete';
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue(media().stream);
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('RTCPeerConnection', FakePeer);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  transports.splice(0).forEach((transport) => transport.disconnect());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('VoiceLiveWebRTCTransport', () => {
  it('uses the selected microphone on restart without renegotiating the session', async () => {
    const { transport } = setup();
    const { peer } = await ready(transport);
    await transport.startMic();
    transport.stopMic();
    getUserMedia.mockResolvedValue(media().stream);
    await transport.startMic({ deviceId: { exact: 'physical-mic' } });
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'physical-mic' } } });
    expect(peer.createOffer).toHaveBeenCalledOnce();
  });

  it('distinguishes a blocked source from the user mute state and reports sender statistics', async () => {
    const mic = media();
    Object.defineProperty(mic.track, 'muted', { value: true });
    getUserMedia.mockResolvedValue(mic.stream);
    const { transport } = setup();
    const { peer } = await ready(transport);
    await transport.startMic();
    peer.sender.getStats.mockResolvedValue(new Map([
      ['source', { type: 'media-source', kind: 'audio', trackIdentifier: 'mic-track', audioLevel: 0.2, totalAudioEnergy: 0.4 }],
      ['sender', { type: 'outbound-rtp', kind: 'audio', packetsSent: 15, bytesSent: 900 }],
    ]));
    expect(await transport.getMicrophoneStatus()).toMatchObject({
      deviceLabel: 'Test microphone', deviceId: 'device-1', sourceMuted: true,
      enabled: true, audioLevel: 0.2, totalAudioEnergy: 0.4, packetsSent: 15, bytesSent: 900,
    });
    transport.stopMic();
    expect(await transport.getMicrophoneStatus()).toBeNull();
  });

  it('clears microphone state when the browser ends the input track', async () => {
    const mic = media();
    getUserMedia.mockResolvedValue(mic.stream);
    const { transport, options } = setup();
    await ready(transport);
    await transport.startMic();
    mic.track.onended?.call(mic.track, new Event('ended'));
    expect(options.onMicStateChange).toHaveBeenLastCalledWith(false, false);
    expect(await transport.getMicrophoneStatus()).toBeNull();
  });

  it('negotiates RTP audio with a data channel before creating the SDP offer', async () => {
    const { transport, options } = setup({ rtcConfiguration: { iceServers: [{ urls: 'stun:example.com' }] } });
    const { connected, socket, peer } = await begin(transport);
    expect(peer.config).toEqual(options.rtcConfiguration);
    expect(socket.protocols).toEqual(['realtime']);
    expect(peer.addTransceiver).toHaveBeenCalledWith('audio', { direction: 'sendrecv' });
    expect(peer.createDataChannel).toHaveBeenCalledWith('voice-live-events');
    expect(peer.createDataChannel.mock.invocationCallOrder[0]).toBeLessThan(peer.createOffer.mock.invocationCallOrder[0]!);
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: 'rtc.call.sdp.create', sdp_offer: peer.localDescription!.sdp, session: options.session,
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    peer.setState('connected');
    peer.channel.open();
    expect(options.onStateChange).not.toHaveBeenCalledWith('connected');
    socket.receive({ type: 'session.created', session: { id: 'session' } });
    expect(options.onStateChange).not.toHaveBeenCalledWith('connected');
    socket.receive({ type: 'rtc.call.sdp.created', sdp_answer: 'v=0\r\n' });
    await connected;
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'v=0\r\n' });
    expect(options.onStateChange).toHaveBeenLastCalledWith('connected');
    expect(socket.sent).toHaveLength(1);
  });

  it('does not resolve connect until the event channel is open', async () => {
    const { transport, options } = setup();
    const { connected, socket, peer } = await begin(transport);
    socket.receive({ type: 'rtc.call.sdp.created', sdp_answer: 'v=0\r\n' });
    peer.setState('connected');
    await flush();
    expect(options.onStateChange).not.toHaveBeenCalledWith('connected');
    peer.channel.open();
    await connected;
    expect(options.onStateChange).toHaveBeenLastCalledWith('connected');
  });

  it('preserves command ordering across tool outputs, text, and response requests on WSS', async () => {
    const { transport } = setup();
    const { socket, peer } = await ready(transport);
    const session = { type: 'session.update', session: { instructions: 'Updated' } };
    const output = { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: 'call', output: '{}' } };
    const approval = { type: 'conversation.item.create', item: { type: 'mcp_approval_response', approve: true } };
    transport.sendEvent(session);
    transport.sendEvent(output);
    transport.sendEvent(approval);
    transport.sendEvent({ type: 'response.create' });
    transport.sendEvent({ type: 'input_text.delta', id: 'item', delta: 'Hi' });
    expect(socket.sent.slice(1).map((event) => JSON.parse(event))).toEqual([
      session, output, approval,
      { type: 'response.create' }, { type: 'input_text.delta', id: 'item', delta: 'Hi' },
    ]);
    expect(peer.channel.sent).toHaveLength(0);
    expect(() => transport.sendEvent({ type: 'input_audio_buffer.append', audio: 'AAAA' })).toThrow('RTP');
    expect(() => transport.sendEvent({ type: 'rtc.call.sdp.create' })).toThrow('managed');
  });

  it('deduplicates WS/DC events by event_id with bounded memory', async () => {
    const { transport, options } = setup();
    const { socket, peer } = await ready(transport);
    const event = { type: 'response.done', event_id: 'shared' };
    socket.receive(event);
    peer.channel.receive(event);
    expect(vi.mocked(options.onEvent).mock.calls.filter(([value]) => value.event_id === 'shared')).toHaveLength(1);
    for (let i = 0; i < 513; i++) socket.receive({ type: 'response.text.delta', event_id: `event_${i}`, delta: 'x' });
    peer.channel.receive(event);
    expect(vi.mocked(options.onEvent).mock.calls.filter(([value]) => value.event_id === 'shared')).toHaveLength(2);
    socket.receive({ type: 'response.text.delta', delta: 'x' });
    peer.channel.receive({ type: 'response.text.delta', delta: 'x' });
    expect(vi.mocked(options.onEvent).mock.calls.slice(-2)).toEqual([
      [{ type: 'response.text.delta', delta: 'x' }], [{ type: 'response.text.delta', delta: 'x' }],
    ]);
  });

  it('supports mic start, mute, stop, and restart without renegotiating', async () => {
    const mic = media();
    getUserMedia.mockResolvedValueOnce(mic.stream);
    const { transport, options } = setup({ audioConstraints: { echoCancellation: true } });
    const { peer } = await ready(transport);
    await transport.startMic();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true } });
    expect(peer.sender.replaceTrack).toHaveBeenCalledWith(mic.track);
    transport.toggleMute();
    expect(mic.track.enabled).toBe(false);
    expect(options.onMicStateChange).toHaveBeenLastCalledWith(true, true);
    transport.toggleMute();
    expect(mic.track.enabled).toBe(true);
    transport.stopMic();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(peer.sender.replaceTrack).toHaveBeenLastCalledWith(null);
    expect(options.onMicStateChange).toHaveBeenLastCalledWith(false, false);
    await transport.startMic();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(peer.createOffer).toHaveBeenCalledOnce();
  });

  it('acquires the microphone before SDP when autoStartMic is enabled', async () => {
    const mic = media();
    getUserMedia.mockResolvedValue(mic.stream);
    const { transport } = setup({ autoStartMic: true });
    const { peer } = await ready(transport);
    expect(peer.sender.replaceTrack).toHaveBeenCalledWith(mic.track);
    expect(peer.sender.replaceTrack.mock.invocationCallOrder[0]).toBeLessThan(peer.createOffer.mock.invocationCallOrder[0]!);
  });

  it('exposes RTP remote streams and releases local/remote media on disconnect', async () => {
    const mic = media();
    const remote = media();
    getUserMedia.mockResolvedValue(mic.stream);
    const { transport, options } = setup({ autoStartMic: true });
    const { peer, socket } = await ready(transport);
    peer.ontrack?.({ track: remote.track, streams: [remote.stream] });
    expect(options.onAudioStream).toHaveBeenLastCalledWith(remote.stream);
    transport.disconnect();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(remote.stop).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
    expect(peer.channel.close).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(options.onAudioStream).toHaveBeenLastCalledWith(null);
    expect(options.onStateChange).toHaveBeenLastCalledWith('disconnected');
    expect(() => transport.sendEvent({ type: 'response.create' })).toThrow('not connected');
  });

  it('waits for ICE completion before sending the offer', async () => {
    FakePeer.initialIceState = 'gathering';
    const { transport } = setup();
    const { socket, peer } = await begin(transport);
    expect(socket.sent).toHaveLength(0);
    peer.finishIce();
    await flush();
    expect(JSON.parse(socket.sent[0]!).type).toBe('rtc.call.sdp.create');
  });

  it('rejects ICE timeout and closes all channels', async () => {
    vi.useFakeTimers();
    FakePeer.initialIceState = 'gathering';
    const { transport, options } = setup({ iceGatheringTimeoutMs: 100, connectionTimeoutMs: 1000 });
    const { connected, socket, peer } = await begin(transport);
    await vi.advanceTimersByTimeAsync(100);
    await expect(connected).rejects.toThrow('ICE gathering timed out');
    expect(socket.close).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
    expect(options.onStateChange).toHaveBeenLastCalledWith('error', expect.any(Error));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out when signaling never opens and allows reconnecting the same instance', async () => {
    vi.useFakeTimers();
    const { transport } = setup({ connectionTimeoutMs: 100 });
    const first = transport.connect();
    void first.catch(() => {});
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).rejects.toThrow('connection timed out');
    await ready(transport);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, '', '   ', 123])('rejects malformed SDP answers (%s)', async (answer) => {
    const { transport } = setup();
    const { connected, socket, peer } = await begin(transport);
    socket.receive({ type: 'rtc.call.sdp.created', sdp_answer: answer });
    await expect(connected).rejects.toThrow('invalid WebRTC SDP');
    expect(peer.setRemoteDescription).not.toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('rejects SDP application errors and rtc.call.error', async () => {
    const first = setup();
    const firstCall = await begin(first.transport);
    firstCall.peer.setRemoteDescription.mockRejectedValueOnce(new Error('Invalid SDP syntax'));
    firstCall.socket.receive({ type: 'rtc.call.sdp.created', sdp_answer: 'bad SDP' });
    await expect(firstCall.connected).rejects.toThrow('Invalid SDP syntax');
    const second = setup();
    const secondCall = await begin(second.transport);
    secondCall.socket.receive({ type: 'rtc.call.error', error: { message: 'Unsupported model' } });
    await expect(secondCall.connected).rejects.toThrow('Unsupported model');
    expect(second.options.onEvent).toHaveBeenCalledWith({ type: 'rtc.call.error', error: { message: 'Unsupported model' } });
  });

  it.each(['peer', 'ice', 'channel-error', 'channel-close', 'socket-error', 'socket-close'])(
    'cleans up after %s failure after connection', async (failure) => {
      const { transport, options } = setup();
      const { socket, peer } = await ready(transport);
      if (failure === 'peer') peer.setState('failed');
      if (failure === 'ice') { peer.iceConnectionState = 'failed'; peer.oniceconnectionstatechange?.(); }
      if (failure === 'channel-error') peer.channel.onerror?.();
      if (failure === 'channel-close') peer.channel.onclose?.();
      if (failure === 'socket-error') socket.onerror?.();
      if (failure === 'socket-close') socket.onclose?.();
      expect(options.onStateChange).toHaveBeenLastCalledWith('error', expect.any(Error));
      expect(peer.close).toHaveBeenCalledOnce();
      expect(socket.close).toHaveBeenCalledOnce();
      expect(() => transport.sendEvent({ type: 'response.cancel' })).toThrow('not connected');
    },
  );

  it('stops microphone tracks returned after disconnect without touching a newer connection', async () => {
    const lateMic = media();
    let grant: (stream: MediaStream) => void = () => {};
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((resolve) => { grant = resolve; }));
    const { transport, options } = setup({ autoStartMic: true });
    const old = await begin(transport);
    transport.disconnect();
    await expect(old.connected).rejects.toThrow('canceled');
    const next = await ready(transport);
    grant(lateMic.stream);
    await flush();
    expect(lateMic.stop).toHaveBeenCalledOnce();
    expect(old.peer.sender.replaceTrack).not.toHaveBeenCalled();
    expect(next.peer.close).not.toHaveBeenCalled();
    expect(options.onStateChange).toHaveBeenLastCalledWith('connected');
  });

  it('cancels pending manual microphone requests when stopMic is called', async () => {
    const mic = media();
    let grant: (stream: MediaStream) => void = () => {};
    const { transport } = setup();
    const { peer } = await ready(transport);
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((resolve) => { grant = resolve; }));
    const pending = transport.startMic();
    transport.stopMic();
    grant(mic.stream);
    await expect(pending).rejects.toThrow('canceled');
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(peer.sender.replaceTrack).not.toHaveBeenCalledWith(mic.track);
  });

  it('ignores a stale SDP completion after disconnect and reconnect', async () => {
    const { transport, options } = setup();
    const old = await begin(transport);
    let applyAnswer: () => void = () => {};
    old.peer.setRemoteDescription.mockReturnValueOnce(new Promise<void>((resolve) => { applyAnswer = resolve; }));
    old.socket.receive({ type: 'rtc.call.sdp.created', sdp_answer: 'v=0\r\n' });
    transport.disconnect();
    await expect(old.connected).rejects.toThrow('canceled');
    const next = await ready(transport);
    const eventCount = vi.mocked(options.onEvent).mock.calls.length;
    applyAnswer();
    await flush();
    expect(vi.mocked(options.onEvent).mock.calls).toHaveLength(eventCount);
    expect(next.peer.close).not.toHaveBeenCalled();
  });

  it('rejects microphone denial during automatic setup', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
    const { transport } = setup({ autoStartMic: true });
    const { connected, peer, socket } = await begin(transport);
    await expect(connected).rejects.toThrow('Permission denied');
    expect(peer.close).toHaveBeenCalledOnce();
    expect(socket.sent).toHaveLength(0);
  });

  it('times out if the SDP succeeds but the data channel never opens', async () => {
    vi.useFakeTimers();
    const { transport } = setup({ connectionTimeoutMs: 100 });
    const { connected, socket, peer } = await begin(transport);
    socket.receive({ type: 'rtc.call.sdp.created', sdp_answer: 'v=0\r\n' });
    peer.setState('connected');
    await vi.advanceTimersByTimeAsync(100);
    await expect(connected).rejects.toThrow('connection timed out');
    expect(peer.channel.close).toHaveBeenCalledOnce();
  });

  it('recovers transient peer disconnections without opening a second connection', async () => {
    vi.useFakeTimers();
    const { transport, options } = setup({ connectionTimeoutMs: 100 });
    const { peer } = await ready(transport);
    peer.setState('disconnected');
    const recovery = transport.connect();
    expect(options.onStateChange).toHaveBeenLastCalledWith('connecting');
    expect(FakePeer.instances).toHaveLength(1);
    peer.setState('connected');
    await recovery;
    expect(options.onStateChange).toHaveBeenLastCalledWith('connected');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out transient peer recovery and cleans up media', async () => {
    vi.useFakeTimers();
    const mic = media();
    getUserMedia.mockResolvedValue(mic.stream);
    const { transport, options } = setup({ autoStartMic: true, connectionTimeoutMs: 100 });
    const { peer } = await ready(transport);
    peer.setState('disconnected');
    await vi.advanceTimersByTimeAsync(100);
    expect(options.onStateChange).toHaveBeenLastCalledWith('error', expect.objectContaining({ message: expect.stringContaining('reconnection timed out') }));
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
  });

  it('cancels pending ICE gathering without sending a stale offer', async () => {
    vi.useFakeTimers();
    FakePeer.initialIceState = 'gathering';
    const { transport } = setup();
    const { connected, socket, peer } = await begin(transport);
    transport.disconnect();
    await expect(connected).rejects.toThrow('canceled');
    peer.finishIce();
    await flush();
    expect(socket.sent).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares concurrent microphone requests and releases a stream if attaching it fails', async () => {
    const mic = media();
    const { transport } = setup();
    const { peer } = await ready(transport);
    getUserMedia.mockResolvedValueOnce(mic.stream);
    peer.sender.replaceTrack.mockRejectedValueOnce(new Error('Cannot attach track'));
    const first = transport.startMic();
    const second = transport.startMic();
    expect(second).toBe(first);
    await expect(first).rejects.toThrow('Cannot attach track');
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(mic.stop).toHaveBeenCalledOnce();
    expect(peer.close).not.toHaveBeenCalled();
  });

  it('rejects avatars before creating signaling resources', async () => {
    const { transport } = setup({ session: { avatar: { character: 'lisa' } } });
    await expect(transport.connect()).rejects.toThrow('Avatar');
    expect(FakeSocket.instances).toHaveLength(0);
    expect(FakePeer.instances).toHaveLength(0);
  });

  it.each([0, -1, NaN, Infinity, 2147483648])('rejects an invalid connection timeout (%s)', async (value) => {
    const { transport } = setup({ connectionTimeoutMs: value });
    await expect(transport.connect()).rejects.toThrow('connectionTimeoutMs must be a positive finite number');
    expect(FakePeer.instances).toHaveLength(0);
  });
});
