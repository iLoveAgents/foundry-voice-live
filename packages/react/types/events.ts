/**
 * Voice Live protocol events (wire format, snake_case).
 *
 * These types mirror the JSON messages exchanged over the Voice Live WebSocket
 * (and, for the WebRTC transport, the control channel + `voice-live-events` data channel).
 * Event names are verified against the official `@azure/ai-voicelive` SDK enums by the
 * protocol contract test (`utils/protocolContract.test.ts`).
 *
 * Only the events the SDK itself consumes are modelled field-by-field; the remaining
 * known events share a generic shape (`OtherServerEvent`) but keep a literal `type`
 * so `switch (event.type)` narrows correctly.
 */

// ============================================================================
// SHARED SHAPES
// ============================================================================

/** Error payload carried by `error` events and failed operations */
export interface VoiceLiveErrorDetails {
  type?: string;
  code?: string;
  message: string;
  param?: string | null;
  event_id?: string;
}

/** Warning payload carried by `warning` events (non-fatal) */
export interface VoiceLiveWarningDetails {
  message: string;
  code?: string;
  param?: string | null;
}

/** Content part types used in conversation items */
export type ContentPartType = 'input_text' | 'input_audio' | 'input_image' | 'text' | 'audio';

/** Content part inside a conversation item (wire format) */
export interface WireContentPart {
  type: ContentPartType;
  text?: string;
  /** Base64 audio (input_audio / audio) */
  audio?: string | null;
  transcript?: string | null;
  /** input_image only */
  image_url?: string;
  detail?: string;
}

/** Conversation item types (wire format) */
export type ConversationItemType =
  | 'message'
  | 'function_call'
  | 'function_call_output'
  | 'mcp_list_tools'
  | 'mcp_call'
  | 'mcp_approval_request'
  | 'mcp_approval_response'
  | 'foundry_agent_call'
  | 'web_search_call'
  | 'file_search_call';

/** Conversation item as returned by the service (wire format) */
export interface WireConversationItem {
  id?: string;
  object?: string;
  type: ConversationItemType | (string & Record<string, never>);
  status?: 'in_progress' | 'completed' | 'incomplete' | (string & Record<string, never>);
  role?: 'system' | 'user' | 'assistant';
  content?: WireContentPart[];
  /** function_call / function_call_output */
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
  /** mcp_* items */
  server_label?: string;
  approval_request_id?: string;
  approve?: boolean;
  error?: VoiceLiveErrorDetails | null;
  [key: string]: unknown;
}

/** Response object carried by response.created / response.done */
export interface WireResponse {
  id: string;
  object?: string;
  status?: 'in_progress' | 'completed' | 'cancelled' | 'incomplete' | 'failed';
  status_details?: { type?: string; reason?: string; error?: VoiceLiveErrorDetails } | null;
  output?: WireConversationItem[];
  usage?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: Record<string, number>;
    output_token_details?: Record<string, number>;
  };
  conversation_id?: string;
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

/** Session object as returned by session.created / session.updated (wire format) */
export interface WireSession {
  id?: string;
  object?: string;
  model?: string;
  /** Unix seconds */
  expires_at?: number;
  modalities?: string[];
  voice?: unknown;
  avatar?: { ice_servers?: RTCIceServer[]; [key: string]: unknown };
  [key: string]: unknown;
}

// ============================================================================
// SERVER EVENTS (server → client)
// ============================================================================

interface ServerEventBase {
  event_id?: string;
  /** Forward-compatible: services add fields over time; keeps events assignable to `VoiceLiveEvent` */
  [key: string]: unknown;
}

interface ResponseScopedEvent extends ServerEventBase {
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
}

export interface SessionCreatedEvent extends ServerEventBase {
  type: 'session.created';
  session: WireSession;
}
export interface SessionUpdatedEvent extends ServerEventBase {
  type: 'session.updated';
  session: WireSession;
}
export interface SessionAvatarConnectingEvent extends ServerEventBase {
  type: 'session.avatar.connecting';
  /** Base64-encoded SDP answer */
  server_sdp?: string;
}
export interface ConversationItemCreatedEvent extends ServerEventBase {
  type: 'conversation.item.created';
  previous_item_id?: string | null;
  item: WireConversationItem;
}
export interface ConversationItemTruncatedEvent extends ServerEventBase {
  type: 'conversation.item.truncated';
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}
export interface InputAudioTranscriptionDeltaEvent extends ServerEventBase {
  type: 'conversation.item.input_audio_transcription.delta';
  item_id: string;
  content_index?: number;
  delta: string;
}
export interface InputAudioTranscriptionCompletedEvent extends ServerEventBase {
  type: 'conversation.item.input_audio_transcription.completed';
  item_id: string;
  content_index?: number;
  transcript: string;
  [key: string]: unknown;
}
export interface InputAudioTranscriptionFailedEvent extends ServerEventBase {
  type: 'conversation.item.input_audio_transcription.failed';
  item_id: string;
  content_index?: number;
  error: VoiceLiveErrorDetails;
}
export interface InputAudioBufferSpeechStartedEvent extends ServerEventBase {
  type: 'input_audio_buffer.speech_started';
  audio_start_ms?: number;
  item_id?: string;
}
export interface InputAudioBufferSpeechStoppedEvent extends ServerEventBase {
  type: 'input_audio_buffer.speech_stopped';
  audio_end_ms?: number;
  item_id?: string;
}
export interface ResponseCreatedEvent extends ServerEventBase {
  type: 'response.created';
  response: WireResponse;
}
export interface ResponseDoneEvent extends ServerEventBase {
  type: 'response.done';
  response: WireResponse;
}
export interface ResponseOutputItemAddedEvent extends ServerEventBase {
  type: 'response.output_item.added';
  response_id: string;
  output_index: number;
  item: WireConversationItem;
}
export interface ResponseOutputItemDoneEvent extends ServerEventBase {
  type: 'response.output_item.done';
  response_id: string;
  output_index: number;
  item: WireConversationItem;
}
export interface ResponseTextDeltaEvent extends ResponseScopedEvent {
  type: 'response.text.delta';
  delta: string;
}
export interface ResponseTextDoneEvent extends ResponseScopedEvent {
  type: 'response.text.done';
  text: string;
}
export interface ResponseAudioDeltaEvent extends ResponseScopedEvent {
  type: 'response.audio.delta';
  /** Base64 PCM16 */
  delta: string;
}
export interface ResponseAudioDoneEvent extends ResponseScopedEvent {
  type: 'response.audio.done';
}
export interface ResponseAudioTranscriptDeltaEvent extends ResponseScopedEvent {
  type: 'response.audio_transcript.delta';
  delta: string;
}
export interface ResponseAudioTranscriptDoneEvent extends ResponseScopedEvent {
  type: 'response.audio_transcript.done';
  transcript: string;
}
export interface ResponseFunctionCallArgumentsDeltaEvent extends ServerEventBase {
  type: 'response.function_call_arguments.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  delta: string;
}
export interface ResponseFunctionCallArgumentsDoneEvent extends ServerEventBase {
  type: 'response.function_call_arguments.done';
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  name: string;
  arguments: string;
}
export interface ResponseAnimationVisemeDeltaEvent extends ResponseScopedEvent {
  type: 'response.animation_viseme.delta';
  audio_offset_ms: number;
  viseme_id: number;
}
export interface ResponseAudioTimestampDeltaEvent extends ResponseScopedEvent {
  type: 'response.audio_timestamp.delta';
  audio_offset_ms: number;
  audio_duration_ms: number;
  text: string;
  timestamp_type: 'word';
}
export interface ServerErrorEvent extends ServerEventBase {
  type: 'error';
  error: VoiceLiveErrorDetails;
}
export interface ServerWarningEvent extends ServerEventBase {
  type: 'warning';
  warning: VoiceLiveWarningDetails;
}

/** WebRTC transport: SDP answer after `rtc.call.sdp.create` (control channel) */
export interface RtcCallSdpCreatedEvent extends ServerEventBase {
  type: 'rtc.call.sdp.created';
  rtc_call_id?: string;
  sdp_answer: string;
}
/** WebRTC transport: error for any rtc.call operation (control channel) */
export interface RtcCallErrorEvent extends ServerEventBase {
  type: 'rtc.call.error';
  operation?: string;
  rtc_call_id?: string;
  error: VoiceLiveErrorDetails;
}

/**
 * Known server events that the SDK does not model field-by-field (single source of truth
 * for `OtherServerEvent['type']`; the contract test checks them against Microsoft's SDK).
 */
export const OTHER_SERVER_EVENT_TYPES = [
  'session.avatar.switch_to_speaking',
  'session.avatar.switch_to_idle',
  'conversation.item.retrieved',
  'conversation.item.deleted',
  'input_audio_buffer.committed',
  'input_audio_buffer.cleared',
  'output_audio_buffer.cleared',
  'output_audio_buffer.started',
  'output_audio_buffer.stopped',
  'response.content_part.added',
  'response.content_part.done',
  'response.audio_transcript.annotation.added',
  'response.mcp_call_arguments.delta',
  'response.mcp_call_arguments.done',
  'response.mcp_call.in_progress',
  'response.mcp_call.completed',
  'response.mcp_call.failed',
  'mcp_list_tools.in_progress',
  'mcp_list_tools.completed',
  'mcp_list_tools.failed',
  'response.foundry_agent_call_arguments.delta',
  'response.foundry_agent_call_arguments.done',
  'response.foundry_agent_call.in_progress',
  'response.foundry_agent_call.completed',
  'response.foundry_agent_call.failed',
  'response.web_search_call.searching',
  'response.web_search_call.in_progress',
  'response.web_search_call.completed',
  'response.file_search_call.searching',
  'response.file_search_call.in_progress',
  'response.file_search_call.completed',
  'response.animation_blendshapes.delta',
  'response.animation_blendshapes.done',
  'response.animation_viseme.done',
  'response.audio_timestamp.done',
  'response.video.delta',
  'response.invocation.delta',
  'rate_limits.updated',
] as const;

/**
 * Known server events that the SDK does not model field-by-field.
 * The literal `type` union keeps `switch` narrowing intact.
 */
export interface OtherServerEvent extends ServerEventBase {
  type: (typeof OTHER_SERVER_EVENT_TYPES)[number];
  [key: string]: unknown;
}

/**
 * Discriminated union of all known Voice Live server events.
 * Unknown/future event types still flow through `onEvent` at runtime; handle them
 * in a `default` branch.
 */
export type VoiceLiveServerEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionAvatarConnectingEvent
  | ConversationItemCreatedEvent
  | ConversationItemTruncatedEvent
  | InputAudioTranscriptionDeltaEvent
  | InputAudioTranscriptionCompletedEvent
  | InputAudioTranscriptionFailedEvent
  | InputAudioBufferSpeechStartedEvent
  | InputAudioBufferSpeechStoppedEvent
  | ResponseCreatedEvent
  | ResponseDoneEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent
  | ResponseAudioTranscriptDeltaEvent
  | ResponseAudioTranscriptDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseAnimationVisemeDeltaEvent
  | ResponseAudioTimestampDeltaEvent
  | ServerErrorEvent
  | ServerWarningEvent
  | RtcCallSdpCreatedEvent
  | RtcCallErrorEvent
  | OtherServerEvent;

/** All known server event type names */
export type ServerEventType = VoiceLiveServerEvent['type'];

/** Server events modelled field-by-field (their `type` literals) */
export const TYPED_SERVER_EVENT_TYPES = [
  'session.created',
  'session.updated',
  'session.avatar.connecting',
  'conversation.item.created',
  'conversation.item.truncated',
  'conversation.item.input_audio_transcription.delta',
  'conversation.item.input_audio_transcription.completed',
  'conversation.item.input_audio_transcription.failed',
  'input_audio_buffer.speech_started',
  'input_audio_buffer.speech_stopped',
  'response.created',
  'response.done',
  'response.output_item.added',
  'response.output_item.done',
  'response.text.delta',
  'response.text.done',
  'response.audio.delta',
  'response.audio.done',
  'response.audio_transcript.delta',
  'response.audio_transcript.done',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
  'response.animation_viseme.delta',
  'response.audio_timestamp.delta',
  'error',
  'warning',
  'rtc.call.sdp.created',
  'rtc.call.error',
] as const;

/** Every known server event type name (runtime list; the type-level check below keeps it complete) */
export const SERVER_EVENT_TYPES = [...TYPED_SERVER_EVENT_TYPES, ...OTHER_SERVER_EVENT_TYPES] as const;

// Compile-time completeness: every member of the union must be listed, and vice versa
type _MissingServerNames = Exclude<ServerEventType, (typeof SERVER_EVENT_TYPES)[number]>;
type _ExtraServerNames = Exclude<(typeof SERVER_EVENT_TYPES)[number], ServerEventType>;
const _serverEventNamesComplete: _MissingServerNames extends never
  ? _ExtraServerNames extends never
    ? true
    : never
  : never = true;
void _serverEventNamesComplete;

/** Extract the event shape for a given server event type */
export type ServerEventOf<T extends ServerEventType> = Extract<VoiceLiveServerEvent, { type: T }>;

/**
 * Server events that carry model output and are used to derive
 * assistant transcripts (audio transcript for audio modality, text for text-only).
 */
export type TranscriptDeltaEvent = ResponseAudioTranscriptDeltaEvent | ResponseTextDeltaEvent;

// ============================================================================
// CLIENT EVENTS (client → server)
// ============================================================================

/** Message item for `conversation.item.create` (wire format) */
export interface WireMessageRequestItem {
  type: 'message';
  role: 'system' | 'user' | 'assistant';
  content: WireContentPart[];
  id?: string;
}
/** Function call item for `conversation.item.create` (wire format) */
export interface WireFunctionCallRequestItem {
  type: 'function_call';
  name: string;
  arguments: string;
  call_id: string;
  id?: string;
}
/** Function call output item for `conversation.item.create` (wire format) */
export interface WireFunctionCallOutputRequestItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
  id?: string;
}
/** MCP approval response item for `conversation.item.create` (wire format) */
export interface WireMcpApprovalResponseRequestItem {
  type: 'mcp_approval_response';
  approval_request_id: string;
  approve: boolean;
  id?: string;
}
/** Items accepted by `conversation.item.create` (wire format) */
export type WireConversationRequestItem =
  | WireMessageRequestItem
  | WireFunctionCallRequestItem
  | WireFunctionCallOutputRequestItem
  | WireMcpApprovalResponseRequestItem;

/** Options for `response.create` (wire format) */
export interface WireResponseCreateOptions {
  modalities?: string[];
  instructions?: string;
  voice?: unknown;
  output_audio_format?: string;
  tools?: unknown[];
  tool_choice?: unknown;
  temperature?: number;
  max_response_output_tokens?: number | 'inf';
  conversation?: 'auto' | 'none';
  metadata?: Record<string, string>;
  input?: WireConversationRequestItem[];
  /** Per-response interim response override */
  interim_response?: unknown;
  /** Proactive message: synthesize this assistant text instead of generating one */
  pre_generated_assistant_message?: {
    type: 'message';
    role: 'assistant';
    content: Array<{ type: 'text'; text: string }>;
  };
  [key: string]: unknown;
}

interface ClientEventBase {
  event_id?: string;
  [key: string]: unknown;
}

export interface SessionUpdateClientEvent extends ClientEventBase {
  type: 'session.update';
  session: Record<string, unknown>;
}
export interface SessionAvatarConnectClientEvent extends ClientEventBase {
  type: 'session.avatar.connect';
  /** Base64-encoded SDP offer */
  client_sdp: string;
}
export interface InputAudioBufferAppendClientEvent extends ClientEventBase {
  type: 'input_audio_buffer.append';
  /** Base64 audio */
  audio: string;
}
export interface InputAudioBufferCommitClientEvent extends ClientEventBase {
  type: 'input_audio_buffer.commit';
}
export interface InputAudioBufferClearClientEvent extends ClientEventBase {
  type: 'input_audio_buffer.clear';
}
export interface InputTextDeltaClientEvent extends ClientEventBase {
  type: 'input_text.delta';
  delta: string;
}
export interface InputTextDoneClientEvent extends ClientEventBase {
  type: 'input_text.done';
}
export interface ConversationItemCreateClientEvent extends ClientEventBase {
  type: 'conversation.item.create';
  previous_item_id?: string;
  item: WireConversationRequestItem;
}
export interface ConversationItemRetrieveClientEvent extends ClientEventBase {
  type: 'conversation.item.retrieve';
  item_id: string;
}
export interface ConversationItemTruncateClientEvent extends ClientEventBase {
  type: 'conversation.item.truncate';
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}
export interface ConversationItemDeleteClientEvent extends ClientEventBase {
  type: 'conversation.item.delete';
  item_id: string;
}
export interface ResponseCreateClientEvent extends ClientEventBase {
  type: 'response.create';
  response?: WireResponseCreateOptions;
}
export interface ResponseCancelClientEvent extends ClientEventBase {
  type: 'response.cancel';
}
export interface OutputAudioBufferClearClientEvent extends ClientEventBase {
  type: 'output_audio_buffer.clear';
}
/** WebRTC transport: SDP offer + initial session config (control channel) */
export interface RtcCallSdpCreateClientEvent extends ClientEventBase {
  type: 'rtc.call.sdp.create';
  sdp_offer: string;
  session?: Record<string, unknown>;
}

/** Discriminated union of all known Voice Live client events */
export type VoiceLiveClientEvent =
  | SessionUpdateClientEvent
  | SessionAvatarConnectClientEvent
  | InputAudioBufferAppendClientEvent
  | InputAudioBufferCommitClientEvent
  | InputAudioBufferClearClientEvent
  | InputTextDeltaClientEvent
  | InputTextDoneClientEvent
  | ConversationItemCreateClientEvent
  | ConversationItemRetrieveClientEvent
  | ConversationItemTruncateClientEvent
  | ConversationItemDeleteClientEvent
  | ResponseCreateClientEvent
  | ResponseCancelClientEvent
  | OutputAudioBufferClearClientEvent
  | RtcCallSdpCreateClientEvent;

/** All known client event type names */
export type ClientEventType = VoiceLiveClientEvent['type'];

/** Every known client event type name (runtime list; the type-level check below keeps it complete) */
export const CLIENT_EVENT_TYPES = [
  'session.update',
  'session.avatar.connect',
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_buffer.clear',
  'input_text.delta',
  'input_text.done',
  'conversation.item.create',
  'conversation.item.retrieve',
  'conversation.item.truncate',
  'conversation.item.delete',
  'response.create',
  'response.cancel',
  'output_audio_buffer.clear',
  'rtc.call.sdp.create',
] as const;

type _MissingClientNames = Exclude<ClientEventType, (typeof CLIENT_EVENT_TYPES)[number]>;
type _ExtraClientNames = Exclude<(typeof CLIENT_EVENT_TYPES)[number], ClientEventType>;
const _clientEventNamesComplete: _MissingClientNames extends never
  ? _ExtraClientNames extends never
    ? true
    : never
  : never = true;
void _clientEventNamesComplete;
