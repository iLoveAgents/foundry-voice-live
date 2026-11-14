/**
 * WebSocket transport: audio and events share one socket (`/voice-live/realtime`).
 */

import type { Logger } from '../../utils/logger';
import { parseServerEvent } from '../serverEvents';
import { CONTROL_CHANNEL_SETUP_FAILED_CLOSE_CODE } from './webrtcTransport';
import type { TransportCallbacks, TransportState, VoiceLiveTransport } from './types';

export interface WebSocketTransportOptions {
  log?: Logger;
  /** Factory for the socket (test seam) */
  createWebSocket?: (url: string) => WebSocket;
}

export class WebSocketTransport implements VoiceLiveTransport {
  readonly kind = 'websocket' as const;
  private ws: WebSocket | null = null;
  private currentState: TransportState = 'idle';

  constructor(
    private readonly callbacks: TransportCallbacks,
    private readonly options: WebSocketTransportOptions = {}
  ) {}

  get state(): TransportState {
    return this.currentState;
  }

  /** Consumer callbacks never affect our control flow (see `WebRtcTransport.notify`) */
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

  connect(url: string): void {
    if (this.ws) {
      throw new Error(
        'WebSocketTransport.connect() called twice — create a new transport per connection'
      );
    }
    const create = this.options.createWebSocket ?? ((u: string): WebSocket => new WebSocket(u));
    let ws: WebSocket;
    try {
      ws = create(url);
    } catch (err) {
      // No socket means no handlers will ever fire: report terminally rather than silently
      this.currentState = 'closed';
      const message =
        err instanceof Error
          ? `Failed to open the WebSocket: ${err.message}`
          : 'Failed to open the WebSocket';
      this.options.log?.error(message);
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

    ws.onopen = (): void => {
      this.currentState = 'open';
      this.notify('onOpen', this.callbacks.onOpen);
    };
    ws.onmessage = (event: MessageEvent): void => {
      const parsed = parseServerEvent(String(event.data));
      if (!parsed) {
        this.options.log?.warn('Ignoring non-JSON message from the service');
        return;
      }
      this.notify('onEvent', this.callbacks.onEvent, parsed);
    };
    ws.onerror = (event): void => {
      this.notify('onError', this.callbacks.onError, 'WebSocket connection error', event);
    };
    ws.onclose = (event: CloseEvent): void => {
      this.currentState = 'closed';
      this.notify('onClose', this.callbacks.onClose, {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
    };
  }

  send(json: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(json);
    return true;
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.currentState = 'closed';
    if (!ws) return;
    // Detach every handler first: a socket that is still CONNECTING must not report a spurious
    // error/close after the caller already moved on
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

  async setMicrophoneTrack(): Promise<void> {
    // Microphone audio is sent as input_audio_buffer.append events by the caller
  }
}
