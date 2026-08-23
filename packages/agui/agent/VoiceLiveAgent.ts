/**
 * `VoiceLiveAgent` — a client-side AG-UI agent driven by a live Voice Live session.
 *
 * Extends `AbstractAgent` (never `HttpAgent`: CopilotKit special-cases `instanceof HttpAgent`), so
 * `<CopilotKit agents={{ voice: agent }}>` renders its message/tool/state stream like any other
 * AG-UI agent.
 *
 * The problem AG-UI does not natively model: a voice turn is *server-initiated*. Nobody calls
 * `runAgent()` — the user just speaks. So the React glue feeds Voice Live events into this agent
 * (`ingestServerEvent`), the mapper decides where AG-UI runs begin and end, and the glue *pumps*:
 * each time the mapper opens a run, the glue calls `agent.pump()`, which calls `runAgent()` so
 * `AbstractAgent` accumulates the turn's messages exactly as if the user had typed.
 *
 * Run delivery uses a **ReplaySubject per run**. A voice run can open *and close* in the microtask
 * gap before the pump's `runAgent()` subscribes (a one-word answer). A plain Subject would drop
 * every event to that late subscriber and the turn would vanish; a ReplaySubject buffers the run's
 * events *and its completion*, so a late `runAgent()` replays the whole run and then completes
 * cleanly. That is the bounded FIFO the plan calls for, expressed as rxjs.
 */

import { AbstractAgent } from '@ag-ui/client';
import type { RunAgentInput, State } from '@ag-ui/client';
import { EMPTY, Observable, ReplaySubject, Subject } from 'rxjs';
import { EventType } from '@ag-ui/core';
import { VoiceLiveAguiMapper, initialVoiceState, toAguiState } from '../core';
import type {
  BaseEvent,
  HostEvent,
  MapperOutput,
  VoiceLiveClientEvent,
  VoiceLiveServerEvent,
} from '../core/types';

/** What the agent needs from the live Voice Live session to drive the wire (wired by the glue). */
export interface VoiceSessionBridge {
  /** Put a client event on the wire (used for a UI-typed turn). */
  sendEvent: (event: VoiceLiveClientEvent) => void;
  /** Cancel the in-flight response (barge-in / stop button). */
  cancelResponse: () => void;
}

export interface VoiceLiveAgentOptions {
  threadId?: string;
  agentId?: string;
  description?: string;
  /** Injected id generator (deterministic in tests). */
  generateId?: () => string;
  passthroughRaw?: boolean;
  runIdleTimeoutMs?: number;
  transport?: 'websocket' | 'webrtc';
  /** Cap on runs buffered but not yet consumed by the pump (defends against a stalled pump). */
  maxPendingRuns?: number;
}

const DEFAULT_MAX_PENDING_RUNS = 32;

export class VoiceLiveAgent extends AbstractAgent {
  private readonly mapper: VoiceLiveAguiMapper;
  private readonly generateId: () => string;
  private readonly maxPendingRuns: number;

  /** Every event the mapper emits (in-run and between-run) — a side channel for a raw-stream UI. */
  readonly events$: Subject<BaseEvent> = new Subject<BaseEvent>();

  /** The channel for the run currently open on the wire, or null between runs. */
  private currentRun: ReplaySubject<BaseEvent> | null = null;
  /** Runs opened by the server but not yet bound to a `runAgent()` call (pump lag). */
  private readonly runQueue: ReplaySubject<BaseEvent>[] = [];
  /** True while `pump()` is inside `runAgent()`, so `run()` takes the voice path, not the typed one. */
  private pumpRunActive = false;
  private pumping = false;
  private bridge: VoiceSessionBridge | null = null;
  /** User message ids already forwarded to the wire, so a re-run never double-sends a typed turn. */
  private readonly forwardedUserIds = new Set<string>();

  constructor(options: VoiceLiveAgentOptions = {}) {
    super({
      agentId: options.agentId ?? 'voice',
      description: options.description ?? 'Azure Voice Live session bridged to AG-UI',
      threadId: options.threadId,
      initialState: toAguiState(initialVoiceState(options.transport)) as State,
    });
    this.generateId = options.generateId ?? (() => `vl-${Math.random().toString(36).slice(2, 10)}`);
    this.maxPendingRuns = options.maxPendingRuns ?? DEFAULT_MAX_PENDING_RUNS;
    this.mapper = new VoiceLiveAguiMapper({
      threadId: this.threadId,
      generateId: options.generateId,
      passthroughRaw: options.passthroughRaw,
      runIdleTimeoutMs: options.runIdleTimeoutMs,
      transport: options.transport,
    });
  }

  /** The glue calls this once, after `useVoiceLive` returns, to wire the write side. */
  attachBridge(bridge: VoiceSessionBridge): void {
    this.bridge = bridge;
  }

  // ---- fed by the glue ------------------------------------------------------

  /** A raw Voice Live server event (from the hook's `onEvent`). Returns whether a run just opened. */
  ingestServerEvent(event: VoiceLiveServerEvent): { runOpened: boolean } {
    return this.dispatch(this.mapper.handleServerEvent(event));
  }

  /** A host fact the wire does not carry (readiness, mic state, a tool result). */
  ingestHostEvent(event: HostEvent): { runOpened: boolean } {
    return this.dispatch(this.mapper.handleHostEvent(event));
  }

  /** Idle-watchdog tick from the glue's timer; closes an orphaned run. */
  tick(nowMs: number): { runOpened: boolean } {
    return this.dispatch(this.mapper.tick(nowMs));
  }

  /** True while a run is open on the wire (the glue decides whether to keep pumping). */
  get hasOpenRun(): boolean {
    return this.currentRun !== null;
  }

  /** Number of opened-but-unconsumed runs waiting for the pump. */
  get pendingRunCount(): number {
    return this.runQueue.length;
  }

  /**
   * Fan the mapper's events into the current run channel. Run boundaries are read straight from the
   * canonical events (`RUN_STARTED` opens, `RUN_FINISHED`/`RUN_ERROR` closes) rather than a summary
   * flag — a single mapper output can *close* one run and *open* the next (barge-in), and only the
   * event order preserves that. Between runs, state events are applied to `agent.state` directly.
   */
  private dispatch(out: MapperOutput): { runOpened: boolean } {
    let opened = false;
    for (const ev of out.events) {
      const type = (ev as { type: EventType }).type;
      if (type === EventType.RUN_STARTED) {
        this.openServerRun();
        opened = true;
        this.events$.next(ev);
        this.currentRun?.next(ev);
        continue;
      }
      this.events$.next(ev);
      if (this.currentRun) {
        this.currentRun.next(ev);
        if (type === EventType.RUN_FINISHED || type === EventType.RUN_ERROR) {
          const run = this.currentRun;
          this.currentRun = null;
          run.complete();
        }
      } else {
        this.applyBetweenRunEvent(ev);
      }
    }
    return { runOpened: opened };
  }

  /** A fresh server-opened run: create its channel, hand it to a waiting `run()` or queue it. */
  private openServerRun(): void {
    // A previous run that never closed (should not happen) must not leak its channel.
    if (this.currentRun) {
      const stale = this.currentRun;
      this.currentRun = null;
      stale.complete();
    }
    const run = new ReplaySubject<BaseEvent>();
    this.currentRun = run;
    this.runQueue.push(run);
    // Drop the oldest unconsumed run if the pump has stalled — and say so, never silently.
    while (this.runQueue.length > this.maxPendingRuns) {
      const dropped = this.runQueue.shift();
      dropped?.complete();
      // eslint-disable-next-line no-console
      console.warn(
        `[VoiceLiveAgent] pump backlog exceeded ${this.maxPendingRuns} runs; dropped the oldest un-pumped run`
      );
    }
  }

  /**
   * Between runs, only host breadcrumbs occur (STATE_*, CUSTOM, RAW, MESSAGES_SNAPSHOT). State must
   * still reach CopilotKit — it cannot ride a run observable here (there is none), so apply it
   * straight to `agent.state` from the mapper's authoritative snapshot (one source of truth).
   */
  private applyBetweenRunEvent(ev: BaseEvent): void {
    const type = (ev as { type: EventType }).type;
    if (type === EventType.STATE_SNAPSHOT || type === EventType.STATE_DELTA) {
      this.setState(toAguiState(this.mapper.snapshot.state) as State);
    }
  }

  // ---- pump: turn server-opened runs into runAgent() calls -------------------

  /**
   * Drain every queued run through `runAgent()`, serialized. The glue calls this (fire-and-forget)
   * whenever `ingest*` reports a run opened. Re-entrant calls are absorbed by the `pumping` guard;
   * the while-loop picks up runs queued while an earlier `runAgent()` was in flight.
   */
  async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.runQueue.length > 0) {
        this.pumpRunActive = true;
        try {
          await this.runAgent();
        } catch {
          // A single failed run must not wedge the pump; the next turn gets a fresh run.
        } finally {
          this.pumpRunActive = false;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  // ---- AbstractAgent contract ------------------------------------------------

  /**
   * Called by `runAgent()`. Two callers:
   *  - our own `pump()` (voice turn): bind to the next queued run channel.
   *  - CopilotKit's composer (typed turn): forward the text to the wire and own a fresh run channel
   *    that the resulting server events flow into.
   */
  run(input: RunAgentInput): Observable<BaseEvent> {
    if (this.pumpRunActive) {
      const queued = this.runQueue.shift();
      return queued ? queued.asObservable() : EMPTY;
    }
    return this.runTypedTurn(input);
  }

  private runTypedTurn(input: RunAgentInput): Observable<BaseEvent> {
    const messages = input.messages ?? [];
    const last = messages[messages.length - 1];
    const text =
      last && last.role === 'user' && typeof last.content === 'string' ? last.content.trim() : '';

    if (!text || !this.bridge || (last && this.forwardedUserIds.has(last.id))) {
      // Nothing to say, or no live session — a one-shot error run keeps the UI out of "generating".
      return this.errorRun(
        !this.bridge ? 'Voice session is not connected.' : 'No user message to send.'
      );
    }

    return new Observable<BaseEvent>((subscriber) => {
      // A typed turn is a barge-in over any open voice run.
      if (this.currentRun) {
        const stale = this.currentRun;
        this.currentRun = null;
        stale.complete();
      }
      const run = new ReplaySubject<BaseEvent>();
      this.currentRun = run;
      if (last) this.forwardedUserIds.add(last.id);

      const { events, commands } = this.mapper.submitUserMessage(text, { messageId: last?.id });
      for (const ev of events) {
        // Keep RUN_STARTED, but do not re-echo the user's own message: CopilotKit/AbstractAgent
        // already hold it in `input.messages` (this is exactly how HttpAgent behaves — the backend
        // streams back only assistant output). Re-emitting it would duplicate the bubble.
        if (this.isUserEcho(ev, last?.id)) continue;
        this.events$.next(ev);
        run.next(ev);
      }
      for (const cmd of commands) this.bridge?.sendEvent(cmd);

      const sub = run.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }

  /** Barge-in from the UI (CopilotKit stop) → cancel the spoken response and close the run. */
  override abortRun(): void {
    this.bridge?.cancelResponse();
    this.dispatch(this.mapper.close('cancelled'));
    super.abortRun();
  }

  private isUserEcho(ev: BaseEvent, userId: string | undefined): boolean {
    const e = ev as { type: EventType; messageId?: string };
    return (
      !!userId &&
      e.messageId === userId &&
      (e.type === EventType.TEXT_MESSAGE_START ||
        e.type === EventType.TEXT_MESSAGE_CONTENT ||
        e.type === EventType.TEXT_MESSAGE_END)
    );
  }

  /** A self-contained run carrying a single error (RUN_STARTED → RUN_ERROR), for typed-turn guards. */
  private errorRun(message: string): Observable<BaseEvent> {
    const runId = this.generateId();
    const started = {
      type: EventType.RUN_STARTED,
      threadId: this.threadId,
      runId,
    } as unknown as BaseEvent;
    const errored = {
      type: EventType.RUN_ERROR,
      message,
      runId,
    } as unknown as BaseEvent;
    return new Observable<BaseEvent>((subscriber) => {
      this.events$.next(started);
      this.events$.next(errored);
      subscriber.next(started);
      subscriber.next(errored);
      subscriber.complete();
    });
  }
}
