/**
 * Scopes: the one mechanism for "does this work still belong to a live session?".
 *
 * A voice session is a web of async work — permission prompts, SDP negotiation, worklet loading,
 * user tool executors — any of which can resolve *after* the session it belonged to has ended.
 * Every one of those continuations must ask the same question, so it is asked in one way:
 *
 * ```ts
 * const scope = sessionScope;          // capture before awaiting
 * const track = await getMicrophone();
 * if (!scope.isActive) { release(track); return; }
 * ```
 *
 * There are exactly two lifetimes in this SDK, and mixing them up is a bug (it was one):
 *
 * - **connection** — `connect()` → `disconnect()`/unmount. Survives reconnect attempts, so things
 *   the user owns across a hiccup (the microphone, the `AudioContext`) hang off this scope.
 * - **session** — one control channel / one service-side conversation. A child of the connection
 *   scope, replaced on every (re)connect attempt, so anything referring to conversation state
 *   (tool call ids, response ids, readiness) hangs off this one.
 *
 * Aborting a scope aborts its children first, then runs its `onAbort` handlers once.
 */
export class Scope {
  private abortedFlag = false;
  private children: Scope[] = [];
  private handlers: Array<() => void> = [];

  constructor(readonly name: string = 'scope') {}

  /** False once this scope (or an ancestor) has been aborted */
  get isActive(): boolean {
    return !this.abortedFlag;
  }

  /**
   * A scope that is aborted together with this one (but can also be aborted on its own), e.g. one
   * session inside a connection.
   */
  child(name = `${this.name}.child`): Scope {
    const child = new Scope(name);
    if (this.abortedFlag) {
      child.abort();
      return child;
    }
    this.children.push(child);
    return child;
  }

  /**
   * Run `fn` when this scope is aborted (timers, sockets, media). Runs immediately if the scope is
   * already aborted, so registration can never be missed by a race.
   */
  onAbort(fn: () => void): void {
    if (this.abortedFlag) {
      fn();
      return;
    }
    this.handlers.push(fn);
  }

  /** End this scope and all of its children. Idempotent. */
  abort(): void {
    if (this.abortedFlag) return;
    this.abortedFlag = true;
    const children = this.children.splice(0);
    for (const child of children) child.abort();
    const handlers = this.handlers.splice(0);
    for (const handler of handlers) {
      try {
        handler();
      } catch {
        // a failing cleanup handler must not prevent the others
      }
    }
  }

  /** Forget aborted children so a long-lived connection scope does not accumulate them */
  pruneChildren(): void {
    this.children = this.children.filter((child) => child.isActive);
  }
}
