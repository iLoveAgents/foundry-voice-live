/**
 * Microphone track for the WebRTC transport (the WebSocket transport captures PCM through
 * `useAudioCapture` instead). Owns the `getUserMedia` stream and the mute flag.
 */

import { buildMicConstraints } from '../utils/audioHelpers';

export interface WebRtcMicrophoneOptions {
  /** Test seam */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

export class WebRtcMicrophone {
  private stream: MediaStream | null = null;
  private mutedFlag = false;
  /**
   * Incremented by `stop()`. A `stop()` that lands while `getUserMedia` is still pending would
   * otherwise be a no-op (there is no stream yet) and the resolved track would keep the
   * microphone hot after the caller asked for it to be released.
   */
  private generation = 0;
  /**
   * The in-flight `getUserMedia` call. Without it, two `start()` calls during one permission
   * prompt would each acquire a stream and the second would overwrite the first — leaving a live
   * microphone track that `stop()` can no longer reach.
   */
  private pendingStart: Promise<MediaStreamTrack | null> | null = null;

  constructor(private readonly options: WebRtcMicrophoneOptions = {}) {}

  get isActive(): boolean {
    return this.stream !== null;
  }

  get isMuted(): boolean {
    return this.mutedFlag;
  }

  /** The current audio track (null while inactive) */
  get track(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }

  /**
   * Acquire the microphone (idempotent) and return its audio track. The track honours the
   * current mute flag.
   */
  async start(constraints?: MediaTrackConstraints | boolean): Promise<MediaStreamTrack | null> {
    if (this.stream) return this.track;
    if (this.pendingStart) return this.pendingStart; // one prompt, one stream
    const getUserMedia =
      this.options.getUserMedia ??
      ((c: MediaStreamConstraints): Promise<MediaStream> => navigator.mediaDevices.getUserMedia(c));
    const generation = this.generation;
    const attempt = (async (): Promise<MediaStreamTrack | null> => {
      const stream = await getUserMedia(buildMicConstraints(constraints));
      if (generation !== this.generation) {
        // stop() was called while the permission prompt was open — release immediately
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }
      this.stream = stream;
      const track = this.track;
      if (track) track.enabled = !this.mutedFlag;
      return track;
    })();
    this.pendingStart = attempt;
    try {
      return await attempt;
    } finally {
      if (this.pendingStart === attempt) this.pendingStart = null;
    }
  }

  /** Stop and release the microphone (also cancels an acquisition that is still pending) */
  stop(): void {
    this.generation += 1;
    this.pendingStart = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** Mute/unmute by toggling `track.enabled` (keeps the RTP sender alive) */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }
}
