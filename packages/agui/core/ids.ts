/**
 * Stable AG-UI identifiers derived from Voice Live wire ids.
 *
 * AG-UI needs a `messageId` that stays the same from `TEXT_MESSAGE_START` to `TEXT_MESSAGE_END`,
 * and a `toolCallId` the UI can correlate a result to. Voice Live already has both:
 *
 * - `item_id` identifies one conversation item (a user turn, an assistant message, a function
 *   call) and is the same value that appears in `response.done.output[].id`, so it is the right
 *   `messageId`.
 * - `call_id` is what `function_call_output` must reference, so it is the right `toolCallId` —
 *   the UI hands it straight back to `sendToolResult()`.
 *
 * Everything else here is a fallback for events that arrive without an id (observed on some
 * transports for `speech_started`, and for `response.*` events before `output_item.added`).
 */

export interface IdSource {
  item_id?: string;
  response_id?: string;
  output_index?: number;
  call_id?: string;
}

/** `messageId` for a response-scoped event */
export function messageIdFor(event: IdSource, fallback: () => string): string {
  if (event.item_id) return event.item_id;
  if (event.response_id !== undefined && event.output_index !== undefined) {
    return `${event.response_id}:${event.output_index}`;
  }
  return fallback();
}

/** `toolCallId` for a function-call event */
export function toolCallIdFor(event: IdSource, fallback: () => string): string {
  return event.call_id ?? event.item_id ?? fallback();
}

/** `messageId` of the synthetic tool-result message that carries a `TOOL_CALL_RESULT` */
export function toolResultMessageId(callId: string): string {
  return `result_${callId}`;
}

/** Deterministic id generator for tests: `prefix_1`, `prefix_2`, … */
export function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}_${++n}`;
}
