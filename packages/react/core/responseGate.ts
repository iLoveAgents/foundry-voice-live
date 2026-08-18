/**
 * Serializes `response.create`.
 *
 * Voice Live rejects overlapping responses, and "is a response running?" cannot be answered from
 * the server's `response.created` alone: between sending `response.create` and receiving that
 * acknowledgement the conversation *looks* idle, so two quick turns would both fire. This gate
 * models the full lifecycle instead of guessing from individual events:
 *
 * ```text
 *            request()                 response.created            response.done
 *   idle  ────────────────► requested ──────────────────► active ────────────────► idle
 *     ▲        │  (send)                                              │ (send if queued)
 *     └────────┴── request() while requested/active → queue one ──────┘
 * ```
 *
 * Only one request is ever queued: several turns arriving during one response collapse into a
 * single follow-up, which is what the service expects.
 */
export type ResponseGateState = 'idle' | 'requested' | 'active';

export class ResponseGate {
  private state: ResponseGateState = 'idle';
  private queued = false;

  /** Current lifecycle state (for logging/tests) */
  get currentState(): ResponseGateState {
    return this.state;
  }

  /** True while a response is running or one has been requested but not yet acknowledged */
  get isBusy(): boolean {
    return this.state !== 'idle';
  }

  /** True when a follow-up request is waiting for the running response to finish */
  get hasQueuedRequest(): boolean {
    return this.queued;
  }

  /**
   * Ask for a response.
   * @returns true when the caller should send `response.create` now; false when it was queued.
   */
  request(): boolean {
    if (this.isBusy) {
      this.queued = true;
      return false;
    }
    this.state = 'requested';
    return true;
  }

  /** The service acknowledged a response (`response.created`) */
  onResponseCreated(): void {
    this.state = 'active';
  }

  /**
   * A response finished (`response.done`).
   * @returns true when a queued request should be sent now (the gate moves back to `requested`).
   */
  onResponseDone(): boolean {
    if (this.queued) {
      this.queued = false;
      this.state = 'requested';
      return true;
    }
    this.state = 'idle';
    return false;
  }

  /**
   * The service reported an error. It may have been the rejection of the request we are waiting
   * on, in which case no `response.done` will arrive — so the conversation is idle again rather
   * than deferring every later turn forever.
   *
   * @returns true when a queued request should be sent now (it never reached the service)
   */
  onError(): boolean {
    if (this.state !== 'requested') return false; // an error during a running response is not ours
    if (this.queued) {
      this.queued = false;
      return true; // stay 'requested': the caller sends the queued turn instead
    }
    this.state = 'idle';
    return false;
  }

  /**
   * The `response.create` that `request()` just approved could not be sent (no open transport).
   * Nothing reached the service, so the gate must not stay busy — otherwise every later turn is
   * queued behind a response that will never start.
   */
  onRequestNotSent(): void {
    if (this.state === 'requested') {
      this.state = 'idle';
    }
  }

  /** New session: forget everything */
  reset(): void {
    this.state = 'idle';
    this.queued = false;
  }
}
