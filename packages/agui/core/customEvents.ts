/**
 * Names and payloads of the AG-UI `CUSTOM` events this bridge emits.
 *
 * AG-UI has no vocabulary for speech, so everything voice-specific — turn taking, barge-in,
 * avatar state, warnings — travels as `CUSTOM` events under a `voice.` namespace. A UI that does
 * not know them ignores them; one that does can render a mic indicator or grey out a truncated
 * reply. Payload types are exported so consumers can narrow on `name`.
 */

export const VOICE_CUSTOM_EVENTS = {
  /** The service created the session (also resets the bridge's per-session maps) */
  sessionCreated: 'voice.session.created',
  /** The user started speaking (server VAD) */
  speechStarted: 'voice.speech_started',
  /** The user stopped speaking (server VAD) */
  speechStopped: 'voice.speech_stopped',
  /** The user interrupted an assistant message that was still being spoken */
  interrupted: 'voice.interrupted',
  /** The service truncated an assistant item at `audioEndMs` — text after that was never heard */
  truncated: 'voice.truncated',
  /** The service revised an earlier transcript; the snapshot that follows carries the corrected text */
  transcriptCorrected: 'voice.transcript.corrected',
  /** Transcription of a user turn failed */
  transcriptionFailed: 'voice.transcription_failed',
  /** A response was cancelled (barge-in or `cancelResponse()`) */
  responseCancelled: 'voice.response.cancelled',
  /** The service asked the user to approve an MCP tool call */
  mcpApprovalRequest: 'voice.mcp.approval_request',
  /** Lifecycle of a service-side MCP / Foundry-agent / built-in tool call */
  serviceToolCall: 'voice.service_tool_call',
  /** A service `warning` event, or an SDK-side configuration warning */
  warning: 'voice.warning',
  /** A non-fatal service error */
  error: 'voice.error',
  /** Avatar connection state changed */
  avatar: 'voice.avatar',
  /** The bridge is connected and the session is ready to be spoken to */
  ready: 'voice.ready',
  /** Connection-level state changed (connecting, reconnecting, …) */
  connection: 'voice.connection',
  /** Reconnect attempt scheduled */
  reconnecting: 'voice.reconnecting',
  /** Reconnected; the server-side conversation started over */
  reconnected: 'voice.reconnected',
} as const;

export type VoiceCustomEventName = (typeof VOICE_CUSTOM_EVENTS)[keyof typeof VOICE_CUSTOM_EVENTS];

export interface VoiceCustomPayloads {
  'voice.session.created': { sessionId: string | null; model: string | null };
  'voice.speech_started': { audioStartMs: number | null; itemId: string | null };
  'voice.speech_stopped': { audioEndMs: number | null; itemId: string | null };
  'voice.interrupted': { messageId: string | null; responseId: string | null };
  'voice.truncated': { itemId: string; contentIndex: number; audioEndMs: number };
  'voice.transcript.corrected': { messageId: string; role: 'user' | 'assistant'; text: string };
  'voice.transcription_failed': { itemId: string; message: string; code?: string };
  'voice.response.cancelled': { responseId: string };
  'voice.mcp.approval_request': {
    approvalRequestId: string;
    serverLabel: string;
    name: string;
    arguments: string;
  };
  'voice.service_tool_call': {
    kind: 'mcp' | 'foundry_agent' | 'web_search' | 'file_search' | 'mcp_list_tools';
    phase: string;
    itemId: string | null;
    raw: Record<string, unknown>;
  };
  'voice.warning': { message: string; code?: string; param?: string | null };
  'voice.error': { message: string; code?: string; eventId?: string | null };
  'voice.avatar': { phase: 'connecting' | 'speaking' | 'idle' };
  'voice.ready': Record<string, never>;
  'voice.connection': { state: string };
  'voice.reconnecting': { attempt: number; delayMs: number };
  'voice.reconnected': Record<string, never>;
}
