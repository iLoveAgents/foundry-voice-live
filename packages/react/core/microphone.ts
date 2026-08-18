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
    const getUserMedia =
      this.options.getUserMedia ??
      ((c: MediaStreamConstraints): Promise<MediaStream> => navigator.mediaDevices.getUserMedia(c));
    const stream = await getUserMedia(buildMicConstraints(constraints));
    this.stream = stream;
    const track = this.track;
    if (track) track.enabled = !this.mutedFlag;
    return track;
  }

  /** Stop and release the microphone */
  stop(): void {
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
