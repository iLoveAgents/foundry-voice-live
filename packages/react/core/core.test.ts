/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutputAudioGraph, PcmPlayer } from './audioOutput';
import { AvatarConnection, encodeAvatarSdp, decodeAvatarSdp } from './avatarConnection';
import { WebRtcMicrophone } from './microphone';
import {
  resolveReconnectOptions,
  computeBackoffDelay,
  isReconnectableClose,
  DEFAULT_RECONNECT_OPTIONS,
} from './reconnect';
import { parseServerEvent, SeenEventIds } from './serverEvents';
import {
  FakeAudioContext,
  FakeAudioWorkletNode,
  FakePeerConnection,
  installBrowserFakes,
  makeFakeMicStream,
} from '../hooks/testFakes';

let restore: () => void;
beforeEach(() => {
  restore = installBrowserFakes();
});
afterEach(() => {
  restore();
});

describe('OutputAudioGraph', () => {
  it('creates the context lazily and reports creation once', () => {
    const graph = new OutputAudioGraph();
    expect(graph.context).toBeNull();
    expect(graph.ensure()).toBe(true);
    expect(graph.ensure()).toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(graph.gain).toBeTruthy();
    expect(graph.analyser).toBeTruthy();
    expect((graph.analyser as any).fftSize).toBe(256);
  });

  it('routes gain → destination + analyser once and exposes the stream', () => {
    const graph = new OutputAudioGraph();
    expect(graph.ensureDestination()).toBeNull(); // no context yet
    graph.ensure();
    const stream = graph.ensureDestination();
    expect(stream).toEqual({ id: 'dest-stream' });
    expect(graph.ensureDestination()).toBe(stream);
    expect((graph.gain as any).connect).toHaveBeenCalledTimes(2);
    expect(graph.destinationStream).toBe(stream);
  });

  it('attaches/detaches a remote stream to the analyser and resumes a suspended context', async () => {
    const graph = new OutputAudioGraph();
    graph.ensure();
    const ctx = FakeAudioContext.instances[0]!;
    ctx.state = 'suspended';
    const remote = { id: 'remote' } as any;
    graph.attachRemoteStream(remote);
    expect(ctx.mediaStreamSources[0]!.stream).toBe(remote);
    expect(ctx.mediaStreamSources[0]!.connect).toHaveBeenCalledWith(graph.analyser);
    await Promise.resolve();
    expect(ctx.state).toBe('running');
    graph.detachRemoteStream();
    expect(ctx.mediaStreamSources[0]!.disconnect).toHaveBeenCalled();
  });

  it('close() closes the context and forgets every node', () => {
    const graph = new OutputAudioGraph();
    graph.ensure();
    const ctx = FakeAudioContext.instances[0]!;
    graph.close();
    expect(ctx.closed).toBe(true);
    expect(graph.context).toBeNull();
    expect(graph.analyser).toBeNull();
    expect(graph.destinationStream).toBeNull();
  });
});

describe('PcmPlayer', () => {
  function pcm(bytes: number[]) {
    return btoa(String.fromCharCode(...bytes));
  }

  it('initializes the worklet on the first chunk, transfers PCM buffers and tracks playback time', async () => {
    const graph = new OutputAudioGraph();
    graph.ensure();
    const ctx = FakeAudioContext.instances[0]!;
    const player = new PcmPlayer(graph, { sourceSampleRate: 24000 });
    expect(player.playbackTimeMs()).toBeNull();

    ctx.currentTime = 1.5;
    await player.enqueue(pcm([1, 2, 3, 4]));
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith('blob:fake');
    const node = FakeAudioWorkletNode.instances[0]!;
    expect(node.name).toBe('audio-playback-processor');
    expect(node.options.processorOptions).toEqual({ sourceSampleRate: 24000 });
    expect(node.connect).toHaveBeenCalledWith(graph.gain);
    const [buffer, transfer] = node.port.postMessage.mock.calls[0]!;
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(transfer).toEqual([buffer]);

    ctx.currentTime = 2.0;
    expect(player.playbackTimeMs()).toBeCloseTo(500);
    // a new response resets the start marker until its first chunk
    player.markResponseStart();
    expect(player.playbackTimeMs()).toBeNull();
    ctx.currentTime = 3.0;
    await player.enqueue(pcm([9]));
    expect(player.playbackTimeMs()).toBe(0);
    // only one worklet even with two chunks
    expect(FakeAudioWorkletNode.instances).toHaveLength(1);
  });

  it('serializes concurrent first chunks into a single worklet init', async () => {
    const graph = new OutputAudioGraph();
    graph.ensure();
    const player = new PcmPlayer(graph, { sourceSampleRate: 24000 });
    await Promise.all([player.enqueue(pcm([1])), player.enqueue(pcm([2]))]);
    expect(FakeAudioWorkletNode.instances).toHaveLength(1);
    expect(FakeAudioWorkletNode.instances[0]!.port.postMessage).toHaveBeenCalledTimes(2);
  });

  it('stop() flushes the queue and dispose() releases the worklet and blob URL', async () => {
    const graph = new OutputAudioGraph();
    graph.ensure();
    const player = new PcmPlayer(graph, { sourceSampleRate: 24000 });
    player.stop(); // no worklet yet — no-op
    await player.enqueue(pcm([1]));
    const node = FakeAudioWorkletNode.instances[0]!;
    player.stop();
    expect(node.port.postMessage).toHaveBeenLastCalledWith(null);
    player.dispose();
    expect(node.disconnect).toHaveBeenCalled();
    expect((URL as any).revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    // after dispose, chunks are ignored
    await player.enqueue(pcm([2]));
    expect(FakeAudioWorkletNode.instances).toHaveLength(1);
  });

  it('drops chunks that were still decoding when the queue was flushed', async () => {
    const graph = new OutputAudioGraph();
    graph.ensure();
    const player = new PcmPlayer(graph, { sourceSampleRate: 24000 });
    await player.enqueue(pcm([1])); // initialize the worklet
    const node = FakeAudioWorkletNode.instances[0]!;
    node.port.postMessage.mockClear();

    // A chunk whose await is still pending when stop() runs (barge-in / reconnect flush) must not
    // be re-queued afterwards — that would play a stale fragment into the next turn
    const ctx = FakeAudioContext.instances[0]!;
    let resumed: () => void = () => undefined;
    ctx.state = 'suspended';
    ctx.resume = () =>
      new Promise<void>((resolve) => {
        resumed = () => {
          ctx.state = 'running';
          resolve();
        };
      });
    const pending = player.enqueue(pcm([2, 3]));
    player.stop();
    resumed();
    await pending;
    // only the flush message, no audio buffer
    expect(node.port.postMessage.mock.calls).toEqual([[null]]);

    // subsequent chunks play again
    await player.enqueue(pcm([4]));
    expect(node.port.postMessage.mock.calls.length).toBe(2);
  });

  it('does nothing without an audio context', async () => {
    const player = new PcmPlayer(new OutputAudioGraph(), { sourceSampleRate: 24000 });
    await player.enqueue(pcm([1]));
    expect(FakeAudioWorkletNode.instances).toHaveLength(0);
  });
});

describe('AvatarConnection', () => {
  it('creates a recvonly offer, encodes it, applies the server SDP and forwards tracks', async () => {
    const onVideoStream = vi.fn();
    const onAudioStream = vi.fn();
    const onError = vi.fn();
    const avatar = new AvatarConnection({ onVideoStream, onAudioStream, onError });
    const iceServers = [{ urls: 'turn:relay.example' }];
    const clientSdp = await avatar.createOffer(iceServers);
    const pc = FakePeerConnection.instances[0]!;
    expect(pc.configuration).toEqual({ iceServers });
    expect(pc.transceivers.map((t) => [t.kindOrTrack, t.init.direction])).toEqual([
      ['video', 'recvonly'],
      ['audio', 'recvonly'],
    ]);
    expect(decodeAvatarSdp(clientSdp)).toEqual({ type: 'offer', sdp: 'v=0 offer' });

    const answer = { type: 'answer' as const, sdp: 'v=0 answer' };
    await avatar.applyServerSdp(encodeAvatarSdp(answer));
    expect(pc.remoteDescription).toEqual(answer);

    const video = { id: 'video' };
    const audio = { id: 'audio' };
    pc.ontrack?.({ track: { kind: 'video' }, streams: [video] });
    pc.ontrack?.({ track: { kind: 'audio' }, streams: [audio] });
    expect(onVideoStream).toHaveBeenCalledWith(video);
    expect(onAudioStream).toHaveBeenCalledWith(audio);

    pc.setConnectionState('failed');
    expect(onError).toHaveBeenCalledWith('WebRTC connection failed');

    avatar.close();
    expect(pc.closed).toBe(true);
    expect(avatar.peerConnection).toBeNull();
    await expect(avatar.applyServerSdp(encodeAvatarSdp(answer))).rejects.toThrow(/not created/);
  });
});

describe('WebRtcMicrophone', () => {
  it('acquires the track once, honours mute and stops tracks', async () => {
    const { stream, track } = makeFakeMicStream();
    const getUserMedia = vi.fn(async () => stream as any);
    const mic = new WebRtcMicrophone({ getUserMedia });
    expect(mic.isActive).toBe(false);
    mic.setMuted(true);
    expect(await mic.start({ deviceId: 'mic-1' })).toBe(track);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: 'mic-1', echoCancellation: true, channelCount: 1 }),
    });
    expect(track.enabled).toBe(false); // muted before start
    await mic.start();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    mic.setMuted(false);
    expect(track.enabled).toBe(true);
    mic.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(mic.isActive).toBe(false);
    expect(mic.track).toBeNull();
  });
});

describe('WebRtcMicrophone (stop during a pending start)', () => {
  it('releases a stream whose permission prompt resolved after stop()', async () => {
    const { stream, track } = makeFakeMicStream();
    let release: (s: MediaStream) => void = () => undefined;
    const mic = new WebRtcMicrophone({
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          release = resolve;
        }),
    });
    const started = mic.start();
    mic.stop(); // there is no stream yet — without a generation this would be a no-op
    release(stream as unknown as MediaStream);
    await expect(started).resolves.toBeNull();
    // the microphone must not stay hot after the caller asked for it to be released
    expect(track.stop).toHaveBeenCalled();
    expect(mic.isActive).toBe(false);
    expect(mic.track).toBeNull();
  });
});

describe('reconnect policy', () => {
  it('resolves the option forms', () => {
    expect(resolveReconnectOptions(undefined)).toBeNull();
    expect(resolveReconnectOptions(false)).toBeNull();
    expect(resolveReconnectOptions(true)).toEqual(DEFAULT_RECONNECT_OPTIONS);
    expect(resolveReconnectOptions({ maxAttempts: 2 })).toEqual({ ...DEFAULT_RECONNECT_OPTIONS, maxAttempts: 2 });
  });

  it('computes capped exponential backoff with jitter', () => {
    const opts = { maxAttempts: 5, initialDelayMs: 500, maxDelayMs: 8000, jitter: 0.2 };
    const mid = () => 0.5; // no jitter
    expect(computeBackoffDelay(1, opts, mid)).toBe(500);
    expect(computeBackoffDelay(2, opts, mid)).toBe(1000);
    expect(computeBackoffDelay(4, opts, mid)).toBe(4000);
    expect(computeBackoffDelay(10, opts, mid)).toBe(8000);
    expect(computeBackoffDelay(1, opts, () => 1)).toBe(600);
    expect(computeBackoffDelay(1, opts, () => 0)).toBe(400);
    expect(computeBackoffDelay(1, { ...opts, jitter: 0 }, Math.random)).toBe(500);
  });

  it('classifies closes', () => {
    expect(isReconnectableClose({ code: 1000, reason: '', wasClean: true })).toBe(false);
    expect(isReconnectableClose({ code: 1001, reason: 'going away', wasClean: true })).toBe(false);
    expect(isReconnectableClose({ code: 1006, reason: '', wasClean: false })).toBe(true);
    expect(isReconnectableClose({ code: 1011, reason: 'server error', wasClean: true })).toBe(true);
    expect(isReconnectableClose({ code: 4008, reason: 'timeout', wasClean: false })).toBe(true);
  });
});

describe('server event parsing', () => {
  it('parses objects with a string type only', () => {
    expect(parseServerEvent('{"type":"session.created"}')).toEqual({ type: 'session.created' });
    expect(parseServerEvent('{"nope":1}')).toBeNull();
    expect(parseServerEvent('[1]')).toBeNull();
    expect(parseServerEvent('"str"')).toBeNull();
    expect(parseServerEvent('{bad')).toBeNull();
  });

  it('SeenEventIds is bounded and drops the oldest half', () => {
    const seen = new SeenEventIds(4);
    expect(seen.seenBefore('a')).toBe(false);
    expect(seen.seenBefore('a')).toBe(true);
    ['b', 'c', 'd', 'e'].forEach((id) => seen.seenBefore(id));
    // exceeded 4 → oldest half (a, b) dropped
    expect(seen.size).toBeLessThanOrEqual(4);
    expect(seen.seenBefore('a')).toBe(false);
    expect(seen.seenBefore('e')).toBe(true);
    seen.clear();
    expect(seen.size).toBe(0);
  });
});
