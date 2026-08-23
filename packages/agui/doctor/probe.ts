/**
 * `probeEndpoint` — does this AG-UI endpoint work, and is it fit to drive a voice session?
 *
 * There is no official AG-UI conformance checker, so this is ours. It POSTs a minimal
 * `RunAgentInput`, reads the raw SSE (so it can see keepalive comments, a wrong content-type, and
 * malformed lines that a parser would hide), decodes the AG-UI events, and runs them through the
 * same ordering rules `@ag-ui/client`'s `verifyEvents` enforces at runtime (mirrored in
 * `core/verify.ts`). On top of "is it a legal stream" it answers the question the wire cares about:
 * does text arrive in speakable chunks, fast enough, and does the backend accept a second turn that
 * continues the thread?
 *
 * Runtime-only (Node ≥18 or a browser): it uses global `fetch` and streams the response body.
 */

import { EventType } from '@ag-ui/core';
import type { BaseEvent, RunAgentInput } from '@ag-ui/core';
import { verifyStream } from '../core/verify';

export interface ProbeOptions {
  url: string;
  headers?: Record<string, string>;
  /** Overall cap for a single run, ms. Default 30000. */
  timeoutMs?: number;
  /** The opening user message. Default asks for a short spoken-style answer. */
  prompt?: string;
  /** Also run a second turn with `parentRunId` to check thread continuity. Default true. */
  checkContinuity?: boolean;
  /** Inject a fetch (tests, or a non-global environment). Default: global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Deterministic id source (tests). Default: random. */
  generateId?: () => string;
}

export type VoiceVerdict = 'ready' | 'usable' | 'unfit';

export interface RunObservation {
  runId: string;
  /** Ordered event types as they arrived. */
  eventTypes: EventType[];
  /** The verify failure, naming the offending event — or null if the stream was legal. */
  verifyError: string | null;
  firstTokenMs: number | null;
  totalMs: number;
  assistantText: string;
  /** Number of TEXT_MESSAGE_CONTENT deltas (how finely the answer streamed). */
  deltaCount: number;
  /** SSE keepalive comment lines seen (`:` lines). */
  keepalives: number;
  transportError: string | null;
}

export interface DoctorReport {
  url: string;
  ok: boolean;
  features: {
    textStreaming: boolean;
    toolEvents: boolean;
    state: boolean;
    interrupts: boolean;
    keepalives: boolean;
    /** Second run with `parentRunId` verified and streamed. null = not checked. */
    threadContinuity: boolean | null;
  };
  timing: { firstTokenMs: number | null; totalMs: number };
  voiceReadiness: {
    verdict: VoiceVerdict;
    chunkableDeltas: boolean;
    answerCharCount: number;
    reasons: string[];
  };
  runs: RunObservation[];
  errors: string[];
}

const DEFAULT_PROMPT = 'In one short sentence, say hello and tell me you are working.';
const FOLLOW_UP = 'Thanks — and what did I just ask you?';

export async function probeEndpoint(options: ProbeOptions): Promise<DoctorReport> {
  const genId = options.generateId ?? (() => `dr-${Math.random().toString(36).slice(2, 10)}`);
  const threadId = genId();
  const errors: string[] = [];

  const firstRunId = genId();
  const first = await observeRun(options, {
    threadId,
    runId: firstRunId,
    messages: [{ id: genId(), role: 'user', content: options.prompt ?? DEFAULT_PROMPT }],
  });

  let continuity: boolean | null = null;
  const runs: RunObservationInternal[] = [first];
  if (options.checkContinuity !== false && !first.transportError) {
    const second = await observeRun(options, {
      threadId,
      runId: genId(),
      parentRunId: firstRunId,
      messages: [
        { id: genId(), role: 'user', content: options.prompt ?? DEFAULT_PROMPT },
        { id: genId(), role: 'assistant', content: first.assistantText || '(no answer)' },
        { id: genId(), role: 'user', content: FOLLOW_UP },
      ],
    });
    runs.push(second);
    continuity =
      !second.transportError && second.verifyError === null && second.assistantText.length > 0;
  }

  for (const r of runs) {
    if (r.transportError) errors.push(`run ${r.runId}: ${r.transportError}`);
    if (r.verifyError) errors.push(`run ${r.runId}: ${r.verifyError}`);
  }

  const textStreaming = first.assistantText.length > 0 && first.verifyError === null;
  const toolEvents = runs.some((r) =>
    r.eventTypes.some(
      (t) =>
        t === EventType.TOOL_CALL_START ||
        t === EventType.TOOL_CALL_ARGS ||
        t === EventType.TOOL_CALL_END
    )
  );
  const state = runs.some((r) =>
    r.eventTypes.some((t) => t === EventType.STATE_SNAPSHOT || t === EventType.STATE_DELTA)
  );
  const interrupts = runs.some((r) => r.sawInterrupt);
  const keepalives = runs.some((r) => r.keepalives > 0);

  const { verdict, chunkableDeltas, reasons } = assessVoice(first, textStreaming);

  return {
    url: options.url,
    ok: textStreaming && first.verifyError === null && !first.transportError,
    features: {
      textStreaming,
      toolEvents,
      state,
      interrupts,
      keepalives,
      threadContinuity: continuity,
    },
    timing: { firstTokenMs: first.firstTokenMs, totalMs: first.totalMs },
    voiceReadiness: {
      verdict,
      chunkableDeltas,
      answerCharCount: first.assistantText.length,
      reasons,
    },
    runs,
    errors,
  };
}

function assessVoice(
  first: RunObservation,
  textStreaming: boolean
): { verdict: VoiceVerdict; chunkableDeltas: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (first.transportError) {
    return { verdict: 'unfit', chunkableDeltas: false, reasons: [first.transportError] };
  }
  if (first.verifyError) {
    reasons.push(`stream is not a legal AG-UI run: ${first.verifyError}`);
    return { verdict: 'unfit', chunkableDeltas: false, reasons };
  }
  if (!textStreaming) {
    reasons.push('no assistant text was produced');
    return { verdict: 'unfit', chunkableDeltas: false, reasons };
  }

  const chunkableDeltas = first.deltaCount >= 2;
  if (!chunkableDeltas) {
    reasons.push('answer arrived as a single block — speech will start only after the full answer');
  }
  if (first.firstTokenMs !== null && first.firstTokenMs > 3000) {
    reasons.push(
      `slow first token (${first.firstTokenMs} ms) — the caller will hear a long silence`
    );
  }
  if (first.assistantText.length > 1200) {
    reasons.push(
      `long answer (${first.assistantText.length} chars) — consider prompting for brevity`
    );
  }

  const fast = first.firstTokenMs === null || first.firstTokenMs <= 3000;
  const verdict: VoiceVerdict = chunkableDeltas && fast ? 'ready' : 'usable';
  if (verdict === 'ready') reasons.push('streams speakable chunks with a fast first token');
  return { verdict, chunkableDeltas, reasons };
}

interface RunObservationInternal extends RunObservation {
  sawInterrupt: boolean;
}

/** POST one RunAgentInput, read the raw SSE, decode + time + verify it. */
async function observeRun(
  options: ProbeOptions,
  input: Pick<RunAgentInput, 'threadId' | 'runId' | 'messages'> & { parentRunId?: string }
): Promise<RunObservationInternal> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const body: RunAgentInput = {
    threadId: input.threadId,
    runId: input.runId,
    messages: input.messages,
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
  } as RunAgentInput;

  const events: BaseEvent[] = [];
  const eventTypes: EventType[] = [];
  let keepalives = 0;
  let assistantText = '';
  let deltaCount = 0;
  let firstTokenMs: number | null = null;
  let sawInterrupt = false;
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);

  try {
    const res = await fetchImpl(options.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...(options.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      return fail(`HTTP ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      return fail(`expected text/event-stream, got '${contentType || 'no content-type'}'`);
    }
    if (!res.body) return fail('response had no body');

    for await (const evt of readSSE(res.body)) {
      if (evt.kind === 'comment') {
        keepalives += 1;
        continue;
      }
      let parsed: BaseEvent;
      try {
        parsed = JSON.parse(evt.data) as BaseEvent;
      } catch {
        return fail(`SSE data was not JSON: ${evt.data.slice(0, 80)}`);
      }
      events.push(parsed);
      const type = (parsed as { type: EventType }).type;
      eventTypes.push(type);
      if (type === EventType.TEXT_MESSAGE_CONTENT) {
        deltaCount += 1;
        assistantText += String((parsed as { delta?: unknown }).delta ?? '');
        if (firstTokenMs === null) firstTokenMs = Date.now() - started;
      }
      if (type === EventType.RUN_FINISHED && isInterruptOutcome(parsed)) sawInterrupt = true;
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timeout);
  }

  let verifyError: string | null = null;
  try {
    verifyStream(events);
  } catch (err) {
    verifyError = err instanceof Error ? err.message : String(err);
  }

  return {
    runId: input.runId,
    eventTypes,
    verifyError,
    firstTokenMs,
    totalMs: Date.now() - started,
    assistantText,
    deltaCount,
    keepalives,
    transportError: null,
    sawInterrupt,
  };

  function fail(message: string): RunObservationInternal {
    clearTimeout(timeout);
    return {
      runId: input.runId,
      eventTypes,
      verifyError: null,
      firstTokenMs,
      totalMs: Date.now() - started,
      assistantText,
      deltaCount,
      keepalives,
      transportError: message,
      sawInterrupt,
    };
  }
}

function isInterruptOutcome(ev: BaseEvent): boolean {
  const outcome = (ev as { outcome?: { type?: string } }).outcome;
  return outcome?.type === 'interrupt';
}

type SSEChunk = { kind: 'event'; data: string } | { kind: 'comment' };

/** Minimal SSE reader: yields data events (concatenated multi-line `data:`) and comment keepalives. */
async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE records are separated by a blank line.
      while ((sep = indexOfRecordEnd(buffer)) !== -1) {
        const record = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){1,2}/, '');
        const chunk = parseRecord(record);
        if (chunk) yield chunk;
      }
    }
    const tail = parseRecord(buffer.trim());
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function indexOfRecordEnd(buf: string): number {
  const lf = buf.indexOf('\n\n');
  const crlf = buf.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function parseRecord(record: string): SSEChunk | null {
  if (!record) return null;
  const dataLines: string[] = [];
  let isComment = false;
  for (const raw of record.split(/\r?\n/)) {
    if (raw.startsWith(':')) {
      isComment = true;
      continue;
    }
    if (raw.startsWith('data:')) dataLines.push(raw.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length > 0) return { kind: 'event', data: dataLines.join('\n') };
  if (isComment) return { kind: 'comment' };
  return null;
}
