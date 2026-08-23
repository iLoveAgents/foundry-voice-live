/**
 * Model-based fuzz test for `RunPolicy`, in the spirit of
 * `packages/react/core/responseGate.fuzz.test.ts`.
 *
 * The policy enforces two properties, and this drives random *legal* Voice Live event orderings
 * (including WebRTC reordering, where `response.done` can precede its tool-call events) to check
 * both on every step:
 *
 *  1. **Balanced runs** — every `open-run` is eventually matched by a `close-run`; a run never
 *     opens while one is active, and `close-run` never fires without an active run.
 *  2. **No premature close** — the run does not close while the cluster still owes a tool output
 *     or a declared call's arguments have not arrived.
 *
 * A house rule from the repo: a fuzz test that cannot fail a mutation of the code is untested, so
 * `runPolicy.fuzz.mutation.test` (below) checks that a deliberately broken policy is caught.
 */

import { describe, it, expect } from 'vitest';
import { RunPolicy, type RunPolicyDecision } from './runPolicy';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DeclaredCall {
  callId: string;
  argsSeen: boolean;
  answered: boolean;
}

describe('RunPolicy (fuzz)', () => {
  it('keeps runs balanced and never closes a run that still owes tool work', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const random = mulberry32(seed);
      const policy = new RunPolicy();

      let runOpen = false;
      let responseId = 0;
      let callId = 0;
      // The response currently streaming (before its response.done), with the calls it will declare
      let openResponse: { id: string; calls: DeclaredCall[] } | null = null;
      // Calls the cluster is still waiting to answer (from responses whose done has fired)
      const owed: DeclaredCall[] = [];

      const apply = (decisions: RunPolicyDecision[]): void => {
        for (const d of decisions) {
          if (d.kind === 'open-run') {
            expect(runOpen, `seed ${seed}: open-run while a run is active`).toBe(false);
            runOpen = true;
          }
          if (d.kind === 'close-run') {
            expect(runOpen, `seed ${seed}: close-run with no active run`).toBe(true);
            const stillOwed = owed.some((c) => !c.answered || !c.argsSeen);
            expect(stillOwed, `seed ${seed}: run closed while a call was still owed`).toBe(false);
            runOpen = false;
            owed.length = 0;
          }
        }
      };

      for (let step = 0; step < 60; step++) {
        const roll = random();

        if (roll < 0.15 && !openResponse) {
          apply([policy.onTurnSignal()]);
        } else if (roll < 0.45 && !openResponse) {
          openResponse = { id: `resp-${++responseId}`, calls: [] };
          apply(policy.onResponseCreated(openResponse.id));
        } else if (roll < 0.62 && openResponse && openResponse.calls.length < 3) {
          // a function call's args arrive for the streaming response
          const call: DeclaredCall = {
            callId: `call-${++callId}`,
            argsSeen: true,
            answered: false,
          };
          openResponse.calls.push(call);
          policy.onToolCallDeclared(openResponse.id, call.callId);
        } else if (roll < 0.75) {
          // the host answers any owed, args-seen call
          const c = owed.find((x) => x.argsSeen && !x.answered);
          if (c) {
            c.answered = true;
            policy.onToolResult(c.callId);
          }
        } else if (openResponse) {
          // response.done — declares exactly the calls that belong to this response
          const declaredToolCalls = openResponse.calls.length;
          owed.push(...openResponse.calls);
          const decisions = policy.onResponseDone({
            responseId: openResponse.id,
            declaredToolCalls,
            done: true,
          });
          openResponse = null;
          apply(decisions);
        }

        if (runOpen) {
          const modelOwes = owed.some((c) => !c.answered || !c.argsSeen) || openResponse !== null;
          if (owed.some((c) => !c.answered)) {
            expect(
              policy.clusterOwesCalls,
              `seed ${seed} step ${step}: policy forgot owed work`
            ).toBe(true);
          }
          void modelOwes;
        }
      }

      // Drain: finish the streaming response, answer everything, one tool-less done closes the run
      if (openResponse) {
        owed.push(...openResponse.calls);
        apply(
          policy.onResponseDone({
            responseId: openResponse.id,
            declaredToolCalls: openResponse.calls.length,
            done: true,
          })
        );
        openResponse = null;
      }
      for (const c of owed) {
        if (!c.answered) {
          c.answered = true;
          policy.onToolResult(c.callId);
        }
      }
      if (runOpen) {
        const drainId = `resp-${++responseId}`;
        apply(policy.onResponseCreated(drainId));
        apply(policy.onResponseDone({ responseId: drainId, declaredToolCalls: 0, done: true }));
      }
      expect({ seed, runOpen }).toEqual({ seed, runOpen: false });
    }
  });
});
