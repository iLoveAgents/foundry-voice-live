/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * Browser API fakes for hook tests (jsdom has no WebSocket server, WebRTC or Web Audio).
 * Test-only — not part of the published package.
 */
import { vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

export class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: any[] = [];
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: true });
  }

  /** Test helper: simulate the connection dropping (unclean close, e.g. network loss) */
  drop(code = 1006, reason = '') {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: false });
  }

  /** Test helper: simulate a socket error */
  fail(event: any = new Error('socket error')) {
    this.onerror?.(event);
  }

  /** Test helper: simulate the socket opening */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  /** Test helper: deliver a server event */
  receive(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  /** Test helper: last event sent of a given type */
  lastSent(type: string) {
    return [...this.sent].reverse().find((e) => e.type === type);
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
  gain = { value: 1 };
  fftSize = 0;
  smoothingTimeConstant = 0;
}

export class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  port = { postMessage: vi.fn(), onmessage: null as null | ((ev: any) => void) };
  connect = vi.fn();
  disconnect = vi.fn();
  constructor(
    public context: any,
    public name: string,
    public options?: any
  ) {
    FakeAudioWorkletNode.instances.push(this);
  }
  static reset() {
    FakeAudioWorkletNode.instances = [];
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'running';
  sampleRate = 48000;
  currentTime = 0;
  baseLatency = 0.01;
  destination = new FakeNode();
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  closed = false;
  mediaStreamSources: any[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createGain() {
    return new FakeNode() as any;
  }
  createAnalyser() {
    return new FakeNode() as any;
  }
  createMediaStreamDestination() {
    return { stream: { id: 'dest-stream' }, ...new FakeNode() } as any;
  }
  createMediaStreamSource(stream: any) {
    const node = { stream, ...new FakeNode() };
    this.mediaStreamSources.push(node);
    return node as any;
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.closed = true;
  }
  static reset() {
    FakeAudioContext.instances = [];
  }
}

export class FakeDataChannel {
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public label: string) {}
  close() {
    this.closed = true;
    this.onclose?.();
  }
  /** Test helper: simulate the channel opening */
  open() {
    this.onopen?.();
  }
  /** Test helper: deliver a data-channel event */
  receive(event: object) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

export class FakePeerConnection extends EventTarget {
  static instances: FakePeerConnection[] = [];
  iceGatheringState = 'complete';
  connectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  ontrack: ((ev: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  transceivers: Array<{ kindOrTrack: any; init: any; sender: { replaceTrack: any } }> = [];
  dataChannels: FakeDataChannel[] = [];
  closed = false;

  constructor(public configuration?: RTCConfiguration) {
    super();
    FakePeerConnection.instances.push(this);
  }
  addTransceiver(kindOrTrack: any, init?: any) {
    const t = { kindOrTrack, init, sender: { replaceTrack: vi.fn(async () => undefined) } };
    this.transceivers.push(t);
    return t as any;
  }
  createDataChannel(label: string) {
    const dc = new FakeDataChannel(label);
    this.dataChannels.push(dc);
    return dc as any;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' };
  }
  async setLocalDescription(desc: any) {
    this.localDescription = desc;
  }
  async setRemoteDescription(desc: any) {
    this.remoteDescription = desc;
  }
  close() {
    this.closed = true;
  }
  /** Test helper: move to a connection state and notify */
  setConnectionState(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  /** Test helper: deliver the remote audio track */
  emitRemoteTrack(stream: any = { id: 'remote-stream', getAudioTracks: () => [] }) {
    this.ontrack?.({ streams: [stream], track: { kind: 'audio' } });
  }
  static reset() {
    FakePeerConnection.instances = [];
  }
}

export function makeFakeMicStream() {
  const track = { kind: 'audio', enabled: true, stop: vi.fn() };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };
  return { stream, track };
}

/** Install all fakes on globalThis; returns a restore function */
export function installBrowserFakes(options: { getUserMedia?: () => Promise<any> } = {}) {
  FakeWebSocket.reset();
  FakeAudioContext.reset();
  FakePeerConnection.reset();

  FakeAudioWorkletNode.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
  vi.stubGlobal('MediaStream', class {
    tracks: any[];
    constructor(tracks: any[] = []) {
      this.tracks = tracks;
    }
    getTracks() {
      return this.tracks;
    }
    getAudioTracks() {
      return this.tracks;
    }
  });
  if (!(URL as any).createObjectURL) {
    (URL as any).createObjectURL = vi.fn(() => 'blob:fake');
    (URL as any).revokeObjectURL = vi.fn();
  }
  const getUserMedia = options.getUserMedia ?? (async () => makeFakeMicStream().stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  });

  return () => {
    vi.unstubAllGlobals();
  };
}
