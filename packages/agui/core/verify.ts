/**
 * A verifier that mirrors AG-UI's own `verifyEvents` ordering rules, used by every mapper test.
 *
 * `@ag-ui/client`'s `verifyEvents` operates on an rxjs stream; reimplementing the rules as a plain
 * function over an array is what lets the pure `core/` tests assert "this sequence is a legal AG-UI
 * stream" without pulling in rxjs. If a mapper change produces `TEXT_MESSAGE_CONTENT` without a
 * `START`, or an event after `RUN_FINISHED`, this throws with the offending event named — which is
 * exactly what the real client would do at runtime.
 */

import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';

interface E {
  type: EventType;
  messageId?: string;
  toolCallId?: string;
  [k: string]: unknown;
}

/** Verify one run's worth of events (RUN_STARTED … terminal). Throws on the first violation. */
export function verifyRun(events: BaseEvent[]): void {
  const e = events as E[];
  const openMessages = new Set<string>();
  const openTools = new Set<string>();
  let started = false;
  let finished = false;

  for (const ev of e) {
    if (finished && ev.type !== EventType.RUN_STARTED) {
      throw new Error(`event '${ev.type}' after the run finished`);
    }
    if (!started && ev.type !== EventType.RUN_STARTED && ev.type !== EventType.RUN_ERROR) {
      throw new Error(`first event must be RUN_STARTED, got '${ev.type}'`);
    }
    switch (ev.type) {
      case EventType.RUN_STARTED:
        if (started && !finished) throw new Error('RUN_STARTED while a run is still active');
        started = true;
        finished = false;
        openMessages.clear();
        openTools.clear();
        break;
      case EventType.RUN_FINISHED:
      case EventType.RUN_ERROR:
        if (openMessages.size)
          throw new Error(`run ended with message '${[...openMessages][0]}' still open`);
        if (openTools.size)
          throw new Error(`run ended with tool call '${[...openTools][0]}' still open`);
        finished = true;
        break;
      case EventType.TEXT_MESSAGE_START:
        if (openMessages.has(ev.messageId!))
          throw new Error(`TEXT_MESSAGE_START for already-open '${ev.messageId}'`);
        openMessages.add(ev.messageId!);
        break;
      case EventType.TEXT_MESSAGE_CONTENT:
        if (!openMessages.has(ev.messageId!))
          throw new Error(`TEXT_MESSAGE_CONTENT for unopened '${ev.messageId}'`);
        break;
      case EventType.TEXT_MESSAGE_END:
        if (!openMessages.has(ev.messageId!))
          throw new Error(`TEXT_MESSAGE_END for unopened '${ev.messageId}'`);
        openMessages.delete(ev.messageId!);
        break;
      case EventType.TOOL_CALL_START:
        if (openTools.has(ev.toolCallId!))
          throw new Error(`TOOL_CALL_START for already-open '${ev.toolCallId}'`);
        openTools.add(ev.toolCallId!);
        break;
      case EventType.TOOL_CALL_ARGS:
        if (!openTools.has(ev.toolCallId!))
          throw new Error(`TOOL_CALL_ARGS for unopened '${ev.toolCallId}'`);
        break;
      case EventType.TOOL_CALL_END:
        if (!openTools.has(ev.toolCallId!))
          throw new Error(`TOOL_CALL_END for unopened '${ev.toolCallId}'`);
        openTools.delete(ev.toolCallId!);
        break;
      default:
        break;
    }
  }
}

/**
 * Verify a *continuous* stream that may contain many runs back to back (what a whole voice session
 * produces). Splits on RUN_STARTED and verifies each run, and checks that nothing but a fresh
 * RUN_STARTED appears between a terminal event and the next run.
 */
export function verifyStream(events: BaseEvent[]): void {
  const e = events as E[];
  let current: BaseEvent[] = [];
  let inRun = false;
  for (const ev of e) {
    if (ev.type === EventType.RUN_STARTED) {
      if (current.length) verifyRun(current);
      current = [ev];
      inRun = true;
      continue;
    }
    if (!inRun) {
      // Between runs only STATE_*/CUSTOM/RAW/MESSAGES_SNAPSHOT are allowed (host-level breadcrumbs)
      if (
        ev.type !== EventType.STATE_DELTA &&
        ev.type !== EventType.STATE_SNAPSHOT &&
        ev.type !== EventType.CUSTOM &&
        ev.type !== EventType.RAW &&
        ev.type !== EventType.MESSAGES_SNAPSHOT
      ) {
        throw new Error(`event '${ev.type}' outside any run`);
      }
      continue;
    }
    current.push(ev);
    if (ev.type === EventType.RUN_FINISHED || ev.type === EventType.RUN_ERROR) {
      verifyRun(current);
      current = [];
      inRun = false;
    }
  }
  if (current.length) verifyRun(current);
}
