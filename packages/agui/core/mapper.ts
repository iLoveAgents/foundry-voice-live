/**
 * VoiceLiveAguiMapper — turns a Voice Live server-event stream into AG-UI events.
 *
 * Pure and synchronous: `handleServerEvent(event)` returns the AG-UI events to emit plus optional
 * run open/close signals. No I/O, no timers, no rxjs, no DOM — the host (the React glue) owns all
 * of that. Ordering is the whole point, so events are returned in arrays and every test pipes the
 * result through a verifier that mirrors AG-UI's own `verifyEvents`.
 */

import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import { VOICE_CUSTOM_EVENTS } from './customEvents';
import { toolCallIdFor, toolResultMessageId } from './ids';
import { RunPolicy, type RunPolicyDecision } from './runPolicy';
import { initialVoiceState, patchVoiceState, toAguiState } from './voiceState';
import type {
  HostEvent,
  MapperOutput,
  MapperSnapshot,
  RunClosedReason,
  VoiceLiveServerEvent,
  VoiceState,
} from './types';

interface OpenMessage {
  messageId: string;
  role: 'user' | 'assistant';
  /** Text emitted so far, to reconcile against the final `.done`/`.completed` text */
  accumulated: string;
}

interface OpenToolCall {
  toolCallId: string;
  /** Argument deltas buffered because the tool name was not yet known */
  bufferedArgs: string;
  started: boolean;
}

const DEFAULT_IDLE_MS = 15_000;

/** High-rate / media events that must never reach the observable, even with `passthroughRaw` */
const DROP_ALWAYS = new Set<string>([
  'response.audio.delta',
  'response.audio.done',
  'response.animation_viseme.delta',
  'response.animation_viseme.done',
  'response.animation_blendshapes.delta',
  'response.animation_blendshapes.done',
  'response.audio_timestamp.delta',
  'response.audio_timestamp.done',
  'response.video.delta',
  'rtc.call.sdp.created',
]);

/**
 * Turn a non-string tool output into a string for `TOOL_CALL_RESULT.content`, without ever
 * producing `undefined` or throwing: `JSON.stringify` returns `undefined` for `undefined`/functions
 * and throws on `BigInt`/circular structures, either of which would emit an invalid AG-UI event or
 * crash the mapper. Fall back to `String(...)` so the content is always a valid string.
 */
function stringifyToolOutput(output: unknown): string {
  try {
    const json = JSON.stringify(output);
    return json === undefined ? String(output) : json;
  } catch {
    return String(output);
  }
}

export class VoiceLiveAguiMapper {
  private readonly threadId: string;
  private readonly generateId: () => string;
  private readonly now: () => number;
  private readonly passthroughRaw: boolean;
  private readonly idleMs: number;

  private readonly policy = new RunPolicy();
  private runId: string | null = null;
  private openMessage: OpenMessage | null = null;
  private readonly openToolCalls = new Map<string, OpenToolCall>();
  /** `item_id` → tool name, recorded from `response.output_item.added` before the args stream */
  private readonly toolNames = new Map<string, string>();
  private readonly seenEventIds = new Set<string>();
  private state: VoiceState;
  private lastActivityAt: number;
  private closed = false;

  constructor(options: {
    threadId: string;
    generateId?: () => string;
    now?: () => number;
    passthroughRaw?: boolean;
    runIdleTimeoutMs?: number;
    transport?: 'websocket' | 'webrtc';
  }) {
    this.threadId = options.threadId;
    this.generateId = options.generateId ?? (() => `agui_${Math.random().toString(36).slice(2)}`);
    this.now = options.now ?? (() => Date.now());
    this.passthroughRaw = options.passthroughRaw ?? false;
    this.idleMs = options.runIdleTimeoutMs ?? DEFAULT_IDLE_MS;
    this.state = initialVoiceState(options.transport ?? 'websocket');
    this.lastActivityAt = this.now();
  }

  // ---- public API -----------------------------------------------------------

  handleServerEvent(event: VoiceLiveServerEvent): MapperOutput {
    // The WebRTC service mirrors events on the control and data channels; drop the second copy so
    // fixture replay is idempotent even though useVoiceLive already de-dups upstream.
    const eventId = (event as { event_id?: string }).event_id;
    if (eventId) {
      if (this.seenEventIds.has(eventId)) return { events: [] };
      this.rememberEventId(eventId);
    }
    this.lastActivityAt = this.now();
    return this.route(event);
  }

  handleHostEvent(event: HostEvent): MapperOutput {
    switch (event.type) {
      case 'connection_state':
        return this.emit(
          this.stateDelta({ connectionState: event.state }),
          this.custom(VOICE_CUSTOM_EVENTS.connection, { state: event.state })
        );
      case 'ready': {
        // Readiness is two-way: an auto-reconnect can drop it back to false without a full
        // disconnect, and consumers must not enable input against a not-yet-ready session.
        const ready = event.ready ?? true;
        return ready
          ? this.emit(
              this.stateDelta({ isReady: true }),
              this.custom(VOICE_CUSTOM_EVENTS.ready, {})
            )
          : this.emit(this.stateDelta({ isReady: false }));
      }
      case 'transport':
        return this.emit(this.stateDelta({ transport: event.transport }));
      case 'mic':
        return this.emit(this.stateDelta({ isMicActive: event.active, isMuted: event.muted }));
      case 'tool_result': {
        this.policy.onToolResult(event.callId);
        return this.emit(this.toolResult(event.callId, event.output));
      }
      case 'tool_error': {
        this.policy.onToolResult(event.callId);
        return this.emit(this.toolResult(event.callId, { error: event.error }));
      }
      case 'reconnecting':
        return this.emit(
          this.stateDelta({ connectionState: 'reconnecting' }),
          this.custom(VOICE_CUSTOM_EVENTS.reconnecting, {
            attempt: event.attempt,
            delayMs: event.delayMs,
          })
        );
      case 'reconnected':
        return this.emit(this.custom(VOICE_CUSTOM_EVENTS.reconnected, {}));
      case 'disconnected':
        return this.closeInternal('session_end');
    }
  }

  /** Idle watchdog: the host calls this from a timer; a run with no activity is force-closed */
  tick(nowMs: number): MapperOutput {
    if (!this.policy.isRunActive) return { events: [] };
    if (nowMs - this.lastActivityAt < this.idleMs) return { events: [] };
    return this.applyDecisions(this.policy.onForceClose('idle'));
  }

  /** A UI-originated user turn: AG-UI events to publish + the client events to put on the wire */
  submitUserMessage(
    text: string,
    opts: { messageId?: string } = {}
  ): { events: BaseEvent[]; commands: import('./types').VoiceLiveClientEvent[] } {
    const messageId = opts.messageId ?? this.generateId();
    const events: BaseEvent[] = [];
    // Open a run for this turn if one is not already in flight
    events.push(...this.applyDecisions([this.policy.onTurnSignal()]).events);
    events.push(
      this.base(EventType.TEXT_MESSAGE_START, { messageId, role: 'user' }),
      this.base(EventType.TEXT_MESSAGE_CONTENT, { messageId, delta: text }),
      this.base(EventType.TEXT_MESSAGE_END, { messageId })
    );
    const commands: import('./types').VoiceLiveClientEvent[] = [
      {
        type: 'conversation.item.create',
        item: {
          id: messageId,
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      },
      { type: 'response.create' },
    ];
    return { events, commands };
  }

  /** Disconnect / unmount: end any open message and tool calls, then close the run. Idempotent. */
  close(reason: RunClosedReason = 'session_end'): MapperOutput {
    return this.closeInternal(reason);
  }

  get snapshot(): MapperSnapshot {
    return {
      runId: this.runId,
      openMessageId: this.openMessage?.messageId ?? null,
      openToolCallIds: [...this.openToolCalls.keys()],
      clusterOwesCalls: this.policy.clusterOwesCalls,
      state: this.state,
    };
  }

  // ---- routing --------------------------------------------------------------

  private route(event: VoiceLiveServerEvent): MapperOutput {
    switch (event.type) {
      case 'session.created':
        return this.onSessionCreated(event);
      case 'session.updated':
        return this.onSessionUpdated(event);
      case 'session.avatar.connecting':
        return this.emit(this.custom(VOICE_CUSTOM_EVENTS.avatar, { phase: 'connecting' }));
      case 'input_audio_buffer.speech_started':
        return this.onSpeechStarted(event);
      case 'input_audio_buffer.speech_stopped':
        return this.emit(
          this.stateDelta({ sessionState: 'thinking' }),
          this.custom(VOICE_CUSTOM_EVENTS.speechStopped, {
            audioEndMs: event.audio_end_ms ?? null,
            itemId: event.item_id ?? null,
          })
        );
      case 'conversation.item.input_audio_transcription.delta':
        return this.onUserTranscriptDelta(event);
      case 'conversation.item.input_audio_transcription.completed':
        return this.onUserTranscriptCompleted(event);
      case 'conversation.item.input_audio_transcription.failed':
        return this.onUserTranscriptFailed(event);
      case 'conversation.item.created':
        return this.onConversationItemCreated(event);
      case 'conversation.item.truncated':
        return this.emit(
          this.custom(VOICE_CUSTOM_EVENTS.truncated, {
            itemId: event.item_id,
            contentIndex: event.content_index,
            audioEndMs: event.audio_end_ms,
          })
        );
      case 'response.created':
        return this.onResponseCreated(event);
      case 'response.output_item.added':
        return this.onOutputItemAdded(event);
      case 'response.text.delta':
      case 'response.audio_transcript.delta':
        return this.onAssistantDelta(event);
      case 'response.text.done':
        return this.onAssistantDone(event, event.text);
      case 'response.audio_transcript.done':
        return this.onAssistantDone(event, event.transcript);
      case 'response.function_call_arguments.delta':
        return this.onFunctionArgsDelta(event);
      case 'response.function_call_arguments.done':
        return this.onFunctionArgsDone(event);
      case 'response.done':
        return this.onResponseDone(event);
      case 'error':
        return this.emit(
          this.stateDelta({
            lastError: { message: event.error?.message ?? 'error', code: event.error?.code },
          }),
          this.custom(VOICE_CUSTOM_EVENTS.error, {
            message: event.error?.message ?? 'error',
            code: event.error?.code,
            eventId: (event.error as { event_id?: string } | undefined)?.event_id ?? null,
          })
        );
      case 'warning':
        return this.emit(
          this.custom(VOICE_CUSTOM_EVENTS.warning, {
            message: event.warning?.message ?? 'warning',
            code: event.warning?.code,
            param: event.warning?.param ?? null,
          })
        );
      case 'rtc.call.error':
        return this.emit(
          this.custom(VOICE_CUSTOM_EVENTS.error, {
            message: (event as { error?: { message?: string } }).error?.message ?? 'rtc.call.error',
          })
        );
      default:
        return this.onOtherEvent(event);
    }
  }

  // ---- session --------------------------------------------------------------

  private onSessionCreated(
    event: Extract<VoiceLiveServerEvent, { type: 'session.created' }>
  ): MapperOutput {
    const events: BaseEvent[] = [];
    // A fresh session (typically after an auto-reconnect) starts a new server-side conversation with
    // no history. If a run was still open on the old session, force-close it first — otherwise the
    // first turn of the new session would be appended to the stale run (which may still owe tool
    // calls) instead of opening a fresh RUN_STARTED.
    // onForceClose → closeOpenSpans ends any open message/tool spans before the terminal event.
    if (this.policy.isRunActive) {
      events.push(...this.applyDecisions(this.policy.onForceClose('interrupted')).events);
    }
    // A fresh session revives a mapper that a prior (possibly spurious mount-time) disconnect closed,
    // so a later abortRun()/disconnect can still close the run.
    this.closed = false;
    // A fresh session invalidates every per-conversation id
    this.openMessage = null;
    this.openToolCalls.clear();
    this.toolNames.clear();
    const expires = event.session?.expires_at;
    this.state = {
      ...this.state,
      currentResponseId: null,
      sessionState: 'listening',
      sessionExpiresAt: typeof expires === 'number' ? expires * 1000 : this.state.sessionExpiresAt,
      model: typeof event.session?.model === 'string' ? event.session.model : this.state.model,
    };
    events.push(
      this.base(EventType.STATE_SNAPSHOT, { snapshot: toAguiState(this.state) }),
      this.custom(VOICE_CUSTOM_EVENTS.sessionCreated, {
        sessionId: typeof event.session?.id === 'string' ? event.session.id : null,
        model: this.state.model,
      })
    );
    return { events };
  }

  private onSessionUpdated(
    event: Extract<VoiceLiveServerEvent, { type: 'session.updated' }>
  ): MapperOutput {
    const expires = event.session?.expires_at;
    return this.emit(
      this.stateDelta({
        sessionExpiresAt:
          typeof expires === 'number' ? expires * 1000 : this.state.sessionExpiresAt,
        model: typeof event.session?.model === 'string' ? event.session.model : this.state.model,
      })
    );
  }

  // ---- user turn ------------------------------------------------------------

  private onSpeechStarted(
    event: Extract<VoiceLiveServerEvent, { type: 'input_audio_buffer.speech_started' }>
  ): MapperOutput {
    const events: BaseEvent[] = [];
    // Barge-in: a response is in flight (created, maybe streaming) → end any open assistant message
    // and close the run before the new user turn. Detected via currentResponseId, not openMessage,
    // so an interrupt between response.created and the first transcript delta still opens a fresh run
    // instead of appending the new user turn to the interrupted response's run.
    if (this.state.currentResponseId !== null) {
      const messageId = this.openMessage?.role === 'assistant' ? this.openMessage.messageId : null;
      if (messageId) {
        events.push(this.base(EventType.TEXT_MESSAGE_END, { messageId }));
        this.openMessage = null;
      }
      events.push(
        this.custom(VOICE_CUSTOM_EVENTS.interrupted, {
          messageId,
          responseId: this.state.currentResponseId,
        })
      );
      events.push(...this.applyDecisions(this.policy.onForceClose('interrupted')).events);
      events.push(...this.stateDelta({ currentResponseId: null }));
    }
    events.push(...this.stateDelta({ sessionState: 'listening' }));
    events.push(...this.applyDecisions([this.policy.onTurnSignal()]).events);
    events.push(
      this.custom(VOICE_CUSTOM_EVENTS.speechStarted, {
        audioStartMs: event.audio_start_ms ?? null,
        itemId: event.item_id ?? null,
      })
    );
    return { events };
  }

  private onUserTranscriptDelta(
    event: Extract<
      VoiceLiveServerEvent,
      { type: 'conversation.item.input_audio_transcription.delta' }
    >
  ): MapperOutput {
    const events = this.applyDecisions([this.policy.onTurnSignal()]).events;
    events.push(...this.openMessageAndDelta(event.item_id, 'user', event.delta ?? ''));
    return { events };
  }

  private onUserTranscriptCompleted(
    event: Extract<
      VoiceLiveServerEvent,
      { type: 'conversation.item.input_audio_transcription.completed' }
    >
  ): MapperOutput {
    const events = this.applyDecisions([this.policy.onTurnSignal()]).events;
    events.push(...this.finishMessage(event.item_id, 'user', event.transcript ?? ''));
    return { events };
  }

  private onUserTranscriptFailed(
    event: Extract<
      VoiceLiveServerEvent,
      { type: 'conversation.item.input_audio_transcription.failed' }
    >
  ): MapperOutput {
    const events: BaseEvent[] = [];
    if (this.openMessage?.messageId === event.item_id) {
      events.push(this.base(EventType.TEXT_MESSAGE_END, { messageId: event.item_id }));
      this.openMessage = null;
    }
    events.push(
      this.custom(VOICE_CUSTOM_EVENTS.transcriptionFailed, {
        itemId: event.item_id,
        message: event.error?.message ?? 'transcription failed',
        code: event.error?.code,
      })
    );
    return { events };
  }

  private onConversationItemCreated(
    event: Extract<VoiceLiveServerEvent, { type: 'conversation.item.created' }>
  ): MapperOutput {
    if (event.item?.type === 'mcp_approval_request') {
      return this.emit(
        this.custom(VOICE_CUSTOM_EVENTS.mcpApprovalRequest, {
          approvalRequestId: event.item.id ?? '',
          serverLabel: (event.item.server_label as string) ?? '',
          name: (event.item.name as string) ?? '',
          arguments: (event.item.arguments as string) ?? '',
        })
      );
    }
    return { events: [] };
  }

  // ---- assistant turn -------------------------------------------------------

  private onResponseCreated(
    event: Extract<VoiceLiveServerEvent, { type: 'response.created' }>
  ): MapperOutput {
    const responseId = event.response?.id ?? this.generateId();
    const events = this.applyDecisions(this.policy.onResponseCreated(responseId)).events;
    events.push(...this.stateDelta({ sessionState: 'speaking', currentResponseId: responseId }));
    return { events };
  }

  private onOutputItemAdded(
    event: Extract<VoiceLiveServerEvent, { type: 'response.output_item.added' }>
  ): MapperOutput {
    // The only place a function name is available before the args stream (which omits it)
    if (event.item?.type === 'function_call' && event.item.id && event.item.name) {
      this.toolNames.set(event.item.id, event.item.name);
    }
    return { events: [] };
  }

  private onAssistantDelta(
    event: Extract<
      VoiceLiveServerEvent,
      { type: 'response.text.delta' | 'response.audio_transcript.delta' }
    >
  ): MapperOutput {
    return { events: this.openMessageAndDelta(event.item_id, 'assistant', event.delta ?? '') };
  }

  private onAssistantDone(event: { item_id: string }, finalText: string | undefined): MapperOutput {
    return { events: this.finishMessage(event.item_id, 'assistant', finalText ?? '') };
  }

  private onFunctionArgsDelta(
    event: Extract<VoiceLiveServerEvent, { type: 'response.function_call_arguments.delta' }>
  ): MapperOutput {
    const toolCallId = toolCallIdFor(event, this.generateId);
    this.policy.onToolCallDeclared(event.response_id, toolCallId);
    let call = this.openToolCalls.get(toolCallId);
    if (!call) {
      call = { toolCallId, bufferedArgs: '', started: false };
      this.openToolCalls.set(toolCallId, call);
    }
    const name = this.toolNames.get(event.item_id);
    // Over WebRTC a function-call event can arrive before response.created (separate channels).
    // Ensure a run is open so the tool spans land inside a run and reach the agent, not just events$.
    const events: BaseEvent[] = this.applyDecisions([this.policy.onTurnSignal()]).events;
    if (!call.started && name) {
      call.started = true;
      events.push(
        this.base(EventType.TOOL_CALL_START, {
          toolCallId,
          toolCallName: name,
          parentMessageId: event.item_id,
        })
      );
    }
    if (call.started) {
      events.push(this.base(EventType.TOOL_CALL_ARGS, { toolCallId, delta: event.delta ?? '' }));
    } else {
      // Name not known yet — buffer and flush at `.done`
      call.bufferedArgs += event.delta ?? '';
    }
    return { events };
  }

  private onFunctionArgsDone(
    event: Extract<VoiceLiveServerEvent, { type: 'response.function_call_arguments.done' }>
  ): MapperOutput {
    const toolCallId = toolCallIdFor(event, this.generateId);
    this.policy.onToolCallDeclared(event.response_id, toolCallId);
    const call = this.openToolCalls.get(toolCallId) ?? {
      toolCallId,
      bufferedArgs: '',
      started: false,
    };
    const name = event.name ?? this.toolNames.get(event.item_id) ?? 'unknown';
    // WebRTC can deliver this before response.created — open a run so the tool spans stay in a run.
    const events: BaseEvent[] = this.applyDecisions([this.policy.onTurnSignal()]).events;
    if (!call.started) {
      events.push(
        this.base(EventType.TOOL_CALL_START, {
          toolCallId,
          toolCallName: name,
          parentMessageId: event.item_id,
        })
      );
      const args = call.bufferedArgs || event.arguments || '';
      if (args) events.push(this.base(EventType.TOOL_CALL_ARGS, { toolCallId, delta: args }));
    }
    events.push(this.base(EventType.TOOL_CALL_END, { toolCallId }));
    this.openToolCalls.delete(toolCallId);
    return { events };
  }

  private onResponseDone(
    event: Extract<VoiceLiveServerEvent, { type: 'response.done' }>
  ): MapperOutput {
    const responseId = event.response?.id ?? this.state.currentResponseId ?? this.generateId();
    const status = event.response?.status;
    const events: BaseEvent[] = [];

    // Any assistant message still open ends here (its `.done` may have been dropped)
    if (this.openMessage?.role === 'assistant') {
      events.push(this.base(EventType.TEXT_MESSAGE_END, { messageId: this.openMessage.messageId }));
      this.openMessage = null;
    }

    // Accumulate usage
    const usage = event.response?.usage;
    if (usage) {
      events.push(
        ...this.stateDelta({
          usage: {
            inputTokens: this.state.usage.inputTokens + (usage.input_tokens ?? 0),
            outputTokens: this.state.usage.outputTokens + (usage.output_tokens ?? 0),
            totalTokens: this.state.usage.totalTokens + (usage.total_tokens ?? 0),
          },
        })
      );
    }

    if (status === 'cancelled') {
      events.push(this.custom(VOICE_CUSTOM_EVENTS.responseCancelled, { responseId }));
      events.push(...this.applyDecisions(this.policy.onForceClose('cancelled')).events);
      events.push(...this.stateDelta({ sessionState: 'listening', currentResponseId: null }));
      return { events };
    }
    if (status === 'failed') {
      const detail = event.response?.status_details?.error;
      events.push(
        ...this.applyDecisions(this.policy.onForceClose('error'), {
          message: detail?.message,
          code: detail?.code,
        }).events
      );
      events.push(...this.stateDelta({ sessionState: 'listening', currentResponseId: null }));
      return { events };
    }

    const declaredToolCalls = (event.response?.output ?? []).filter(
      (item) => (item as { type?: string }).type === 'function_call'
    ).length;
    const decisions = this.policy.onResponseDone({ responseId, declaredToolCalls, done: true });
    // If this completes the cluster, the turn is over — set 'listening' before RUN_FINISHED
    const willClose = decisions.some((d) => d.kind === 'close-run');
    if (willClose)
      events.push(...this.stateDelta({ sessionState: 'listening', currentResponseId: null }));
    events.push(...this.applyDecisions(decisions).events);
    return { events };
  }

  private onOtherEvent(event: VoiceLiveServerEvent): MapperOutput {
    const type = event.type;
    if (DROP_ALWAYS.has(type)) return { events: [] };
    // Service-side tool lifecycle (MCP / Foundry agent / built-in search) → a CUSTOM breadcrumb
    const serviceKind = this.serviceToolKind(type);
    if (serviceKind) {
      return this.emit(
        this.custom(VOICE_CUSTOM_EVENTS.serviceToolCall, {
          kind: serviceKind,
          phase: type,
          itemId: (event as { item_id?: string }).item_id ?? null,
          raw: event as Record<string, unknown>,
        })
      );
    }
    if (this.passthroughRaw) {
      return this.emit(this.base(EventType.RAW, { event, source: 'voice-live' }));
    }
    return { events: [] };
  }

  // ---- message helpers ------------------------------------------------------

  private openMessageAndDelta(
    itemId: string,
    role: 'user' | 'assistant',
    delta: string
  ): BaseEvent[] {
    const messageId = itemId || this.generateId();
    const events: BaseEvent[] = [];
    if (!this.openMessage || this.openMessage.messageId !== messageId) {
      // A different item started — close any stray open message first (keeps START/END balanced)
      if (this.openMessage) {
        events.push(
          this.base(EventType.TEXT_MESSAGE_END, { messageId: this.openMessage.messageId })
        );
      }
      this.openMessage = { messageId, role, accumulated: '' };
      events.push(this.base(EventType.TEXT_MESSAGE_START, { messageId, role }));
    }
    this.openMessage.accumulated += delta;
    events.push(this.base(EventType.TEXT_MESSAGE_CONTENT, { messageId, delta }));
    return events;
  }

  private finishMessage(
    itemId: string,
    role: 'user' | 'assistant',
    finalText: string
  ): BaseEvent[] {
    const messageId = itemId || this.openMessage?.messageId || this.generateId();
    const events: BaseEvent[] = [];
    const open = this.openMessage?.messageId === messageId ? this.openMessage : null;

    if (!open) {
      // No deltas were seen (or a different message is open): emit the whole message atomically
      if (this.openMessage) {
        events.push(
          this.base(EventType.TEXT_MESSAGE_END, { messageId: this.openMessage.messageId })
        );
        this.openMessage = null;
      }
      events.push(this.base(EventType.TEXT_MESSAGE_START, { messageId, role }));
      if (finalText)
        events.push(this.base(EventType.TEXT_MESSAGE_CONTENT, { messageId, delta: finalText }));
      events.push(this.base(EventType.TEXT_MESSAGE_END, { messageId }));
      return events;
    }

    // Reconcile the accumulated deltas against the authoritative final text
    if (finalText.startsWith(open.accumulated)) {
      const remainder = finalText.slice(open.accumulated.length);
      if (remainder)
        events.push(this.base(EventType.TEXT_MESSAGE_CONTENT, { messageId, delta: remainder }));
      events.push(this.base(EventType.TEXT_MESSAGE_END, { messageId }));
    } else if (finalText === open.accumulated) {
      events.push(this.base(EventType.TEXT_MESSAGE_END, { messageId }));
    } else {
      // The transcriber revised earlier words — end the streamed message, then snapshot the truth
      events.push(this.base(EventType.TEXT_MESSAGE_END, { messageId }));
      events.push(
        this.custom(VOICE_CUSTOM_EVENTS.transcriptCorrected, { messageId, role, text: finalText })
      );
    }
    this.openMessage = null;
    return events;
  }

  private toolResult(callId: string, output: unknown): BaseEvent[] {
    const content = typeof output === 'string' ? output : stringifyToolOutput(output);
    return [
      this.base(EventType.TOOL_CALL_RESULT, {
        messageId: toolResultMessageId(callId),
        toolCallId: callId,
        content,
        role: 'tool',
      }),
    ];
  }

  // ---- run lifecycle --------------------------------------------------------

  private applyDecisions(
    decisions: RunPolicyDecision | RunPolicyDecision[],
    errorDetail?: { message?: string; code?: string }
  ): MapperOutput {
    const list = Array.isArray(decisions) ? decisions : [decisions];
    const events: BaseEvent[] = [];
    let runOpened: MapperOutput['runOpened'];
    let runClosed: MapperOutput['runClosed'];
    for (const d of list) {
      switch (d.kind) {
        case 'none':
          break;
        case 'open-run': {
          this.runId = this.generateId();
          events.push(
            this.base(EventType.RUN_STARTED, { threadId: this.threadId, runId: this.runId })
          );
          runOpened = { runId: this.runId };
          break;
        }
        case 'open-step':
          events.push(this.base(EventType.STEP_STARTED, { stepName: `response:${d.responseId}` }));
          break;
        case 'close-step':
        case 'close-step-keep-run':
          events.push(this.base(EventType.STEP_FINISHED, { stepName: `response:${d.responseId}` }));
          break;
        case 'close-run': {
          const runId = this.runId ?? this.generateId();
          // Close any dangling message/tool calls before the terminal event
          events.push(...this.closeOpenSpans());
          if (d.reason === 'error') {
            events.push(
              this.base(EventType.RUN_ERROR, {
                // Carry runId/threadId like RUN_STARTED/RUN_FINISHED so a consumer can correlate the
                // error to the run it saw start (and match VoiceLiveAgent.errorRun()).
                threadId: this.threadId,
                runId,
                message: errorDetail?.message ?? 'Voice Live response failed',
                code: errorDetail?.code,
              })
            );
          } else {
            events.push(this.base(EventType.RUN_FINISHED, { threadId: this.threadId, runId }));
          }
          runClosed = { runId, reason: d.reason };
          this.runId = null;
          break;
        }
      }
    }
    return { events, runOpened, runClosed };
  }

  private closeOpenSpans(): BaseEvent[] {
    const events: BaseEvent[] = [];
    for (const call of this.openToolCalls.values()) {
      if (call.started)
        events.push(this.base(EventType.TOOL_CALL_END, { toolCallId: call.toolCallId }));
    }
    this.openToolCalls.clear();
    if (this.openMessage) {
      events.push(this.base(EventType.TEXT_MESSAGE_END, { messageId: this.openMessage.messageId }));
      this.openMessage = null;
    }
    return events;
  }

  private closeInternal(reason: RunClosedReason): MapperOutput {
    if (this.closed) return { events: [] };
    this.closed = reason === 'session_end';
    if (!this.policy.isRunActive) {
      // Nothing open; still surface the state change on a real disconnect
      return reason === 'session_end'
        ? this.emit(this.stateDelta({ connectionState: 'disconnected', isReady: false }))
        : { events: [] };
    }
    const forceReason =
      reason === 'session_end'
        ? 'idle'
        : (reason as 'cancelled' | 'error' | 'idle' | 'interrupted');
    const out = this.applyDecisions(this.policy.onForceClose(forceReason));
    return out;
  }

  // ---- small helpers --------------------------------------------------------

  private stateDelta(changes: Partial<VoiceState>): BaseEvent[] {
    const { next, ops } = patchVoiceState(this.state, changes);
    this.state = next;
    if (ops.length === 0) return [];
    return [this.base(EventType.STATE_DELTA, { delta: ops })];
  }

  private custom(name: string, value: unknown): BaseEvent {
    return this.base(EventType.CUSTOM, { name, value });
  }

  private base(type: EventType, fields: Record<string, unknown>): BaseEvent {
    return { type, ...fields } as unknown as BaseEvent;
  }

  private emit(...groups: (BaseEvent | BaseEvent[])[]): MapperOutput {
    const events: BaseEvent[] = [];
    for (const g of groups) {
      if (Array.isArray(g)) events.push(...g);
      else events.push(g);
    }
    return { events };
  }

  private rememberEventId(id: string): void {
    this.seenEventIds.add(id);
    if (this.seenEventIds.size > 1000) {
      // Bounded: drop the oldest half (insertion order) so a long session does not leak
      const half = Math.floor(this.seenEventIds.size / 2);
      let i = 0;
      for (const key of this.seenEventIds) {
        if (i++ >= half) break;
        this.seenEventIds.delete(key);
      }
    }
  }

  private serviceToolKind(
    type: string
  ): 'mcp' | 'foundry_agent' | 'web_search' | 'file_search' | 'mcp_list_tools' | null {
    if (type.startsWith('response.mcp_call')) return 'mcp';
    if (type.startsWith('mcp_list_tools')) return 'mcp_list_tools';
    if (type.startsWith('response.foundry_agent_call')) return 'foundry_agent';
    if (type.startsWith('response.web_search_call')) return 'web_search';
    if (type.startsWith('response.file_search_call')) return 'file_search';
    return null;
  }
}
