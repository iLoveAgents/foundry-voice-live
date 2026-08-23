/**
 * When does an AG-UI run open and close?
 *
 * AG-UI runs are bounded (`RUN_STARTED` … `RUN_FINISHED`), voice turns are not. The rule, isolated
 * here so it can be fuzzed the way `packages/react/core/responseGate.ts` is:
 *
 * - A run is **one turn cluster**, not one response. It opens on the first sign of a turn
 *   (`speech_started`, an input-transcription delta, or `response.created`) and closes on a
 *   `response.done` that has **no** `function_call` in its output — i.e. the model is done and is
 *   not waiting for a tool. A tool-calling turn keeps one run open across `response.done` → tool
 *   outputs → the follow-up `response.done`, so a UI's "generating" state does not flicker.
 * - Each response inside the cluster is a `STEP_STARTED` / `STEP_FINISHED` pair.
 * - Over WebRTC a `response.done` can arrive *before* its own `function_call_arguments.done`
 *   (independent channels), so "does this response owe tool calls" is answered from the
 *   `output[]` array in `response.done`, exactly as `useVoiceLive` does for its tool batches.
 *
 * The policy is a pure state machine: it never emits AG-UI events, it only decides run/step
 * boundaries. The mapper turns those decisions into events.
 */

export type RunPolicyDecision =
  | { kind: 'none' }
  | { kind: 'open-run' }
  | { kind: 'open-step'; responseId: string }
  | { kind: 'close-step'; responseId: string }
  | { kind: 'close-run'; reason: 'response_done' | 'cancelled' | 'error' | 'idle' | 'interrupted' }
  /** A response finished but its cluster still owes tool calls — close the step, keep the run */
  | { kind: 'close-step-keep-run'; responseId: string };

interface OpenResponse {
  responseId: string;
  /** How many `function_call` items this response declared (from `response.done.output`) */
  declaredToolCalls: number;
  /** Whether `response.done` has been seen for it */
  done: boolean;
}

export class RunPolicy {
  private runActive = false;
  private openStepId: string | null = null;
  /** Tool calls (`call_id`) still owed an output before the cluster can end */
  private readonly owedCalls = new Set<string>();
  /**
   * Responses that declared tool calls whose *argument* events have not all arrived yet. Over
   * WebRTC a `response.done` can precede its `function_call_arguments.done`, so a declared count
   * greater than the calls seen so far means the cluster is not finished even if nothing is owed.
   */
  private pendingDeclaredCalls = 0;
  private seenDeclaredCalls = 0;

  get isRunActive(): boolean {
    return this.runActive;
  }

  get clusterOwesCalls(): boolean {
    return this.owedCalls.size > 0 || this.seenDeclaredCalls < this.pendingDeclaredCalls;
  }

  /** A turn signal arrived (`speech_started` / transcription delta / `response.created`) */
  onTurnSignal(): RunPolicyDecision {
    if (this.runActive) return { kind: 'none' };
    this.runActive = true;
    return { kind: 'open-run' };
  }

  /** `response.created` — opens a run if none, and always opens a step */
  onResponseCreated(responseId: string): RunPolicyDecision[] {
    const decisions: RunPolicyDecision[] = [];
    if (!this.runActive) {
      this.runActive = true;
      decisions.push({ kind: 'open-run' });
    }
    this.openStepId = responseId;
    decisions.push({ kind: 'open-step', responseId });
    return decisions;
  }

  /** A function call arrived (its `call_id` is now owed an output) */
  onToolCallDeclared(_responseId: string, callId: string): void {
    if (!this.owedCalls.has(callId)) this.seenDeclaredCalls += 1;
    this.owedCalls.add(callId);
  }

  /** A `function_call_output` for `callId` was sent (by the executor or the consumer) */
  onToolResult(callId: string): void {
    this.owedCalls.delete(callId);
  }

  /**
   * `response.done`. `declaredToolCalls` is the count of `function_call` items in `output[]`.
   * Returns the step-close decision plus, when the cluster is complete, the run-close.
   */
  onResponseDone(response: OpenResponse): RunPolicyDecision[] {
    const decisions: RunPolicyDecision[] = [];
    if (!this.runActive) return decisions;

    if (this.openStepId === response.responseId) this.openStepId = null;

    if (response.declaredToolCalls > 0) {
      // This response is delegating to tools; the cluster continues until a tool-less response.done.
      // Record how many calls to expect so a `response.done` that races ahead of the arg events
      // (WebRTC) still keeps the run open.
      this.pendingDeclaredCalls += response.declaredToolCalls;
      decisions.push({ kind: 'close-step-keep-run', responseId: response.responseId });
      return decisions;
    }

    // A tool-less response: it completes its own step, and ends the cluster unless a tool call is
    // still owed an output (or its args are still in flight)
    decisions.push({ kind: 'close-step', responseId: response.responseId });
    if (this.owedCalls.size === 0 && this.seenDeclaredCalls >= this.pendingDeclaredCalls) {
      this.reset();
      decisions.push({ kind: 'close-run', reason: 'response_done' });
    }
    return decisions;
  }

  /** Barge-in / cancel / fatal error / idle watchdog — force the run closed */
  onForceClose(reason: 'cancelled' | 'error' | 'idle' | 'interrupted'): RunPolicyDecision[] {
    if (!this.runActive) return [];
    const decisions: RunPolicyDecision[] = [];
    // A step (response) may still be open (barge-in mid-response, cancel, error, idle) — close it
    // before the run, or the terminal RUN_FINISHED/RUN_ERROR is illegal (steps must be balanced).
    if (this.openStepId !== null) {
      decisions.push({ kind: 'close-step', responseId: this.openStepId });
    }
    this.reset();
    decisions.push({ kind: 'close-run', reason });
    return decisions;
  }

  private reset(): void {
    this.runActive = false;
    this.openStepId = null;
    this.owedCalls.clear();
    this.pendingDeclaredCalls = 0;
    this.seenDeclaredCalls = 0;
  }
}
