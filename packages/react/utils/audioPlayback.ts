/**
 * Audio Playback Utility for Voice Live API
 *
 * Provides high-quality audio playback from Voice Live API responses.
 * Features:
 * - Lanczos-3 resampling from 24kHz to device native sample rate
 * - First-chunk delay for pipeline warmup (prevents crackling)
 * - Fade-in on first chunk (prevents clicks from sudden amplitude change)
 * - Scheduled playback for gapless audio
 * - Barge-in support (stop playback when user interrupts)
 * - Custom destination support for WebRTC/ACS integration
 *
 * @example Basic usage (plays to speakers)
 * ```ts
 * const player = new AudioPlayer({
 *   onPlaybackStart: () => console.log('Started'),
 *   onPlaybackEnd: () => console.log('Ended'),
 * });
 *
 * // Play base64 PCM16 audio from Voice Live
 * player.playChunk(base64Audio);
 *
 * // Stop for barge-in
 * player.stop();
 *
 * // Cleanup
 * player.dispose();
 * ```
 *
 * @example Custom destination (for ACS/WebRTC)
 * ```ts
 * const audioContext = new AudioContext({ sampleRate: 24000 });
 * const destination = audioContext.createMediaStreamDestination();
 *
 * const player = new AudioPlayer({
 *   audioContext,
 *   destination,
 *   firstChunkDelayMs: 200, // Lower delay for real-time comms
 * });
 *
 * // Use destination.stream for ACS LocalAudioStream
 * const localAudioStream = new LocalAudioStream(destination.stream);
 * ```
 */

/**
 * Audio player configuration
 */
export interface AudioPlayerConfig {
  /** Callback when audio playback starts (first chunk of a response) */
  onPlaybackStart?: () => void;
  /** Callback when all queued audio has finished playing */
  onPlaybackEnd?: () => void;
  /**
   * First chunk delay in ms (default: 300ms for pipeline warmup)
   * This helps prevent crackling by ensuring AudioContext is ready
   */
  firstChunkDelayMs?: number;
  /**
   * Fade-in duration in ms for first chunk (default: 50ms)
   * Prevents clicks from sudden amplitude change
   */
  fadeInMs?: number;
  /**
   * Fade-out duration in ms when stopping (default: 20ms)
   * Prevents clicks when audio is interrupted
   */
  fadeOutMs?: number;
  /** Enable debug logging */
  debug?: boolean;
  /**
   * Custom AudioContext to use. If not provided, one will be created.
   * Useful for integrating with existing audio graphs.
   * Note: If provided, the caller is responsible for closing it.
   */
  audioContext?: AudioContext;
  /**
   * Custom destination node to connect audio to.
   * If not provided, audio connects to audioContext.destination (speakers).
   * Useful for routing to MediaStreamDestination for ACS/WebRTC.
   */
  destination?: AudioNode;
  /**
   * Whether to connect to the analyser node for visualization.
   * Default: true
   */
  enableAnalyser?: boolean;
  /**
   * Source sample rate (default: 24000 for Voice Live API)
   */
  sourceSampleRate?: number;
  /**
   * Number of chunks to buffer before starting playback (default: 1)
   * Higher values reduce crackling risk but increase latency
   */
  bufferChunks?: number;
}

/**
 * Audio playback state
 */
export type AudioPlaybackState = 'idle' | 'buffering' | 'playing' | 'stopped';

/**
 * High-quality audio player for Voice Live API responses
 *
 * Uses AudioBufferSourceNode with scheduled playback for gapless audio.
 * Resamples from 24kHz (Voice Live) to device native sample rate using
 * Lanczos-3 interpolation for professional audio quality.
 */
export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private ownsAudioContext = true;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private customDestination: AudioNode | null = null;
  private audioQueue: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;
  private isFirstChunk = true;
  private responseStartTime: number | null = null;
  private state: AudioPlaybackState = 'idle';
  private pendingChunks: string[] = []; // Buffer for pre-buffering
  private config: Required<Omit<AudioPlayerConfig, 'audioContext' | 'destination'>> & {
    audioContext?: AudioContext;
    destination?: AudioNode;
  };

  constructor(config: AudioPlayerConfig = {}) {
    this.config = {
      onPlaybackStart: config.onPlaybackStart ?? (() => {}),
      onPlaybackEnd: config.onPlaybackEnd ?? (() => {}),
      firstChunkDelayMs: config.firstChunkDelayMs ?? 300,
      fadeInMs: config.fadeInMs ?? 50,
      fadeOutMs: config.fadeOutMs ?? 20,
      debug: config.debug ?? false,
      enableAnalyser: config.enableAnalyser ?? true,
      sourceSampleRate: config.sourceSampleRate ?? 24000,
      bufferChunks: config.bufferChunks ?? 1,
      audioContext: config.audioContext,
      destination: config.destination,
    };

    if (config.audioContext) {
      this.audioContext = config.audioContext;
      this.ownsAudioContext = false;
      this.customDestination = config.destination || null;
      this.initializeNodes();
    }
  }

  private log(message: string): void {
    if (this.config.debug) {
      const timestamp = new Date().toISOString().slice(11, 23);
      console.log(`[${timestamp}] [AudioPlayer] ${message}`);
    }
  }

  private initializeNodes(): void {
    if (!this.audioContext) return;

    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 1.0;

    const targetDestination = this.customDestination || this.audioContext.destination;
    this.gainNode.connect(targetDestination);

    if (this.config.enableAnalyser) {
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.gainNode.connect(this.analyserNode);
    }

    this.log(
      `Initialized: ${this.audioContext.sampleRate}Hz, latency: ${(this.audioContext.baseLatency * 1000).toFixed(2)}ms`
    );
  }

  getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        latencyHint: 'interactive',
      });
      this.ownsAudioContext = true;
      this.nextPlayTime = 0;
      this.initializeNodes();
    }
    return this.audioContext;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  getGainNode(): GainNode | null {
    return this.gainNode;
  }

  getState(): AudioPlaybackState {
    return this.state;
  }

  getPlaybackTimeMs(): number | null {
    if (!this.audioContext || this.responseStartTime === null) {
      return null;
    }
    const elapsed = this.audioContext.currentTime - this.responseStartTime;
    return Math.max(0, elapsed * 1000);
  }

  resetForNewResponse(): void {
    this.isFirstChunk = true;
    this.responseStartTime = null;
    this.nextPlayTime = this.audioContext?.currentTime || 0;
    this.pendingChunks = [];
    this.state = 'idle';
    this.log('Reset for new response');
  }

  /**
   * Play a base64-encoded PCM16 audio chunk from Voice Live API
   */
  async playChunk(base64Audio: string): Promise<void> {
    try {
      const audioContext = this.getAudioContext();

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        this.log(`AudioContext resumed`);
      }

      // Handle pre-buffering
      if (this.isFirstChunk && this.config.bufferChunks > 1) {
        this.pendingChunks.push(base64Audio);
        this.state = 'buffering';

        if (this.pendingChunks.length < this.config.bufferChunks) {
          this.log(`Buffering: ${this.pendingChunks.length}/${this.config.bufferChunks} chunks`);
          return;
        }

        // Buffer full, play all pending chunks
        this.log(`Buffer full, starting playback with ${this.pendingChunks.length} chunks`);
        for (const chunk of this.pendingChunks) {
          await this.playChunkInternal(chunk);
        }
        this.pendingChunks = [];
        return;
      }

      await this.playChunkInternal(base64Audio);
    } catch (err) {
      console.error('[AudioPlayer] Error playing audio chunk:', err);
    }
  }

  private async playChunkInternal(base64Audio: string): Promise<void> {
    const audioContext = this.audioContext!;

    // Decode base64 to PCM16
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const pcm16 = new Int16Array(bytes.buffer);
    const float32Source = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      const sample = pcm16[i];
      if (sample !== undefined) {
        float32Source[i] = sample / 32768.0;
      }
    }

    // Resample if needed (always produces Float32Array with ArrayBuffer)
    const float32: Float32Array =
      this.config.sourceSampleRate !== audioContext.sampleRate
        ? this.resampleLanczos(float32Source, this.config.sourceSampleRate, audioContext.sampleRate)
        : new Float32Array(float32Source);

    // Apply fade-in to first chunk to prevent clicks
    if (this.isFirstChunk && this.config.fadeInMs > 0) {
      const fadeInSamples = Math.floor((this.config.fadeInMs / 1000) * audioContext.sampleRate);
      for (let i = 0; i < Math.min(fadeInSamples, float32.length); i++) {
        // Use cosine curve for smooth fade (sounds better than linear)
        const t = i / fadeInSamples;
        const gain = 0.5 * (1 - Math.cos(Math.PI * t));
        const currentSample = float32[i];
        if (currentSample !== undefined) {
          float32[i] = currentSample * gain;
        }
      }
      this.log(`Applied fade-in (${fadeInSamples} samples)`);
    }

    const audioBuffer = audioContext.createBuffer(1, float32.length, audioContext.sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const currentTime = audioContext.currentTime;
    let scheduleTime: number;

    if (this.isFirstChunk) {
      // First chunk: add delay for pipeline warmup
      const delaySeconds = this.config.firstChunkDelayMs / 1000;
      scheduleTime = Math.max(currentTime + delaySeconds, this.nextPlayTime);
      this.responseStartTime = scheduleTime;
      this.isFirstChunk = false;
      this.state = 'playing';
      this.config.onPlaybackStart();
      this.log(`First chunk at +${((scheduleTime - currentTime) * 1000).toFixed(0)}ms`);
    } else {
      scheduleTime = Math.max(currentTime, this.nextPlayTime);
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    if (this.gainNode) {
      source.connect(this.gainNode);
    } else {
      source.connect(this.customDestination || audioContext.destination);
    }

    source.start(scheduleTime);

    source.onended = () => {
      const index = this.audioQueue.indexOf(source);
      if (index > -1) {
        this.audioQueue.splice(index, 1);
      }
      if (this.audioQueue.length === 0 && this.state === 'playing') {
        this.state = 'idle';
        this.config.onPlaybackEnd();
      }
    };

    this.nextPlayTime = scheduleTime + audioBuffer.duration;
    this.audioQueue.push(source);
  }

  /**
   * Stop all audio playback immediately with optional fade-out
   */
  stop(): void {
    const queueSize = this.audioQueue.length;

    // Apply fade-out via gain node if available
    if (this.gainNode && this.config.fadeOutMs > 0 && queueSize > 0) {
      const audioContext = this.audioContext!;
      const currentTime = audioContext.currentTime;
      const fadeOutSeconds = this.config.fadeOutMs / 1000;

      // Ramp gain to 0 smoothly
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, currentTime);
      this.gainNode.gain.linearRampToValueAtTime(0, currentTime + fadeOutSeconds);

      // Schedule actual stop after fade
      setTimeout(() => {
        this.audioQueue.forEach((source) => {
          try {
            source.stop();
          } catch {
            // Already stopped
          }
        });
        this.audioQueue = [];
        // Reset gain for next playback
        if (this.gainNode) {
          this.gainNode.gain.setValueAtTime(1.0, this.audioContext?.currentTime || 0);
        }
      }, this.config.fadeOutMs);
    } else {
      // Immediate stop
      this.audioQueue.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Already stopped
        }
      });
      this.audioQueue = [];
    }

    this.nextPlayTime = this.audioContext?.currentTime || 0;
    this.pendingChunks = [];
    this.state = 'stopped';
    this.log(`Stopped (${queueSize} sources, fadeOut: ${this.config.fadeOutMs}ms)`);
  }

  dispose(): void {
    this.stop();
    if (this.audioContext && this.ownsAudioContext) {
      this.audioContext.close();
    }
    this.audioContext = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.customDestination = null;
    this.log('Disposed');
  }

  /**
   * Lanczos-3 resampling for high-quality audio conversion
   */
  private resampleLanczos(
    source: Float32Array,
    sourceSampleRate: number,
    targetSampleRate: number
  ): Float32Array {
    if (sourceSampleRate === targetSampleRate) {
      return source;
    }

    const sampleRateRatio = targetSampleRate / sourceSampleRate;
    const outputLength = Math.ceil(source.length * sampleRateRatio);
    const output = new Float32Array(outputLength);

    const lanczosA = 3;
    const lanczosKernel = (x: number): number => {
      if (Math.abs(x) >= lanczosA) return 0;
      if (x === 0) return 1;
      const pi = Math.PI;
      const px = pi * x;
      const pa = px / lanczosA;
      return (Math.sin(px) * Math.sin(pa)) / (px * pa);
    };

    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = i / sampleRateRatio;
      const centerIndex = Math.floor(sourceIndex);
      const fraction = sourceIndex - centerIndex;

      let interpolatedSample = 0;

      for (let j = -lanczosA + 1; j <= lanczosA; j++) {
        const sampleIndex = centerIndex + j;
        if (sampleIndex >= 0 && sampleIndex < source.length) {
          const distance = fraction - j;
          const sample = source[sampleIndex];
          if (sample !== undefined) {
            interpolatedSample += sample * lanczosKernel(distance);
          }
        }
      }

      output[i] = interpolatedSample;
    }

    return output;
  }
}

export function createAudioPlayer(config?: AudioPlayerConfig): AudioPlayer {
  return new AudioPlayer(config);
}
