/**
 * Assistant audio output: the shared Web Audio graph (context, gain, analyser) and the
 * PCM16 player used by the WebSocket transport.
 *
 * - WebSocket voice-only: PCM chunks → AudioWorklet (Lanczos-3 resampling) → gain →
 *   MediaStreamDestination (exposed as `audioStream`) + analyser.
 * - WebSocket avatar: audio arrives on the avatar peer connection; the graph only provides the
 *   analyser.
 * - WebRTC: the remote RTP track is exposed directly and fed into the analyser for visualization.
 */

import type { Logger } from '../utils/logger';
import { createPlaybackProcessorBlobUrl } from './playbackWorklet';

export interface OutputAudioGraphOptions {
  log?: Logger;
  /** Factory for the context (test seam) */
  createAudioContext?: () => AudioContext;
}

/**
 * Lazily created AudioContext + gain + analyser, optionally with a MediaStreamDestination.
 */
export class OutputAudioGraph {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private remoteSource: MediaStreamAudioSourceNode | null = null;

  constructor(private readonly options: OutputAudioGraphOptions = {}) {}

  get context(): AudioContext | null {
    return this.ctx;
  }

  get gain(): GainNode | null {
    return this.gainNode;
  }

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  /** The stream carrying played PCM audio (WebSocket voice-only mode), once created */
  get destinationStream(): MediaStream | null {
    return this.destination?.stream ?? null;
  }

  /**
   * Create the context/gain/analyser once. Returns true when the context was created by
   * this call (callers may want to re-render to expose it).
   */
  ensure(): boolean {
    if (this.ctx) return false;
    const create =
      this.options.createAudioContext ?? ((): AudioContext => new AudioContext({ latencyHint: 'interactive' }));
    const ctx = create();
    this.ctx = ctx;
    this.options.log?.debug(`AudioContext created (${ctx.sampleRate} Hz)`);

    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    this.gainNode = gain;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    this.analyserNode = analyser;
    return true;
  }

  /**
   * Route the gain into a MediaStreamDestination (and the analyser). Returns the stream, or
   * null if the graph does not exist yet. Idempotent.
   */
  ensureDestination(): MediaStream | null {
    if (!this.ctx || !this.gainNode) return null;
    if (!this.destination) {
      this.destination = this.ctx.createMediaStreamDestination();
      this.gainNode.connect(this.destination);
      if (this.analyserNode) {
        this.gainNode.connect(this.analyserNode);
      }
      this.options.log?.debug('Audio output stream created');
    }
    return this.destination.stream;
  }

  /**
   * Feed a remote (WebRTC) stream into the analyser so visualizers work for both transports.
   * Playback itself happens through the caller's <audio> element.
   */
  attachRemoteStream(stream: MediaStream): void {
    const ctx = this.ctx;
    if (!ctx || !this.analyserNode) return;
    try {
      this.remoteSource?.disconnect();
      this.remoteSource = ctx.createMediaStreamSource(stream);
      this.remoteSource.connect(this.analyserNode);
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => undefined);
      }
    } catch (err) {
      this.options.log?.warn('Could not attach remote stream to analyser:', err);
    }
  }

  detachRemoteStream(): void {
    try {
      this.remoteSource?.disconnect();
    } catch {
      // ignore
    }
    this.remoteSource = null;
  }

  /** Resume a context suspended by the browser autoplay policy */
  async resume(): Promise<void> {
    if (this.ctx?.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /** Close the context and drop every node */
  close(): void {
    this.detachRemoteStream();
    const ctx = this.ctx;
    this.ctx = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.destination = null;
    if (ctx) {
      ctx.close().catch(() => undefined);
    }
  }
}

export interface PcmPlayerOptions {
  /** Sample rate of the incoming PCM16 (the session's output format) */
  sourceSampleRate: number;
  log?: Logger;
  /** Factory for the worklet node (test seam) */
  createWorkletNode?: (context: AudioContext, options: AudioWorkletNodeOptions) => AudioWorkletNode;
}

/**
 * Gapless PCM16 playback through an AudioWorklet (off the main thread). Tracks the start
 * time of the current response for viseme/word-timestamp synchronization.
 */
export class PcmPlayer {
  private worklet: AudioWorkletNode | null = null;
  private initPromise: Promise<void> | null = null;
  private blobUrl: string | null = null;
  private responseStartTime: number | null = null;
  private awaitingFirstChunk = true;
  private disposed = false;

  constructor(
    private readonly graph: OutputAudioGraph,
    private readonly options: PcmPlayerOptions
  ) {}

  /** Call on `response.created` so the next chunk marks the response start */
  markResponseStart(): void {
    this.awaitingFirstChunk = true;
    this.responseStartTime = null;
  }

  /** Decode a base64 PCM16 chunk and hand it to the worklet (initializing it lazily) */
  async enqueue(base64Audio: string): Promise<void> {
    const ctx = this.graph.context;
    if (!ctx || this.disposed) return;
    try {
      // Browser autoplay policy: the context may start suspended
      await this.graph.resume();
      if (!this.worklet) {
        await this.init();
      }
      if (this.disposed) return;

      if (this.awaitingFirstChunk) {
        this.responseStartTime = ctx.currentTime;
        this.awaitingFirstChunk = false;
      }

      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      // Transferable for zero-copy hand-off to the worklet
      const buffer = bytes.buffer;
      this.worklet?.port.postMessage(buffer, [buffer]);
    } catch (err) {
      this.options.log?.error('Error playing audio chunk:', err);
    }
  }

  /** Flush queued audio immediately (barge-in / cancel) */
  stop(): void {
    this.worklet?.port.postMessage(null);
  }

  /** Milliseconds of audio played since the current response started (null before the first chunk) */
  playbackTimeMs(): number | null {
    const ctx = this.graph.context;
    if (!ctx || this.responseStartTime === null) return null;
    return Math.max(0, (ctx.currentTime - this.responseStartTime) * 1000);
  }

  dispose(): void {
    this.disposed = true;
    if (this.worklet) {
      this.worklet.port.postMessage(null);
      this.worklet.disconnect();
      this.worklet = null;
    }
    this.initPromise = null;
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.responseStartTime = null;
    this.awaitingFirstChunk = true;
  }

  private init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    const ctx = this.graph.context;
    if (!ctx) return Promise.resolve();
    this.initPromise = (async (): Promise<void> => {
      const blobUrl = createPlaybackProcessorBlobUrl();
      this.blobUrl = blobUrl;
      await ctx.audioWorklet.addModule(blobUrl);
      if (this.disposed) return;
      const create =
        this.options.createWorkletNode ??
        ((context: AudioContext, options: AudioWorkletNodeOptions): AudioWorkletNode =>
          new AudioWorkletNode(context, 'audio-playback-processor', options));
      const node = create(ctx, { processorOptions: { sourceSampleRate: this.options.sourceSampleRate } });
      // Through the gain node (visualization + output stream) or straight to the speakers
      node.connect(this.graph.gain ?? ctx.destination);
      this.worklet = node;
      this.options.log?.debug('Playback worklet initialized (Lanczos-3 resampling, off main thread)');
    })();
    return this.initPromise;
  }
}
