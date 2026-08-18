/**
 * Bounded queue for browser messages that arrive before the upstream Azure socket is open.
 *
 * Clients such as the WebRTC transport send `rtc.call.sdp.create` immediately on open, so the
 * messages must be kept — but the client is not authenticated yet at that point, and `ws` allows
 * very large frames by default, so the queue is bounded by **bytes** as well as by frame count.
 */

/** Default number of frames kept while the upstream connection is pending */
export const DEFAULT_MAX_PENDING_MESSAGES = 256;

/**
 * Default cumulative byte budget for queued frames. A `session.update` +
 * `rtc.call.sdp.create` handshake is a few KB, so 1 MiB is generous.
 */
export const DEFAULT_MAX_PENDING_BYTES = 1024 * 1024;

/** What the caller should do after offering a message to the queue */
export type PendingQueueResult =
  /** Queued for the flush after the upstream socket opens */
  | 'queued'
  /** Frame count exceeded — drop this message, keep the connection */
  | 'dropped'
  /** Byte budget exceeded — close the client connection */
  | 'over-budget';

export interface PendingQueueLimits {
  maxMessages?: number;
  maxBytes?: number;
}

export class PendingMessageQueue {
  private readonly messages: string[] = [];
  private bytes = 0;
  readonly maxMessages: number;
  readonly maxBytes: number;

  constructor(limits: PendingQueueLimits = {}) {
    this.maxMessages = limits.maxMessages ?? DEFAULT_MAX_PENDING_MESSAGES;
    this.maxBytes = limits.maxBytes ?? DEFAULT_MAX_PENDING_BYTES;
  }

  get size(): number {
    return this.messages.length;
  }

  get byteLength(): number {
    return this.bytes;
  }

  /**
   * Offer a message. Exceeding the byte budget is reported as `'over-budget'` (the caller should
   * close the connection: a client that sends megabytes before the session exists is abusive),
   * exceeding the frame count only drops the message.
   */
  push(text: string): PendingQueueResult {
    const size = Buffer.byteLength(text, 'utf8');
    if (this.bytes + size > this.maxBytes) {
      return 'over-budget';
    }
    if (this.messages.length >= this.maxMessages) {
      return 'dropped';
    }
    this.messages.push(text);
    this.bytes += size;
    return 'queued';
  }

  /** Remove and return everything queued so far */
  drain(): string[] {
    const drained = this.messages.splice(0);
    this.bytes = 0;
    return drained;
  }
}
