/**
 * WebRTC transport (preview): RTP audio via `RTCPeerConnection`, control channel on
 * `/voice-live/realtime/calls`, non-audio events on the `voice-live-events` data channel.
 *
 * Owns the SDP negotiation (`rtc.call.sdp.create` → `rtc.call.sdp.created` / `rtc.call.error`),
 * the negotiation timeout, readiness gating (media connected + data channel open, with a
 * fallback) and the duplicate-event filter (some events arrive on both channels).
 */

import type { Logger } from '../../utils/logger';
import {
  createWebRtcOffer,
  buildRtcSdpCreateEvent,
  applyRtcSdpAnswer,
  formatRtcCallError,
  closeWebRtc,
  DEFAULT_RTC_NEGOTIATION_TIMEOUT_MS,
  type WebRtcHandle,
  type WebRtcOffer,
} from '../../utils/webrtcTransport';
import type { VoiceLiveServerEvent, RtcCallErrorEvent } from '../../types/events';
import { parseServerEvent, SeenEventIds } from '../serverEvents';
import type {
  TransportCallbacks,
  TransportConnectOptions,
  TransportState,
  VoiceLiveTransport,
} from './types';

/** Events buffered between `onOpen` and `rtc.call.sdp.create` (a handshake is a handful) */
const MAX_PRE_CALL_QUEUE = 64;

/** How long to wait for the events data channel after media is connected before continuing without it */
export const DEFAULT_DATA_CHANNEL_FALLBACK_MS = 2000;

/** Close code reported when the SDP answer never arrives */
export const RTC_NEGOTIATION_TIMEOUT_CLOSE_CODE = 4008;

/** Close code reported when the SDP answer arrives but cannot be applied */
export const RTC_SDP_ANSWER_FAILED_CLOSE_CODE = 4009;

/** Close code reported when the service rejects the call with `rtc.call.error` */
export const RTC_CALL_ERROR_CLOSE_CODE = 4010;

/** Close code reported when the peer connection fails (ICE death, network change, NAT rebind) */
export const RTC_MEDIA_FAILED_CLOSE_CODE = 4011;

/** Close code reported when the control channel could not even be constructed (bad URL) */
export const CONTROL_CHANNEL_SETUP_FAILED_CLOSE_CODE = 4012;

export interface WebRtcTransportOptions {
  rtcConfiguration?: RTCConfiguration;
  negotiationTimeoutMs?: number;
  dataChannelFallbackMs?: number;
  iceGatheringTimeoutMs?: number;
  log?: Logger;
  /** Factories (test seams) */
  createWebSocket?: (url: string) => WebSocket;
  createPeerConnection?: (configuration?: RTCConfiguration) => RTCPeerConnection;
}

export class WebRtcTransport implements VoiceLiveTransport {
  readonly kind = 'webrtc' as const;
  private ws: WebSocket | null = null;
  private handle: WebRtcHandle | null = null;
  private offerPromise: Promise<WebRtcOffer> | null = null;
  /**
   * A microphone attachment requested before the transceiver existed. The caller's promise is kept
   * open until the real `replaceTrack()` runs, so a failure is reported instead of the caller
   * believing the microphone is live.
   */
  private pendingTrack:
    | { track: MediaStreamTrack | null; resolve: () => void; reject: (err: unknown) => void }
    | null = null;
  private negotiationTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Events the caller sent between `onOpen` and `rtc.call.sdp.create`. The contract says events may
   * be sent once the control channel is open, but for WebRTC the *call* does not exist until the
   * offer has been negotiated, so anything sent earlier would be rejected or lost.
   */
  private preCallQueue: string[] = [];
  private dataChannelFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private currentState: TransportState = 'idle';
  private generation = 0;
  private readonly seen = new SeenEventIds();

  constructor(
    private readonly callbacks: TransportCallbacks,
    private readonly options: WebRtcTransportOptions = {}
  ) {}

  get state(): TransportState {
    return this.currentState;
  }

  /**
   * Invoke a consumer callback without letting it affect our control flow. Terminal handling
   * (close + `onClose`) must run even when the caller's `onError` throws, or the transport would
   * be stuck `open` with no way for anyone to recover it.
   */
  private notify<TArgs extends unknown[]>(
    name: string,
    fn: ((...args: TArgs) => void) | undefined,
    ...args: TArgs
  ): void {
    if (!fn) return;
    try {
      fn(...args);
    } catch (err) {
      this.options.log?.error(`${name} callback threw:`, err);
    }
  }

  connect(url: string, session: Record<string, unknown>, connectOptions: TransportConnectOptions = {}): void {
    if (this.ws) {
      throw new Error('WebRtcTransport.connect() called twice — create a new transport per connection');
    }
    const generation = ++this.generation;
    const log = this.options.log;
    let mediaConnected = false;
    let dataChannelOpen = false;
    let readyAnnounced = false;

    const announceReady = (reason: string): void => {
      if (readyAnnounced || generation !== this.generation) return;
      readyAnnounced = true;
      this.clearDataChannelFallback();
      log?.info(`WebRTC session ready (${reason})`);
      this.notify('onReady', this.callbacks.onReady, reason);
    };

    // 1. Peer connection + local offer (ICE gathering) — in parallel with the control-channel
    //    handshake; awaited only once the socket is open.
    const offerPromise = createWebRtcOffer({
      rtcConfiguration: this.options.rtcConfiguration,
      localTrack: connectOptions.localTrack ?? null,
      iceGatheringTimeoutMs: this.options.iceGatheringTimeoutMs,
      createPeerConnection: this.options.createPeerConnection,
      onRemoteStream: (stream) => {
        if (generation !== this.generation) return;
        log?.debug('Remote audio track received');
        this.notify('onRemoteStream', this.callbacks.onRemoteStream, stream);
      },
      onDataChannelMessage: (raw) => this.deliver(raw, generation),
      onDataChannelStateChange: (state, label) => {
        log?.debug(`Data channel "${label}" ${state}`);
        if (state === 'open') {
          dataChannelOpen = true;
          if (mediaConnected) announceReady('media + data channel');
        } else {
          dataChannelOpen = false;
        }
      },
      onConnectionStateChange: (state) => {
        if (generation !== this.generation) return;
        log?.debug(`WebRTC connection state: ${state}`);
        if (state !== 'connected' && !readyAnnounced) {
          // The RTP path went away before the session ever started: readiness must not be
          // announced off a stale flag (or by the fallback timer) while media is down.
          // A disconnect *after* readiness is left alone — WebRTC recovers from it routinely.
          mediaConnected = false;
          this.clearDataChannelFallback();
        }
        if (state === 'connected') {
          mediaConnected = true;
          if (dataChannelOpen) {
            announceReady('media + data channel');
          } else {
            // Don't hang forever if the service never opens a data channel
            this.dataChannelFallbackTimer = setTimeout(() => {
              if (!mediaConnected) return; // the media path dropped while we were waiting
              log?.warn(
                `Data channel did not open within ${this.options.dataChannelFallbackMs ?? DEFAULT_DATA_CHANNEL_FALLBACK_MS} ms — continuing without it`
              );
              announceReady('media only');
            }, this.options.dataChannelFallbackMs ?? DEFAULT_DATA_CHANNEL_FALLBACK_MS);
          }
        } else if (state === 'failed') {
          // Terminal per spec (unlike 'disconnected', which can recover). It can happen mid-call
          // — a network change or NAT rebind — so close instead of only reporting: otherwise the
          // media is dead while the control channel still looks 'open', blocking reconnect.
          const message =
            "WebRTC connection failed. UDP may be blocked on this network — configure rtcConfiguration (TURN) or use transport: 'websocket'.";
          this.failTerminally(message, RTC_MEDIA_FAILED_CLOSE_CODE);
        }
      },
    });
    // Rejections are handled where the offer is awaited (onopen); avoid unhandled-rejection noise
    offerPromise.catch(() => undefined);
    this.offerPromise = offerPromise;

    // 2. Control channel
    const create = this.options.createWebSocket ?? ((u: string): WebSocket => new WebSocket(u));
    let ws: WebSocket;
    try {
      ws = create(url);
    } catch (err) {
      // A malformed URL (or a throwing factory) means no socket, no handlers and no terminal
      // callback — the offer already in flight would leak its peer connection, and `this.ws`
      // staying null would let a retry start a second one.
      this.generation += 1;
      offerPromise.then((o) => closeWebRtc(o.handle, null)).catch(() => undefined);
      this.offerPromise = null;
      this.currentState = 'closed';
      const message =
        err instanceof Error ? `Failed to open the control channel: ${err.message}` : 'Failed to open the control channel';
      log?.error(message);
      this.notify('onError', this.callbacks.onError, message, err);
      this.notify('onClose', this.callbacks.onClose, {
        code: CONTROL_CHANNEL_SETUP_FAILED_CLOSE_CODE,
        reason: message,
        wasClean: false,
      });
      return;
    }
    this.ws = ws;
    this.currentState = 'connecting';

    ws.onopen = async (): Promise<void> => {
      this.currentState = 'open';
      // The caller's bookkeeping is not ours to depend on: negotiation continues regardless
      this.notify('onOpen', this.callbacks.onOpen);

      let offer: WebRtcOffer;
      try {
        offer = await offerPromise;
      } catch (err) {
        if (generation !== this.generation) {
          // The control channel already closed and reported it: this rejection is a consequence,
          // not a new failure (createWebRtcOffer released its own peer connection)
          log?.debug('Offer rejected after the control channel closed — ignoring');
          return;
        }
        this.settlePendingTrack(
          err instanceof Error ? err : new Error('Failed to create the WebRTC offer')
        );
        this.notify(
          'onError',
          this.callbacks.onError,
          err instanceof Error ? `Failed to create WebRTC offer: ${err.message}` : 'Failed to create WebRTC offer',
          err
        );
        ws.close(); // onclose → callbacks.onClose
        return;
      }
      if (generation !== this.generation || this.ws !== ws) {
        // close() or a newer connect() happened while negotiating
        closeWebRtc(offer.handle, null);
        return;
      }
      this.handle = offer.handle;
      const pending = this.pendingTrack;
      if (pending) {
        this.pendingTrack = null;
        offer.handle.audioTransceiver.sender
          .replaceTrack(pending.track)
          .then(() => pending.resolve())
          .catch((err: unknown) => {
            log?.warn('Could not attach microphone track:', err);
            pending.reject(err);
          });
      }

      ws.send(JSON.stringify(buildRtcSdpCreateEvent(offer.sdpOffer, session)));
      log?.debug('Sent rtc.call.sdp.create');
      // Anything the caller sent while the call was being negotiated goes out now, in order
      const queued = this.preCallQueue.splice(0);
      if (queued.length > 0) {
        log?.debug(`Flushing ${queued.length} event(s) queued before the call was created`);
        for (const json of queued) ws.send(json);
      }

      this.negotiationTimer = setTimeout(() => {
        this.negotiationTimer = null;
        log?.error('Timed out waiting for rtc.call.sdp.created');
        // Tear down so a late answer cannot resurrect a session the caller reports as failed
        this.failTerminally(
          'WebRTC SDP negotiation timeout: the service sent no answer',
          RTC_NEGOTIATION_TIMEOUT_CLOSE_CODE
        );
      }, this.options.negotiationTimeoutMs ?? DEFAULT_RTC_NEGOTIATION_TIMEOUT_MS);
    };

    ws.onmessage = (event: MessageEvent): void => this.deliver(String(event.data), generation);

    ws.onerror = (event): void => {
      this.notify('onError', this.callbacks.onError, 'WebSocket connection error', event);
    };

    ws.onclose = (event: CloseEvent): void => {
      log?.info(`Control channel closed - Code: ${event.code}, Reason: ${event.reason || 'none'}, Clean: ${event.wasClean}`);
      this.currentState = 'closed';
      // Invalidate any negotiation still in flight: an offer that resolves after this must not
      // send SDP on the dead socket or arm a negotiation timer that fires 30 s later
      this.generation += 1;
      this.settlePendingTrack(new Error('Control channel closed before the microphone was attached'));
      if (this.ws === ws) this.ws = null;
      if (this.negotiationTimer) {
        clearTimeout(this.negotiationTimer);
        this.negotiationTimer = null;
      }
      this.teardownMedia();
      this.notify('onClose', this.callbacks.onClose, {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
    };
  }

  send(json: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (!this.handle) {
      // The control channel is open but the call is not created yet: queue rather than send into
      // a session the service does not have. Bounded, because a caller could keep writing.
      if (this.preCallQueue.length >= MAX_PRE_CALL_QUEUE) {
        this.options.log?.warn('Dropping event: too many events queued before the WebRTC call was created');
        return false;
      }
      this.preCallQueue.push(json);
      return true;
    }
    this.ws.send(json);
    return true;
  }

  async setMicrophoneTrack(track: MediaStreamTrack | null): Promise<void> {
    if (this.currentState === 'closed') {
      // Nothing will ever settle a pending attachment on a dead transport: the socket is gone with
      // its handlers detached, so the caller would wait forever instead of learning it failed
      throw new Error('Transport is closed — the microphone cannot be attached');
    }
    if (this.handle) {
      await this.handle.audioTransceiver.sender.replaceTrack(track);
      return;
    }
    // Offer still in flight — attach once the transceiver exists, and keep this promise open until
    // then so the caller learns whether the microphone actually got attached
    this.pendingTrack?.reject(new Error('Superseded by a newer microphone attachment'));
    return new Promise<void>((resolve, reject) => {
      this.pendingTrack = { track, resolve, reject };
    });
  }

  close(): void {
    this.generation++;
    this.currentState = 'closed';
    if (this.negotiationTimer) {
      clearTimeout(this.negotiationTimer);
      this.negotiationTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.teardownMedia();
    this.settlePendingTrack(new Error('Transport closed before the microphone was attached'));
    this.preCallQueue = [];
    this.seen.clear();
  }

  /**
   * Report a failure this transport cannot continue from, then end it.
   *
   * `onError` is advisory, so the close must follow — otherwise `state` stays `'open'` and the
   * caller can neither reconnect nor `connect()` again. The consumer's handler may itself call
   * `close()` (and even start a new connection on this instance), which bumps the generation:
   * continuing then would fire `onClose` after a caller-initiated `close()` promised no further
   * callbacks, and tear down the replacement connection.
   */
  private failTerminally(message: string, code: number, cause?: unknown): void {
    const generation = this.generation;
    // Don't hand consumers an explicit `undefined` cause: `onError(message)` and
    // `onError(message, undefined)` are the same contract, and the first is what they see today
    if (cause === undefined) {
      this.notify('onError', this.callbacks.onError, message);
    } else {
      this.notify('onError', this.callbacks.onError, message, cause);
    }
    if (generation !== this.generation) return;
    this.close();
    this.notify('onClose', this.callbacks.onClose, { code, reason: message, wasClean: false });
  }

  /** Fail a microphone attachment that can no longer happen, so the caller is never left waiting */
  private settlePendingTrack(reason: Error): void {
    const pending = this.pendingTrack;
    if (!pending) return;
    this.pendingTrack = null;
    pending.reject(reason);
  }

  /**
   * Parse, de-duplicate and dispatch a message from either channel; intercept the
   * negotiation events on the way.
   */
  private deliver(raw: string, generation: number): void {
    if (generation !== this.generation) return;
    const event = parseServerEvent(raw);
    if (!event) {
      this.options.log?.warn('Ignoring non-JSON message from the service');
      return;
    }
    if (typeof event.event_id === 'string' && this.seen.seenBefore(event.event_id)) {
      this.options.log?.debug(`Duplicate event ignored: ${event.type}`);
      return;
    }
    // Report first, act second: `rtc.call.error` tears the session down, and a consumer that only
    // sees events through `onEvent` would never learn why if the teardown ran first. The callback
    // is consumer code, so it must not be able to strand the negotiation that follows.
    this.notify('onEvent', this.callbacks.onEvent, event);
    if (generation !== this.generation) {
      // The consumer closed (or replaced) this transport from its handler: `close()` promises no
      // further callbacks, and acting now could tear down its replacement
      this.options.log?.debug('Transport changed inside onEvent — dropping the rest of this event');
      return;
    }
    this.handleNegotiationEvent(event);
  }

  private handleNegotiationEvent(event: VoiceLiveServerEvent): void {
    if (event.type === 'rtc.call.sdp.created') {
      if (this.negotiationTimer) {
        clearTimeout(this.negotiationTimer);
        this.negotiationTimer = null;
      }
      const handle = this.handle;
      if (!handle) return;
      const generation = this.generation;
      applyRtcSdpAnswer(handle.pc, event.sdp_answer)
        .then(() => this.options.log?.debug('WebRTC SDP answer applied'))
        .catch((err: unknown) => {
          if (generation !== this.generation) return;
          this.failTerminally('Failed to apply WebRTC SDP answer', RTC_SDP_ANSWER_FAILED_CLOSE_CODE, err);
        });
    } else if (event.type === 'rtc.call.error') {
      const message = formatRtcCallError(event as RtcCallErrorEvent);
      this.options.log?.error(message);
      // The service rejected the call: there will be no answer and no media, so this is terminal.
      // Closing releases the control channel and lets the caller reconnect or connect() again.
      this.failTerminally(message, RTC_CALL_ERROR_CLOSE_CODE, event);
    }
  }

  private clearDataChannelFallback(): void {
    if (this.dataChannelFallbackTimer) {
      clearTimeout(this.dataChannelFallbackTimer);
      this.dataChannelFallbackTimer = null;
    }
  }

  /** Close the peer connection / data channel (local mic tracks are owned by the caller) */
  private teardownMedia(): void {
    this.clearDataChannelFallback();
    closeWebRtc(this.handle, null);
    this.handle = null;
    // If the offer resolves after teardown, release it too
    const offer = this.offerPromise;
    this.offerPromise = null;
    offer?.then((o) => closeWebRtc(o.handle, null)).catch(() => undefined);
  }
}
