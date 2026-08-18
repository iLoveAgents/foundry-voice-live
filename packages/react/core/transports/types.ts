/**
 * Transport abstraction for Voice Live sessions.
 *
 * A transport owns the control channel (always a WebSocket) and, for WebRTC, the peer
 * connection, events data channel and readiness gating. It delivers **parsed** server events
 * and knows nothing about session state, tools or React — that lives in `useVoiceLive`.
 */

import type { VoiceLiveServerEvent } from '../../types/events';

export type TransportKind = 'websocket' | 'webrtc';

export type TransportState = 'idle' | 'connecting' | 'open' | 'closed';

/** Why the control channel closed (mirrors `CloseEvent`) */
export interface TransportCloseInfo {
  code: number;
  reason: string;
  wasClean: boolean;
}

/** Callbacks a transport reports into (all optional except the four core ones) */
export interface TransportCallbacks {
  /** Control channel is open — events may be sent */
  onOpen: () => void;
  /** A server event (control channel or WebRTC data channel), parsed and de-duplicated */
  onEvent: (event: VoiceLiveServerEvent) => void;
  /** Control channel closed. Never fired for `close()` initiated by the caller. */
  onClose: (info: TransportCloseInfo) => void;
  /** Transport-level failure (socket error, negotiation timeout, media failure). A close may follow. */
  onError: (message: string, cause?: unknown) => void;
  /** WebRTC: media connected and events channel open (or fallback) — the session can start */
  onReady?: (reason: string) => void;
  /** WebRTC: the remote (assistant) audio stream */
  onRemoteStream?: (stream: MediaStream) => void;
}

/** Per-connect options */
export interface TransportConnectOptions {
  /** WebRTC: microphone track to send from the start (otherwise attach later via `setMicrophoneTrack`) */
  localTrack?: MediaStreamTrack | null;
}

/** A Voice Live transport (WebSocket or WebRTC) */
export interface VoiceLiveTransport {
  readonly kind: TransportKind;
  readonly state: TransportState;
  /**
   * Open the control channel. `session` is the wire session object — the WebSocket transport
   * ignores it (the caller sends `session.update` after `session.created`), the WebRTC transport
   * embeds it into `rtc.call.sdp.create`.
   */
  connect(url: string, session: Record<string, unknown>, options?: TransportConnectOptions): void;
  /** Send a JSON-encoded client event; returns false when the channel is not open */
  send(json: string): boolean;
  /** Release everything (handlers detached first, so no callbacks fire afterwards) */
  close(): void;
  /** WebRTC: set or replace the outgoing microphone track (no-op on WebSocket) */
  setMicrophoneTrack(track: MediaStreamTrack | null): Promise<void>;
}
