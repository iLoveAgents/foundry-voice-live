/**
 * Avatar media connection (WebSocket transport + `session.avatar`).
 *
 * The service returns ICE servers in `session.updated`; the client creates a receive-only
 * peer connection (video + audio), sends the local SDP in `session.avatar.connect` and applies
 * the server SDP from `session.avatar.connecting`. Both SDPs travel base64-encoded as JSON.
 */

import type { Logger } from '../utils/logger';

export interface AvatarConnectionCallbacks {
  onVideoStream: (stream: MediaStream | null) => void;
  onAudioStream: (stream: MediaStream | null) => void;
  onError: (message: string) => void;
}

export interface AvatarConnectionOptions {
  log?: Logger;
  /** Max time to wait for ICE gathering before sending the offer anyway */
  iceGatheringTimeoutMs?: number;
  /** Factory for the peer connection (test seam) */
  createPeerConnection?: (configuration?: RTCConfiguration) => RTCPeerConnection;
}

/**
 * Max time to wait for avatar ICE gathering. Closing a peer connection is not guaranteed to
 * fire `icegatheringstatechange`, so an unbounded wait could hang `createOffer()` forever.
 */
export const DEFAULT_AVATAR_ICE_GATHERING_TIMEOUT_MS = 3000;

/** Encode a local description the way `session.avatar.connect` expects it */
export function encodeAvatarSdp(description: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify(description));
}

/** Decode the `server_sdp` of `session.avatar.connecting` */
export function decodeAvatarSdp(serverSdp: string): RTCSessionDescriptionInit {
  return JSON.parse(atob(serverSdp)) as RTCSessionDescriptionInit;
}

export class AvatarConnection {
  private pc: RTCPeerConnection | null = null;

  constructor(
    private readonly callbacks: AvatarConnectionCallbacks,
    private readonly options: AvatarConnectionOptions = {}
  ) {}

  get peerConnection(): RTCPeerConnection | null {
    return this.pc;
  }

  /**
   * Create the receive-only peer connection and return the encoded local SDP offer
   * (after ICE gathering) for `session.avatar.connect`.
   */
  async createOffer(iceServers: RTCIceServer[]): Promise<string> {
    const log = this.options.log;
    const create =
      this.options.createPeerConnection ??
      ((configuration?: RTCConfiguration): RTCPeerConnection => new RTCPeerConnection(configuration));
    const pc = create({ iceServers });
    this.pc = pc;

    try {
      this.wireHandlers(pc, log);
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const gathered = await waitForIceGatheringComplete(
        pc,
        this.options.iceGatheringTimeoutMs ?? DEFAULT_AVATAR_ICE_GATHERING_TIMEOUT_MS
      );
      log?.debug(gathered ? 'Avatar ICE gathering complete' : 'Avatar ICE gathering timed out — sending offer anyway');

      const localDescription = pc.localDescription ?? offer;
      return encodeAvatarSdp(localDescription);
    } catch (err) {
      // Everything after the peer connection exists is guarded: the caller only learns about the
      // failure, so it cannot clean up a connection it never received
      this.close();
      throw err;
    }
  }

  /** Wire the media/state handlers of a freshly created avatar peer connection */
  private wireHandlers(pc: RTCPeerConnection, log: Logger | undefined): void {
    pc.ontrack = (event: RTCTrackEvent): void => {
      // Some browsers deliver a track without an associated stream — the media is still there, so
      // wrap it rather than reporting nothing (a blank avatar on a session that looks ready)
      const stream = event.streams[0] ?? (event.track ? new MediaStream([event.track]) : null);
      if (event.track.kind === 'video') {
        log?.debug('Avatar video stream connected');
        this.callbacks.onVideoStream(stream);
      } else if (event.track.kind === 'audio') {
        log?.debug('Avatar audio stream connected');
        this.callbacks.onAudioStream(stream);
      }
    };
    pc.oniceconnectionstatechange = (): void => {
      if (pc.iceConnectionState === 'connected') {
        log?.debug('Avatar ICE connected');
      } else if (pc.iceConnectionState === 'failed') {
        this.callbacks.onError('ICE connection failed');
      }
    };
    pc.onconnectionstatechange = (): void => {
      if (pc.connectionState === 'connected') {
        log?.debug('Avatar WebRTC connected');
      } else if (pc.connectionState === 'failed') {
        this.callbacks.onError('WebRTC connection failed');
      }
    };

  }

  /** Apply the server SDP from `session.avatar.connecting` */
  async applyServerSdp(serverSdp: string): Promise<void> {
    if (!this.pc) throw new Error('Avatar peer connection not created');
    await this.pc.setRemoteDescription(decodeAvatarSdp(serverSdp));
  }

  close(): void {
    const pc = this.pc;
    this.pc = null;
    if (!pc) return;
    pc.ontrack = null;
    pc.oniceconnectionstatechange = null;
    pc.onconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Resolve once ICE gathering is complete (the avatar signaling expects a full SDP), or after
 * `timeoutMs`. Resolves `true` when gathering completed, `false` on timeout — never hangs, and
 * always removes its listener.
 */
function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs: number): Promise<boolean> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (complete: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve(complete);
    };
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}
