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

/**
 * Upper bound on automatic responses remembered while the gate is busy.
 *
 * Reservations are cheap: the watchdog drops *all* of them at once (see `releaseSpeculative`), so
 * a burst of server-VAD commits costs one interval, not one per commit. The bound only exists so
 * a pathological stream of commits cannot grow the counter without limit; beyond it an
 * announcement is forgotten, and a queued turn may overlap that response — the service rejects
 * that with an `error`, which the gate recovers from.
 */
const MAX_DEFERRED_AUTOMATIC = 8;

export class ResponseGate {
  private state: ResponseGateState = 'idle';
  private queued = false;
  /** `event_id` of the `response.create` we are waiting to be acknowledged (for error correlation) */
  private pendingEventId: string | null = null;
  /**
   * True while the reservation is *speculative*: the service told us it will start a response by
   * itself (server VAD with `create_response: true`), but has not acknowledged one yet.
   */
  private speculative = false;
  /**
   * How many automatic responses the service announced (server VAD committed a turn) while
   * another one was already running or requested. Each reservation can only be taken once the
   * gate frees up, so they are counted and applied one after another — otherwise a queued turn
   * would be sent straight into the window where the service is starting one of them.
   *
   * Counted rather than flagged because a user can commit several turns during one response, and
   * bounded because every unclaimed reservation costs one watchdog interval to release: a burst
   * of VAD false positives must not defer the conversation indefinitely.
   */
  private automaticPending = 0;

  /** Current lifecycle state (for logging/tests) */
  get currentState(): ResponseGateState {
    return this.state;
  }

  /** True while a response is running or one has been requested but not yet acknowledged */
  get isBusy(): boolean {
    return this.state !== 'idle';
  }

  /** True while waiting for the service to acknowledge a response it starts on its own */
  get isSpeculative(): boolean {
    return this.speculative;
  }

  /** The `event_id` of the outstanding request, if it was sent with one */
  get outstandingEventId(): string | null {
    return this.pendingEventId;
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
    this.speculative = false;
    this.pendingEventId = null;
    return true;
  }

  /**
   * Record the `event_id` the outstanding `response.create` was actually sent with, so an `error`
   * naming it can be recognised as a rejection of *this* request. Called by the single place that
   * puts a `response.create` on the wire — including the flush of a queued one.
   */
  trackRequest(eventId: string): void {
    if (this.state === 'requested') {
      this.pendingEventId = eventId;
      this.speculative = false;
    }
  }

  /**
   * The service is about to start a response by itself (server VAD committed a user turn with
   * `create_response: true`). Reserving the slot keeps a consumer turn submitted in the
   * acknowledgement window from overlapping it — such a turn is queued instead.
   *
   * The reservation is speculative: `releaseSpeculative()` must undo it if no `response.created`
   * follows, so a service that decides not to answer cannot block later turns.
   */
  reserveAutomatic(): void {
    if (this.isBusy) {
      if (this.automaticPending < MAX_DEFERRED_AUTOMATIC) this.automaticPending += 1;
      return;
    }
    this.state = 'requested';
    this.speculative = true;
    this.pendingEventId = null;
  }

  /**
   * Take a reservation that was deferred because the gate was busy (see `automaticPending`).
   *
   * Every path that frees the gate goes through this first: the announced response is still
   * coming, whether our own request finished, was rejected, or never reached the service. Missing
   * one of them sends the next turn straight into the window the service is about to use.
   *
   * @returns true when the reservation was taken (the gate stays busy, speculatively)
   */
  private takeDeferredAutomatic(): boolean {
    if (this.automaticPending === 0) return false;
    this.automaticPending -= 1;
    this.state = 'requested';
    this.speculative = true;
    this.pendingEventId = null;
    return true;
  }

  /**
   * Undo a speculative reservation that was never acknowledged.
   * @returns true when a queued request should be sent now
   */
  releaseSpeculative(): boolean {
    if (!this.speculative || this.state !== 'requested') return false;
    this.speculative = false;
    this.state = 'idle';
    // The service did not start the response it announced. Anything it announced *behind* that one
    // is equally stale, so every deferred reservation is dropped together: holding them would
    // defer the consumer's turn by one more watchdog interval each, and the conversation would
    // stall for as long as the VAD kept misfiring.
    this.automaticPending = 0;
    if (this.queued) {
      this.queued = false;
      this.state = 'requested';
      return true;
    }
    return false;
  }

  /** The service acknowledged a response (`response.created`) */
  onResponseCreated(): void {
    this.state = 'active';
    this.speculative = false;
    this.pendingEventId = null;
  }

  /**
   * A response finished (`response.done`).
   * @returns true when a queued request should be sent now (the gate moves back to `requested`).
   */
  onResponseDone(): boolean {
    // The service may be about to start a response it announced while this one was running: hold
    // the slot for it and keep any queued turn queued — it is answered after that response.
    if (this.takeDeferredAutomatic()) return false;
    if (this.queued) {
      this.queued = false;
      this.state = 'requested';
      this.speculative = false;
      this.pendingEventId = null;
      return true;
    }
    this.state = 'idle';
    this.speculative = false;
    this.pendingEventId = null;
    return false;
  }

  /**
   * The service reported an error. It may have been the rejection of the request we are waiting
   * on, in which case no `response.done` will arrive — so the conversation is idle again rather
   * than deferring every later turn forever.
   *
   * @returns true when a queued request should be sent now (it never reached the service)
   */
  onError(errorEventId?: string | null): boolean {
    if (this.state !== 'requested') return false; // an error during a running response is not ours
    // A speculative reservation put nothing on the wire, so no error can be its rejection. Errors
    // provoked by other client events (an empty input_audio_buffer.commit, an invalid
    // session.update) arrive without an `event_id` and would otherwise release the reservation
    // that exists precisely to keep the next turn from overlapping the service's own response.
    // `releaseSpeculative()` (driven by a timeout) remains the way out if none arrives.
    if (this.speculative) return false;
    // Correlate when we can: an error caused by a *different* client event (say an invalid
    // session.update) says nothing about the response.create we are waiting for. Errors without an
    // `event_id` stay ambiguous and are treated as ours, because a stuck gate would block every
    // later turn — a rare extra release is the safer failure.
    if (errorEventId && this.pendingEventId && errorEventId !== this.pendingEventId) return false;
    this.pendingEventId = null;
    this.speculative = false;
    // A response the service announced while our request was in flight is still coming: releasing
    // to idle here would send the queued turn into that window
    if (this.takeDeferredAutomatic()) return false;
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
      this.speculative = false;
      this.pendingEventId = null;
      this.takeDeferredAutomatic();
    }
  }

  /**
   * Take the queued request, if any, so a *different* mechanism can satisfy it — specifically a
   * tool batch that will send one `response.create` after its outputs. The user's message itself
   * is already in the conversation, so that single response answers both.
   *
   * @returns true when a queued request was handed over
   */
  consumeQueuedRequest(): boolean {
    if (!this.queued) return false;
    this.queued = false;
    return true;
  }

  /** New session: forget everything */
  reset(): void {
    this.state = 'idle';
    this.queued = false;
    this.speculative = false;
    this.automaticPending = 0;
    this.pendingEventId = null;
  }
}
