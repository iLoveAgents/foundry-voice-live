/**
 * WebRTC transport helpers for Voice Live (preview).
 *
 * Pure functions around RTCPeerConnection: build the offer, wait for ICE gathering,
 * shape the `rtc.call.sdp.create` control message, apply the answer and tear down.
 * React state and the control WebSocket live in `useVoiceLive`.
 *
 * @see https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-webrtc
 */

import type { RtcCallSdpCreateClientEvent, RtcCallErrorEvent } from '../types/events';
import { VOICE_LIVE_DATA_CHANNEL } from './constants';

/** Max time to wait for ICE gathering before sending the offer anyway (matches the MS sample) */
export const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 3000;

/** Max time to wait for `rtc.call.sdp.created` after sending the offer */
export const DEFAULT_RTC_NEGOTIATION_TIMEOUT_MS = 30000;

/** Live WebRTC objects for a session */
export interface WebRtcHandle {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  audioTransceiver: RTCRtpTransceiver;
}

/** Options for `createWebRtcOffer` */
export interface CreateWebRtcOfferOptions {
  /** RTCConfiguration (e.g. TURN servers). Default: none, per the Microsoft sample */
  rtcConfiguration?: RTCConfiguration;
  /** Microphone track to send immediately; when omitted a trackless sendrecv transceiver is created */
  localTrack?: MediaStreamTrack | null;
  /** ICE gathering timeout (ms) */
  iceGatheringTimeoutMs?: number;
  /** Called when the remote (assistant) audio stream arrives */
  onRemoteStream: (stream: MediaStream) => void;
  /** Called for every message on the `voice-live-events` data channel (raw JSON string) */
  onDataChannelMessage: (raw: string) => void;
  /** Called on peer connection state changes */
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  /** Called when a data channel opens/closes (`label` identifies client- vs server-created channels) */
  onDataChannelStateChange?: (state: 'open' | 'closed', label: string) => void;
  /** Factory for the peer connection (test seam) */
  createPeerConnection?: (configuration?: RTCConfiguration) => RTCPeerConnection;
}

/** Result of `createWebRtcOffer` */
export interface WebRtcOffer {
  handle: WebRtcHandle;
  /** Local SDP offer (after ICE gathering) */
  sdpOffer: string;
}

/**
 * Resolve when ICE gathering completes, or after `timeoutMs` (whichever comes first).
 * Trickle ICE is not used by the Voice Live signaling, so we send a complete offer.
 */
export function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs: number = DEFAULT_ICE_GATHERING_TIMEOUT_MS
): Promise<void> {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

/**
 * Create the peer connection, audio transceiver, data channel and local SDP offer.
 */
export async function createWebRtcOffer(options: CreateWebRtcOfferOptions): Promise<WebRtcOffer> {
  const createPc =
    options.createPeerConnection ?? ((configuration?: RTCConfiguration) => new RTCPeerConnection(configuration));
  const pc = createPc(options.rtcConfiguration);

  // Assistant audio arrives as a remote track
  pc.ontrack = (event: RTCTrackEvent) => {
    const stream = event.streams?.[0] ?? new MediaStream([event.track]);
    options.onRemoteStream(stream);
  };

  pc.onconnectionstatechange = () => {
    options.onConnectionStateChange(pc.connectionState);
  };

  // Non-audio events (VAD, transcripts, response lifecycle) arrive on this channel
  const wireDataChannel = (channel: RTCDataChannel): void => {
    channel.onmessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        options.onDataChannelMessage(event.data);
      }
    };
    channel.onopen = () => options.onDataChannelStateChange?.('open', channel.label);
    channel.onclose = () => options.onDataChannelStateChange?.('closed', channel.label);
  };
  const dataChannel = pc.createDataChannel(VOICE_LIVE_DATA_CHANNEL);
  wireDataChannel(dataChannel);
  // Also accept a channel announced by the service (some backends open their own)
  pc.ondatachannel = (event: RTCDataChannelEvent) => {
    wireDataChannel(event.channel);
  };

  // Microphone: sendrecv transceiver — trackless until startMic() replaces the track
  const audioTransceiver = options.localTrack
    ? pc.addTransceiver(options.localTrack, { direction: 'sendrecv' })
    : pc.addTransceiver('audio', { direction: 'sendrecv' });

  // From here on the caller has no handle yet, so any failure must clean up after itself —
  // otherwise every failed attempt leaks a peer connection and a data channel
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc, options.iceGatheringTimeoutMs);

    const sdpOffer = pc.localDescription?.sdp ?? offer.sdp;
    if (!sdpOffer) {
      throw new Error('Failed to create WebRTC SDP offer.');
    }

    return { handle: { pc, dataChannel, audioTransceiver }, sdpOffer };
  } catch (err) {
    closeWebRtc({ pc, dataChannel, audioTransceiver }, null);
    throw err;
  }
}

/**
 * Shape the `rtc.call.sdp.create` control-channel message.
 * `session` is the same wire object `session.update` would carry.
 */
export function buildRtcSdpCreateEvent(
  sdpOffer: string,
  session?: Record<string, unknown>
): RtcCallSdpCreateClientEvent {
  const event: RtcCallSdpCreateClientEvent = { type: 'rtc.call.sdp.create', sdp_offer: sdpOffer };
  if (session) event.session = session;
  return event;
}

/**
 * Apply the SDP answer from `rtc.call.sdp.created`.
 */
export async function applyRtcSdpAnswer(pc: RTCPeerConnection, sdpAnswer: string): Promise<void> {
  await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer });
}

/**
 * Human-readable message for `rtc.call.error`.
 */
export function formatRtcCallError(event: RtcCallErrorEvent): string {
  const code = event.error?.code ? `${event.error.code}: ` : '';
  const op = event.operation ? ` (operation: ${event.operation})` : '';
  return `WebRTC call error — ${code}${event.error?.message ?? 'unknown error'}${op}`;
}

/**
 * Stop local tracks and close the data channel and peer connection.
 */
export function closeWebRtc(handle: WebRtcHandle | null, localStream: MediaStream | null): void {
  localStream?.getTracks().forEach((track) => track.stop());
  if (!handle) return;
  try {
    handle.dataChannel.onmessage = null;
    handle.dataChannel.close();
  } catch {
    // ignore
  }
  try {
    handle.pc.ontrack = null;
    handle.pc.onconnectionstatechange = null;
    handle.pc.close();
  } catch {
    // ignore
  }
}
