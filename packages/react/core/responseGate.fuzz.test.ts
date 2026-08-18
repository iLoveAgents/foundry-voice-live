/**
 * Model-based fuzz test for `ResponseGate`.
 *
 * The gate exists to enforce one property: **never two responses at once** — Voice Live rejects an
 * overlapping `response.create`, and a rejected turn is a turn the user never gets an answer to.
 * Its counterpart is just as important: the gate must never get **stuck busy**, because then no
 * later turn is ever sent and the conversation dies silently.
 *
 * Hand-written tests cover the sequences we thought of. This one drives random *legal* event
 * sequences through the gate together with a model of the service, and checks both properties on
 * every step — it is how the "an unrelated error releases the speculative reservation" and
 * "an automatic response announced mid-response is forgotten" bugs are kept from coming back in a
 * shape nobody wrote a test for.
 */
import { describe, it, expect } from 'vitest';
import { MAX_DEFERRED_AUTOMATIC, ResponseGate } from './responseGate';

/** Deterministic PRNG so a failure is reproducible from its seed */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ResponseGate (fuzz)', () => {
  it('never sends into a response that exists or is announced, and never gets stuck busy', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const random = mulberry32(seed);
      const gate = new ResponseGate();

      // Model of the service side. These three are independent: our unacknowledged request, a
      // running response, and a response the service announced it will start by itself.
      let ourRequestPending = false;
      let running = false;
      // How many automatic responses the service has announced and not yet started. The gate
      // remembers at most one deferred announcement, so two is the interesting bound: modelling
      // this as a boolean hides reservations that are dropped or duplicated.
      let announcedCount = 0;
      let sentEventId: string | null = null;
      let eventSeq = 0;

      const send = (): void => {
        // The property under test. Sending while any of these holds is an overlapping
        // `response.create`, which the service rejects — the turn is then never answered.
        expect({ seed, ourRequestPending, running, announcedCount }).toEqual({
          seed,
          ourRequestPending: false,
          running: false,
          announcedCount: 0,
        });
        const id = `evt_${++eventSeq}`;
        gate.trackRequest(id);
        sentEventId = id;
        ourRequestPending = true;
      };

      for (let step = 0; step < 60; step++) {
        const roll = random();

        if (roll < 0.2) {
          // A consumer turn (sendText, greeting, a raw response.create)
          if (gate.request()) send();
        } else if (roll < 0.32) {
          // `input_audio_buffer.speech_stopped`: server VAD committed a turn, so the service is
          // about to start a response of its own — whether or not one is running right now
          // The gate remembers up to MAX_DEFERRED_AUTOMATIC announcements; beyond that it
          // deliberately forgets, which the model must not exercise as if it were a defect
          if (announcedCount < MAX_DEFERRED_AUTOMATIC) {
            announcedCount += 1;
            gate.reserveAutomatic();
          }
        } else if (roll < 0.45) {
          // `response.created` — for our request, or for the announced automatic response
          if (ourRequestPending) {
            ourRequestPending = false;
            running = true;
            sentEventId = null;
            gate.onResponseCreated();
          } else if (announcedCount > 0 && !running) {
            announcedCount -= 1;
            running = true;
            gate.onResponseCreated();
          }
        } else if (roll < 0.62) {
          if (running) {
            running = false;
            if (gate.onResponseDone()) send();
          }
        } else if (roll < 0.72) {
          // The service rejected the `response.create` we are waiting on
          if (ourRequestPending) {
            const rejected = sentEventId;
            ourRequestPending = false;
            sentEventId = null;
            if (gate.onError(rejected)) send();
          }
        } else if (roll < 0.82) {
          // An error caused by some *other* client event (an invalid session.update, an empty
          // input_audio_buffer.commit): it says nothing about a response.
          //
          // Not delivered while our own request is unacknowledged: an id-less error in that window
          // is deliberately treated as ours (see `onError`) — the service may have rejected our
          // request without naming it, and a gate left waiting for a `response.done` that never
          // comes would block every later turn. That trade-off has its own unit test.
          if (!ourRequestPending && gate.onError(random() < 0.5 ? null : `evt_other_${step}`)) {
            send();
          }
        } else if (roll < 0.9) {
          // The speculative watchdog fires after the service dropped the announced response
          // The watchdog only fires while a reservation is actually held, and the gate then treats
          // everything announced behind it as stale too — so the model abandons all of it. Without
          // the `isSpeculative` guard the model would forget announcements the gate still holds,
          // and the overlap assertion below would become trivially satisfiable.
          if (announcedCount > 0 && !running && gate.isSpeculative) {
            announcedCount = 0;
            if (gate.releaseSpeculative()) send();
          }
        } else {
          // A tool batch takes the queued turn over and asks for the answer itself
          if (gate.consumeQueuedRequest() && gate.request()) send();
        }

        // The gate may only report `active` while a response really is running
        if (gate.currentState === 'active') expect({ seed, running }).toEqual({ seed, running: true });
      }

      // Liveness: settle everything the service still owes us. The gate must then be idle —
      // one that stays busy would silently swallow every later turn of the session.
      for (let drain = 0; drain < 8; drain++) {
        if (ourRequestPending) {
          ourRequestPending = false;
          if (gate.onError(sentEventId)) send();
          continue;
        }
        if (running) {
          running = false;
          if (gate.onResponseDone()) send();
          continue;
        }
        if (gate.isSpeculative) {
          announcedCount = 0;
          if (gate.releaseSpeculative()) send();
          continue;
        }
        if (announcedCount > 0) {
          // Announcements the gate is holding but has not claimed yet: the service abandoning them
          // is invisible to the gate, so only the model forgets them
          announcedCount = 0;
          continue;
        }
        break;
      }

      expect({ seed, state: gate.currentState }).toEqual({ seed, state: 'idle' });
      expect(gate.request()).toBe(true); // ...and the next turn still goes out
    }
  });
});
