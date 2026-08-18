import { describe, it, expect, vi } from 'vitest';
import { Scope } from './lifecycle';
import { ResponseGate } from './responseGate';

describe('Scope', () => {
  it('is active until aborted, and aborting is idempotent', () => {
    const scope = new Scope('connection');
    expect(scope.isActive).toBe(true);
    expect(scope.name).toBe('connection');
    const onAbort = vi.fn();
    scope.onAbort(onAbort);

    scope.abort();
    expect(scope.isActive).toBe(false);
    expect(onAbort).toHaveBeenCalledTimes(1);
    scope.abort();
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('aborts children with the parent but not the parent with a child', () => {
    const connection = new Scope('connection');
    const first = connection.child('session-1');
    const second = connection.child('session-2');

    // one session ending (a reconnect) must not end the connection or its siblings
    first.abort();
    expect(first.isActive).toBe(false);
    expect(second.isActive).toBe(true);
    expect(connection.isActive).toBe(true);

    // the connection ending takes every session with it
    connection.abort();
    expect(second.isActive).toBe(false);
  });

  it('runs a handler immediately when registered on an already-aborted scope', () => {
    const scope = new Scope();
    scope.abort();
    const onAbort = vi.fn();
    scope.onAbort(onAbort);
    // registration must not be lost to a race
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('hands out already-aborted children after the parent ended', () => {
    const connection = new Scope();
    connection.abort();
    const late = connection.child();
    expect(late.isActive).toBe(false);
  });

  it('keeps running the remaining handlers when one throws', () => {
    const scope = new Scope();
    const second = vi.fn();
    scope.onAbort(() => {
      throw new Error('cleanup failed');
    });
    scope.onAbort(second);
    expect(() => scope.abort()).not.toThrow();
    expect(second).toHaveBeenCalled();
  });

  it('prunes aborted children so a long connection does not accumulate them', () => {
    const connection = new Scope();
    for (let i = 0; i < 5; i++) connection.child().abort();
    const live = connection.child();
    connection.pruneChildren();
    connection.abort();
    expect(live.isActive).toBe(false); // the live one is still tracked
  });
});

describe('ResponseGate', () => {
  it('sends the first request and queues exactly one more while busy', () => {
    const gate = new ResponseGate();
    expect(gate.isBusy).toBe(false);

    // first turn goes out immediately
    expect(gate.request()).toBe(true);
    expect(gate.currentState).toBe('requested');
    expect(gate.isBusy).toBe(true);

    // a second turn before the service acknowledges must NOT be sent (it would overlap)
    expect(gate.request()).toBe(false);
    expect(gate.hasQueuedRequest).toBe(true);
    // a third collapses into the same queued request
    expect(gate.request()).toBe(false);

    gate.onResponseCreated();
    expect(gate.currentState).toBe('active');
    expect(gate.request()).toBe(false);

    // the queued request goes out once — and the gate is busy again for it
    expect(gate.onResponseDone()).toBe(true);
    expect(gate.currentState).toBe('requested');
    expect(gate.hasQueuedRequest).toBe(false);

    gate.onResponseCreated();
    expect(gate.onResponseDone()).toBe(false);
    expect(gate.currentState).toBe('idle');
    expect(gate.isBusy).toBe(false);
  });

  it('falls back to idle when the service errors on a request it never acknowledged', () => {
    const gate = new ResponseGate();
    gate.request();
    gate.onError(); // e.g. the service rejected our response.create: no response.done will come
    expect(gate.currentState).toBe('idle');
    // later turns still work instead of being deferred forever
    expect(gate.request()).toBe(true);
  });

  it('keeps a running response active when an unrelated error arrives', () => {
    const gate = new ResponseGate();
    gate.request();
    gate.onResponseCreated();
    gate.onError();
    expect(gate.currentState).toBe('active');
    expect(gate.request()).toBe(false); // still must not overlap
  });

  it('sends the queued turn when the request it was waiting behind is rejected', () => {
    const gate = new ResponseGate();
    expect(gate.request()).toBe(true); // sent
    expect(gate.request()).toBe(false); // queued behind it
    // the first request is rejected by the service: no response.done will ever arrive
    expect(gate.onError()).toBe(true); // → send the queued turn now
    expect(gate.hasQueuedRequest).toBe(false);
    expect(gate.currentState).toBe('requested');
    // ...and its completion must not emit a second, phantom response.create
    expect(gate.onResponseDone()).toBe(false);
    expect(gate.currentState).toBe('idle');
  });

  it('frees the gate when an approved request could not be sent', () => {
    const gate = new ResponseGate();
    expect(gate.request()).toBe(true);
    gate.onRequestNotSent(); // e.g. the transport was not open
    expect(gate.currentState).toBe('idle');
    expect(gate.isBusy).toBe(false);
    // later turns are sent instead of being queued behind a response that never starts
    expect(gate.request()).toBe(true);
  });

  it('ignores onRequestNotSent for a response the service already acknowledged', () => {
    const gate = new ResponseGate();
    gate.request();
    gate.onResponseCreated();
    gate.onRequestNotSent();
    expect(gate.currentState).toBe('active');
  });

  it('ignores errors caused by a different client event', () => {
    const gate = new ResponseGate();
    gate.request();
    gate.trackRequest('evt_7');
    // an invalid session.update fails while our response.create is still unacknowledged
    expect(gate.onError('evt_3')).toBe(false);
    expect(gate.currentState).toBe('requested'); // our request may still be accepted
    // the rejection of our own request does release it
    expect(gate.onError('evt_7')).toBe(false);
    expect(gate.currentState).toBe('idle');
  });

  it('treats an error without an event id as possibly ours (a stuck gate is worse)', () => {
    const gate = new ResponseGate();
    gate.request();
    gate.trackRequest('evt_1');
    expect(gate.onError(null)).toBe(false);
    expect(gate.currentState).toBe('idle');
  });

  it('reserves a slot for a service-initiated response and self-heals if none arrives', () => {
    const gate = new ResponseGate();
    gate.reserveAutomatic();
    expect(gate.isBusy).toBe(true);
    expect(gate.isSpeculative).toBe(true);
    // a consumer turn in this window is queued instead of overlapping the automatic response
    expect(gate.request()).toBe(false);
    expect(gate.hasQueuedRequest).toBe(true);

    // the automatic response never arrives → release, and the queued turn goes out
    expect(gate.releaseSpeculative()).toBe(true);
    expect(gate.isSpeculative).toBe(false);
    expect(gate.currentState).toBe('requested');
  });

  it('clears the speculative flag once the service acknowledges its response', () => {
    const gate = new ResponseGate();
    gate.reserveAutomatic();
    gate.onResponseCreated();
    expect(gate.isSpeculative).toBe(false);
    expect(gate.currentState).toBe('active');
    // a late release must not disturb a running response
    expect(gate.releaseSpeculative()).toBe(false);
    expect(gate.currentState).toBe('active');
  });

  it('does not reserve automatically while a response is already busy', () => {
    const gate = new ResponseGate();
    gate.request();
    gate.trackRequest('evt_1');
    gate.reserveAutomatic();
    expect(gate.isSpeculative).toBe(false);
    expect(gate.outstandingEventId).toBe('evt_1');
  });

  it('hands a queued request over to whoever will satisfy it', () => {
    const gate = new ResponseGate();
    gate.request();
    gate.onResponseCreated();
    expect(gate.request()).toBe(false); // a user turn queues behind the running response
    expect(gate.consumeQueuedRequest()).toBe(true);
    expect(gate.hasQueuedRequest).toBe(false);
    // the handover is idempotent, and response.done no longer emits the taken-over request
    expect(gate.consumeQueuedRequest()).toBe(false);
    expect(gate.onResponseDone()).toBe(false);
    expect(gate.currentState).toBe('idle');
  });

  it('reset() forgets state for a new session', () => {
    const gate = new ResponseGate();
    gate.request();
    gate.request(); // queue one
    gate.reset();
    expect(gate.currentState).toBe('idle');
    expect(gate.hasQueuedRequest).toBe(false);
    expect(gate.request()).toBe(true);
  });
});
