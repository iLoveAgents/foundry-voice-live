/**
 * Complete Voice Live API Type Definitions
 *
 * Comprehensive TypeScript types for Microsoft Foundry Voice Live API
 * Includes all parameters from Azure OpenAI Realtime API + Voice Live additions
 */

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Base Voice Live API event structure
 * All events from the API follow this pattern.
 * See `types/events.ts` for the typed server/client event unions.
 */
export interface VoiceLiveEvent {
  type: string;
  event_id?: string;
  [key: string]: unknown; // Additional event-specific properties
}

import type { VoiceLiveServerEvent, VoiceLiveClientEvent, VoiceLiveWarningDetails } from './events';

// Re-export typed protocol events so consumers can import everything from one place
export type {
  VoiceLiveServerEvent,
  VoiceLiveClientEvent,
  ServerEventType,
  ClientEventType,
  ServerEventOf,
} from './events';

// ============================================================================
// MODEL & CONNECTION
// ============================================================================

/**
 * Known Voice Live models with their pricing tiers
 */
export type KnownVoiceLiveModel =
  // Pro tier - Best quality
  | 'gpt-realtime' // Native audio, best quality
  | 'azure-realtime' // Azure native speech-to-speech (GA 2026-07-15); use with 'azure-realtime-native' voices
  | 'gpt-4o' // Azure STT/TTS
  | 'gpt-4.1' // Azure STT/TTS
  | 'gpt-5' // Azure STT/TTS
  | 'gpt-5-chat' // Azure STT/TTS
  // Basic tier
  | 'gpt-realtime-mini' // Native audio
  | 'gpt-4o-mini' // Azure STT/TTS
  | 'gpt-4.1-mini' // Azure STT/TTS
  | 'gpt-5-mini' // Azure STT/TTS
  // Lite tier
  | 'gpt-5-nano' // Azure STT/TTS
  | 'phi4-mm-realtime' // Native audio
  | 'phi4-mini'; // Azure STT/TTS

/**
 * Voice Live model - extensible to support future models
 * Use any string, but known models provide better type hints
 */
export type VoiceLiveModel = KnownVoiceLiveModel | (string & Record<string, never>);

/**
 * Transport used for the realtime session.
 *
 * - `'websocket'` (default): PCM16 audio is streamed as base64 events over the WebSocket.
 * - `'webrtc'` (preview): audio flows over an RTCPeerConnection (RTP), non-audio events
 *   arrive over the `voice-live-events` data channel, and a WebSocket control channel to
 *   `/voice-live/realtime/calls` carries session control and tool-call events.
 *   Voice-only — avatar is not supported over the WebRTC transport.
 *
 * @see {@link https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-webrtc}
 */
export type VoiceLiveTransport = 'websocket' | 'webrtc';

/**
 * Connection configuration for Voice Live API
 */
export interface VoiceLiveConnectionConfig {
  /** Microsoft Foundry resource name (the `<name>` in `<name>.services.ai.azure.com`) */
  resourceName?: string;

  /**
   * API key authentication. Convenient for local development; never ship API keys in
   * client code — use `proxyUrl` (or `token`) in production.
   */
  apiKey?: string;

  /**
   * Microsoft Entra ID access token (scope `https://ai.azure.com/.default`).
   *
   * Direct connections send it as the documented browser-friendly
   * `Authorization=Bearer <token>` query parameter (works for standard mode and
   * Foundry Agents). Prefer `proxyUrl` in production so tokens never appear in URLs.
   */
  token?: string;

  /**
   * Token provider called on every (re)connect — use it instead of `token` when tokens
   * expire (e.g. MSAL `acquireTokenSilent`). Takes precedence over `token`.
   */
  getToken?: () => string | Promise<string>;

  /**
   * Model to use (standard mode)
   * @default 'gpt-realtime'
   */
  model?: VoiceLiveModel;

  /**
   * Voice Live API version.
   * @default '2026-07-15' (DEFAULT_API_VERSION); WebRTC transport defaults to
   *   '2026-01-01-preview' (DEFAULT_WEBRTC_API_VERSION)
   */
  apiVersion?: string;

  // ===== Foundry Agents (mutually exclusive with model) =====

  /**
   * Agent name as configured in the Microsoft Foundry portal.
   * Requires Entra ID authentication (`token` for direct connections, or a proxy that
   * uses DefaultAzureCredential / token passthrough). API keys are not supported for agents.
   *
   * @example 'VoiceLiveAgent'
   * @see {@link https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart}
   */
  agentName?: string;

  /** Foundry project name that contains the agent (required with `agentName`) */
  projectName?: string;

  /**
   * Resume a previous conversation.
   * Pass the conversation ID from a previous session to continue where it left off.
   */
  conversationId?: string;

  /**
   * Pin a specific agent version.
   * If not set, defaults to the latest version.
   */
  agentVersion?: string;

  /**
   * Run the agent on a different Foundry resource than the one serving audio
   * (cross-resource agents). Sent as `foundry-resource-override`.
   */
  foundryResourceOverride?: string;

  /**
   * Client ID of the user-assigned managed identity used to authenticate the agent
   * invocation. Sent as `agent-authentication-identity-client-id`.
   */
  agentAuthenticationIdentityClientId?: string;

  // ===== Proxy Mode =====

  /**
   * Proxy WebSocket URL (for secure backend proxy)
   * When set, overrides all other connection parameters
   *
   * Supports @iloveagents/foundry-voice-live-proxy-node or custom proxy servers.
   * Mode is automatically detected by the proxy based on URL parameters.
   *
   * Standard mode:         'ws://localhost:8080/ws?model=gpt-realtime'
   * Standard with MSAL:    'ws://localhost:8080/ws?model=gpt-realtime&token=${msalToken}'
   * Foundry Agent:         'ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject'
   * Foundry Agent (MSAL):  'ws://localhost:8080/ws?agentName=MyAgent&projectName=myProject&token=${msalToken}'
   *
   * With `transport: 'webrtc'` the SDK appends `transport=webrtc` so the proxy relays the
   * control channel to `/voice-live/realtime/calls`.
   *
   * @see {@link https://github.com/iLoveAgents/foundry-voice-live}
   */
  proxyUrl?: string;

  /**
   * Explicitly enable agent mode for session configuration.
   *
   * When true, session.update omits fields not supported in agent mode
   * (temperature, instructions, tools, maxResponseOutputTokens).
   *
   * Usually auto-detected from agentName in the URL or connection config.
   * Set explicitly when the proxy handles agent config server-side and the
   * proxy URL doesn't contain agent params.
   *
   * @default auto-detected from URL params or connection config
   */
  agentMode?: boolean;

  // ===== Transport =====

  /**
   * Realtime transport.
   * @default 'websocket'
   */
  transport?: VoiceLiveTransport;

  /**
   * Optional RTCConfiguration for `transport: 'webrtc'` (e.g. TURN servers for
   * UDP-restricted networks). By default no ICE servers are configured, matching
   * the Microsoft sample.
   */
  rtcConfiguration?: RTCConfiguration;
}

// ============================================================================
// AUDIO FORMATS
// ============================================================================

/**
 * Audio format for input/output
 */
export type AudioFormat = 'pcm16' | 'g711_ulaw' | 'g711_alaw';

/**
 * Input audio sampling rate (Voice Live)
 */
export type InputAudioSamplingRate = 16000 | 24000;

// ============================================================================
// INPUT AUDIO CONFIGURATION
// ============================================================================

/**
 * Echo cancellation configuration (Voice Live)
 * Removes model's voice from input without client-side cancellation
 */
export interface InputAudioEchoCancellation {
  type: 'server_echo_cancellation';

  /**
   * Echo reference source (Live-Reference AEC).
   * - 'server' (default): the service uses its own TTS output as the echo reference.
   * - 'client': the client streams interleaved stereo PCM16 (channel 0 = mic,
   *   channel 1 = the audio actually played back) and the service uses channel 1
   *   as the reference. Requires `channels: 2` and `inputAudioFormat: 'pcm16'`.
   *
   * Note: stereo reference capture is not yet implemented by `useAudioCapture`;
   * this option is currently types/wire-format only.
   * @default 'server'
   */
  referenceSource?: 'server' | 'client';

  /**
   * Input channel count. `2` = interleaved stereo for client-reference AEC.
   * @default 1
   */
  channels?: 1 | 2;
}

/**
 * Noise reduction type
 */
export type NoiseReductionType =
  | 'azure_deep_noise_suppression' // Voice Live: Optimized for close microphones
  | 'near_field' // Azure OpenAI: Close-talking microphones
  | 'far_field'; // Azure OpenAI: Far-field microphones

/**
 * Noise reduction configuration
 * Enhances input audio by suppressing environmental background noise
 */
export interface InputAudioNoiseReduction {
  type: NoiseReductionType;
}

/**
 * Transcription model for input audio
 */
export type TranscriptionModel =
  | 'whisper-1'
  | 'gpt-4o-transcribe'
  | 'gpt-4o-mini-transcribe'
  | 'gpt-4o-transcribe-diarize'
  | 'mai-transcribe'; // Preview: works with all models and agents

/**
 * Custom speech model configuration per locale (Voice Live)
 * Maps locale codes to custom speech model IDs
 *
 * @example
 * ```ts
 * // Use custom model for Chinese, base model for English
 * customSpeech: {
 *   'zh-CN': '847cb03d-7f22-4b11-444-e1be1d77bf17'
 * }
 * ```
 */
export type CustomSpeechConfig = Record<string, string>;

/**
 * Input audio transcription configuration
 * Used with non-multimodal models (gpt-4o, gpt-4.1, gpt-5, etc.)
 */
export interface InputAudioTranscription {
  /**
   * Transcription model.
   * - `gpt-realtime` / `gpt-realtime-mini`: 'whisper-1', 'gpt-4o-transcribe',
   *   'gpt-4o-mini-transcribe', 'gpt-4o-transcribe-diarize', 'mai-transcribe'
   * - All other models and Foundry agents: 'azure-speech', 'mai-transcribe'
   */
  model?: 'azure-speech' | TranscriptionModel;

  /**
   * Language in ISO-639-1 format (e.g., 'en', 'es', 'fr')
   * Improves accuracy and latency
   */
  language?: string;

  /**
   * Guidance text for transcription
   * - For whisper-1: list of keywords
   * - For gpt-4o-transcribe: free text like "expect words related to technology"
   */
  prompt?: string;

  /**
   * Phrase list for lightweight just-in-time customization (Voice Live)
   * Improves recognition accuracy for specific words/phrases
   *
   * Note: Only works with model: 'azure-speech'
   * Does not support gpt-realtime, gpt-4o-mini-realtime, phi4-mm-realtime
   *
   * @example ['Neo QLED TV', 'TUF Gaming', 'AutoQuote Explorer']
   */
  phraseList?: string[];

  /**
   * Custom speech models per locale (Voice Live)
   * Maps locale codes to custom speech model IDs
   * Requires model: 'azure-speech'
   *
   * Note: Custom speech models must be available on the same
   * Microsoft Foundry resource used to call the Voice Live API
   *
   * @example { 'zh-CN': '847cb03d-7f22-4b11-444-e1be1d77bf17' }
   */
  customSpeech?: CustomSpeechConfig;
}

// ============================================================================
// TURN DETECTION
// ============================================================================

/**
 * Turn detection type
 */
export type TurnDetectionType =
  | 'server_vad' // Volume-based (Azure OpenAI default)
  | 'semantic_vad' // Semantic (gpt-realtime/mini only)
  | 'azure_semantic_vad' // Voice Live: Azure semantic (all models)
  | 'azure_semantic_vad_en' // Voice Live: English-optimized Azure semantic
  | 'azure_semantic_vad_multilingual'; // Voice Live: Multilingual semantic

/**
 * Eagerness for semantic_vad (Azure OpenAI)
 * Controls how eager the model is to respond/interrupt
 */
export type Eagerness = 'low' | 'medium' | 'high' | 'auto';

/**
 * End of utterance detection model (Voice Live)
 */
export type EndOfUtteranceModel =
  | 'semantic_detection_v1' // English only (text-based)
  | 'semantic_detection_v1_en' // English-optimized (text-based)
  | 'semantic_detection_v1_multilingual' // Multi-language support (text-based)
  | 'smart_end_of_turn_detection'; // Audio-based EOU (operates on the input audio stream)

/**
 * End of utterance detection threshold level (Voice Live)
 */
export type EndOfUtteranceThreshold = 'low' | 'medium' | 'high' | 'default';

/**
 * End of utterance detection configuration (Voice Live)
 * Reduces premature end-of-turn signals without adding latency
 */
export interface EndOfUtteranceDetection {
  /** Model to use for detection */
  model: EndOfUtteranceModel;

  /**
   * Detection threshold level
   * @default 'default' (equivalent to 'medium')
   */
  thresholdLevel?: EndOfUtteranceThreshold;

  /**
   * Maximum time to wait for more user speech (ms)
   * @default 1000
   */
  timeoutMs?: number;
}

/**
 * Complete turn detection configuration
 * Combines Azure OpenAI Realtime API + Voice Live additions
 */
export interface TurnDetectionConfig {
  /**
   * Turn detection type
   * @default 'server_vad' (Azure OpenAI), recommended: 'azure_semantic_vad' (Voice Live)
   */
  type?: TurnDetectionType;

  // ===== Common Parameters (all VAD types) =====

  /**
   * Activation threshold (0.0-1.0)
   * Higher = requires higher confidence of speech
   * @default 0.5
   */
  threshold?: number;

  /**
   * Audio to include before speech detection signal (ms)
   * @default 300
   */
  prefixPaddingMs?: number;

  /**
   * Minimum speech duration to start detection (ms)
   * @default 80
   */
  speechDurationMs?: number;

  /**
   * Silence duration to detect end of speech (ms)
   * @default 200 (semantic_vad), 500 (server_vad)
   */
  silenceDurationMs?: number;

  // ===== Response Control =====

  /**
   * Enable or disable automatic response generation
   * @default true
   */
  createResponse?: boolean;

  /**
   * Enable barge-in interruption
   * @default true (Azure OpenAI), false (Voice Live)
   */
  interruptResponse?: boolean;

  // ===== Semantic VAD (Azure OpenAI) =====

  /**
   * Eagerness to interrupt user (semantic_vad only)
   * @default 'auto'
   */
  eagerness?: Eagerness;

  // ===== Azure Semantic VAD (Voice Live) =====

  /**
   * Remove filler words to reduce false barge-in
   * Detected filler words in English: ['ah', 'umm', 'mm', 'uh', 'huh', 'oh', 'yeah', 'hmm']
   * @default false
   */
  removeFillerWords?: boolean;

  /**
   * Language codes to improve filler word detection accuracy
   * Supported: English, Spanish, French, Italian, German, Japanese, Portuguese, Chinese, Korean, Hindi
   */
  languages?: string[];

  /**
   * Auto-truncate on interruption: when the user barges in, the service trims the
   * assistant turn in the conversation context to what was actually played
   * (requires `interruptResponse: true`) and emits `conversation.item.truncated`.
   * @default false
   */
  autoTruncate?: boolean;

  /**
   * Text appended to the truncated assistant turn in the conversation context,
   * e.g. " [The user interrupted me.]", so the model knows it was cut off.
   * Requires `autoTruncate: true`; supported by 'azure_semantic_vad' and
   * 'azure_semantic_vad_multilingual' only. Wire: `appended_text_after_truncation`.
   */
  appendedTextAfterTruncation?: string;

  // ===== End-of-Utterance Detection (Voice Live) =====

  /**
   * Advanced end-of-turn detection configuration
   * Allows natural pauses without premature end-of-turn
   */
  endOfUtteranceDetection?: EndOfUtteranceDetection;
}

// ============================================================================
// VOICE & AUDIO OUTPUT
// ============================================================================

/**
 * OpenAI voice names (gpt-realtime family). Single source of truth for the `StandardVoice` type.
 */
export const OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;

/**
 * OpenAI voices (gpt-realtime family)
 */
export type StandardVoice = (typeof OPENAI_VOICES)[number];

/**
 * Azure Realtime native voice names — only valid with model 'azure-realtime'.
 * Single source of truth for the `AzureRealtimeNativeVoiceName` type (and voice pickers).
 */
export const AZURE_REALTIME_NATIVE_VOICES = [
  'aarti',
  'andrew',
  'ava',
  'denise',
  'diya',
  'elsa',
  'florian',
  'francisca',
  'meera',
  'ximena',
  'xiaoxiao',
  'yunxi',
] as const;

/**
 * Azure Realtime native voices — only valid with model 'azure-realtime'
 * (which in turn only accepts this voice type). Extensible to future names.
 */
export type AzureRealtimeNativeVoiceName =
  | (typeof AZURE_REALTIME_NATIVE_VOICES)[number]
  | (string & Record<string, never>);

/**
 * Underlying neural model for Azure personal voices
 */
export type PersonalVoiceModel =
  | 'DragonLatestNeural'
  | 'DragonHDOmniLatestNeural'
  | 'MAI-Voice-1'
  | (string & Record<string, never>);

/**
 * Voice type discriminator (Voice Live)
 */
export type VoiceType =
  | 'openai' // OpenAI voices (gpt-realtime family)
  | 'azure-standard' // Azure neural / HD voices, e.g. 'en-US-Ava:DragonHDLatestNeural'
  | 'azure-custom' // Custom neural voice (requires endpointId)
  | 'azure-personal' // Personal voice (requires model)
  | 'azure-realtime-native'; // Azure Realtime native voices (model 'azure-realtime' only)

/**
 * Voice configuration
 * Supports OpenAI voices, Azure standard/HD, custom, personal and Azure Realtime native voices
 */
export interface VoiceConfig {
  /**
   * Voice name
   * - OpenAI: 'alloy', 'marin', etc.
   * - Azure standard: 'en-US-AvaNeural'
   * - Azure HD: 'en-US-Ava:DragonHDLatestNeural'
   * - Azure custom / personal: your voice name
   * - Azure Realtime native: 'ava', 'andrew', ... (model 'azure-realtime')
   */
  name: string | StandardVoice | AzureRealtimeNativeVoiceName;

  /**
   * Voice type discriminator.
   * Required for Azure voices; defaults to 'azure-standard' when omitted for
   * non-OpenAI voice names.
   */
  type?: VoiceType;

  /**
   * Temperature for HD/personal voices (0.0-1.0)
   * Higher values = more variability in intonation, prosody
   * @default 0.8
   */
  temperature?: number;

  /**
   * Speaking rate as an SSML prosody value ('0.5' to '1.5', or e.g. '+10%')
   * @default '1.0'
   */
  rate?: string;

  /** SSML prosody pitch, e.g. '+10%', 'high' (Azure voices) */
  pitch?: string;

  /** SSML prosody volume, e.g. 'loud', '+6dB' (Azure voices) */
  volume?: string;

  /** Speaking style, e.g. 'cheerful' (Azure standard/custom voices) */
  style?: string;

  /**
   * Preferred locales (BCP-47) that adjust the accent per language for
   * multilingual voices, e.g. ['en-GB', 'es-ES'] (Azure voices)
   */
  preferLocales?: string[];

  /**
   * Force a single output locale (BCP-47), e.g. 'en-US'. Text in other
   * languages may be rendered as silence. (Azure voices)
   */
  locale?: string;

  /** Custom lexicon URL (Azure voices) */
  customLexiconUrl?: string;

  /** Custom text normalization URL (Azure voices) */
  customTextNormalizationUrl?: string;

  /** Custom voice deployment endpoint ID (type 'azure-custom' only) */
  endpointId?: string;

  /** Underlying model for personal voices (type 'azure-personal' only) */
  model?: PersonalVoiceModel;
}

/**
 * Audio timestamp type (Voice Live)
 */
export type TimestampType = 'word';

/**
 * Animation output type (Voice Live)
 */
export type AnimationOutput = 'viseme_id';

/**
 * Animation configuration (Voice Live)
 * Enable viseme output for lip-sync animation
 */
export interface AnimationConfig {
  /**
   * Animation outputs to enable
   * Currently only supports 'viseme_id'
   */
  outputs?: AnimationOutput[];
}

// ============================================================================
// AVATAR (Voice Live)
// ============================================================================

/**
 * Avatar video codec
 */
export type AvatarCodec = 'h264' | 'vp8' | 'vp9';

/**
 * Avatar video crop configuration
 * Useful for portrait mode / mobile
 */
export interface AvatarCrop {
  /** Top-left corner [x, y] */
  topLeft: [number, number];

  /** Bottom-right corner [x, y] */
  bottomRight: [number, number];
}

/**
 * Avatar background configuration
 */
export interface AvatarBackground {
  /**
   * Background color in hex format
   * @example '#00FF00FF' for green screen
   */
  color?: string;

  /** Background image URL */
  imageUrl?: string;
}

/**
 * Avatar video configuration
 */
export interface AvatarVideoConfig {
  /**
   * Video codec
   * @default 'h264'
   */
  codec?: AvatarCodec;

  /**
   * Video bitrate in bits per second
   * @default 2000000 (2Mbps)
   */
  bitrate?: number;

  /**
   * Video resolution
   * @default { width: 1920, height: 1080 }
   */
  resolution?: {
    width: number;
    height: number;
  };

  /**
   * Crop settings for portrait mode
   * Useful for mobile applications
   */
  crop?: AvatarCrop;

  /** Background settings */
  background?: AvatarBackground;
}

/**
 * Avatar configuration (Voice Live)
 */
export interface AvatarConfig {
  /**
   * Avatar character
   * @example 'lisa'
   */
  character: string;

  /**
   * Avatar style
   * @example 'casual-sitting', 'casual-standing'
   */
  style: string;

  /**
   * Whether using custom avatar
   * @default false
   */
  customized?: boolean;

  /**
   * ICE servers for WebRTC
   * If not provided, service returns default servers
   */
  iceServers?: RTCIceServer[];

  /** Video configuration */
  video?: AvatarVideoConfig;
}

// ============================================================================
// TOOLS & FUNCTION CALLING
// ============================================================================

/**
 * Function tool definition
 */
export interface FunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: object; // JSON schema
}

/**
 * MCP tool approval policy.
 * - 'always' (default): every call sends an `mcp_approval_request` item; the client must
 *   respond with `approveMcpCall()` before the tool executes.
 * - 'never': tools execute automatically.
 * - Per-tool: `{ always: ['submit_feedback'], never: ['search_docs'] }` (unlisted → 'always').
 */
export type McpRequireApproval = 'always' | 'never' | { always?: string[]; never?: string[] };

/**
 * Remote MCP server that Voice Live connects to server-side (tools are auto-discovered
 * and executed by the service).
 *
 * @see {@link https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-live-mcp-server}
 */
export interface MCPTool {
  type: 'mcp';

  /** Display label; used in `server_label` of MCP events */
  serverLabel: string;

  /** URL of the remote MCP endpoint */
  serverUrl: string;

  /** Restrict callable tools; omit to allow all tools the server exposes */
  allowedTools?: string[];

  /** Extra HTTP headers the service sends to the MCP server */
  headers?: Record<string, string>;

  /** Authorization value the service sends to the MCP server */
  authorization?: string;

  /** @default 'always' */
  requireApproval?: McpRequireApproval;
}

/**
 * Context handling for a Foundry agent used as a tool
 */
export type FoundryAgentContextType = 'no_context' | 'agent_context';

/**
 * Foundry agent exposed as a tool (chat-supervisor pattern): the realtime model
 * handles the conversation and delegates complex tasks to a Foundry agent.
 */
export interface FoundryAgentTool {
  type: 'foundry_agent';

  /** Name of the Foundry agent to call */
  agentName: string;

  /** Foundry project that contains the agent */
  projectName: string;

  /** Optional agent version to pin */
  agentVersion?: string;

  /** Client ID associated with the agent (managed identity) */
  clientId?: string;

  /** Overrides the agent's description from the Foundry portal */
  description?: string;

  /** Run the agent on a different Foundry resource */
  foundryResourceOverride?: string;

  /** @default 'agent_context' */
  agentContextType?: FoundryAgentContextType;

  /**
   * Return the agent's answer directly as the spoken response.
   * When false, the realtime model rephrases it.
   * @default true
   */
  returnAgentResponseDirectly?: boolean;
}

/**
 * Tool definition: client-side function, server-side MCP server, or Foundry agent
 */
export type Tool = FunctionTool | MCPTool | FoundryAgentTool;

/**
 * Tool choice strategy
 */
export type ToolChoice =
  | 'auto' // Let model decide
  | 'none' // Don't call functions
  | 'required' // Must call a function
  | {
      // Specific function
      type: 'function';
      function: { name: string };
    };

// ============================================================================
// MODALITIES
// ============================================================================

/**
 * Session modality
 */
export type Modality = 'text' | 'audio';

// ============================================================================
// SESSION CONFIGURATION
// ============================================================================

/**
 * Complete Voice Live session configuration
 * Combines all parameters from Azure OpenAI Realtime API + Voice Live additions
 */
export interface VoiceLiveSessionConfig {
  // ===== Core Configuration =====

  /**
   * Instructions (system message) for the model
   * NOT supported when using Agent Service
   */
  instructions?: string;

  /**
   * Modalities to enable
   * @default ['text', 'audio']
   */
  modalities?: Modality[];

  /**
   * Voice for audio output
   * Can be a string (voice name), StandardVoice, or full VoiceConfig
   */
  voice?: string | StandardVoice | VoiceConfig;

  /**
   * Input audio format
   * @default 'pcm16'
   */
  inputAudioFormat?: AudioFormat;

  /**
   * Output audio format
   * @default 'pcm16'
   */
  outputAudioFormat?: AudioFormat;

  /**
   * Turn detection configuration
   * Set to null to disable turn detection
   */
  turnDetection?: TurnDetectionConfig | null;

  /** Tools available to the model */
  tools?: Tool[];

  /**
   * Tool choice strategy
   * @default 'auto'
   */
  toolChoice?: ToolChoice;

  /**
   * Sampling temperature (0.6-1.2)
   * @default 0.8
   */
  temperature?: number;

  /**
   * Maximum output tokens per response
   * Range: 1-4096 or 'inf'
   * @default 'inf'
   */
  maxResponseOutputTokens?: number | 'inf';

  /**
   * Allow the model to issue multiple tool calls in parallel.
   * Set to false to force sequential tool calls. Wire: `parallel_tool_calls`
   * @default true
   */
  parallelToolCalls?: boolean;

  /**
   * Reasoning effort for reasoning-capable models (e.g. gpt-5 family).
   * Lower effort = faster responses. Wire: `reasoning_effort`
   */
  reasoningEffort?: ReasoningEffort;

  /**
   * Up to 16 string key/value pairs attached to the session (keys ≤ 64 chars,
   * values ≤ 512 chars). Included in Microsoft Foundry resource logs for tracing.
   */
  metadata?: Record<string, string>;

  // ===== Voice Live: Input Audio Additions =====

  /**
   * Input audio sampling rate
   * @default 24000
   */
  inputAudioSamplingRate?: InputAudioSamplingRate;

  /**
   * Echo cancellation configuration
   * Set to null to disable
   */
  inputAudioEchoCancellation?: InputAudioEchoCancellation | null;

  /**
   * Noise reduction configuration
   * Set to null to disable
   */
  inputAudioNoiseReduction?: InputAudioNoiseReduction | null;

  /**
   * Input audio transcription
   * Used with non-multimodal models
   * Set to null to disable
   */
  inputAudioTranscription?: InputAudioTranscription | null;

  // ===== Voice Live: Output Additions =====

  /**
   * Output audio timestamp types
   * Enable word-level timing information
   */
  outputAudioTimestampTypes?: TimestampType[];

  /**
   * Animation configuration
   * Enable viseme output for lip-sync
   */
  animation?: AnimationConfig;

  /**
   * Interim response configuration ("intermediate messages while thinking").
   * The service speaks short bridging messages while a tool call runs or when the
   * response latency exceeds a threshold.
   *
   * Supported in Foundry agent mode and with cascaded text models (gpt-4.1, gpt-5, ...)
   * combined with Azure voices. Not supported by native audio models
   * (gpt-realtime, gpt-realtime-mini, phi4-mm-realtime, azure-realtime).
   *
   * @see {@link https://learn.microsoft.com/azure/ai-services/speech-service/how-to-voice-live-interim-response}
   */
  interimResponse?: InterimResponseConfig;

  /** Avatar configuration */
  avatar?: AvatarConfig;

  /**
   * Proactive greeting configuration.
   * Makes the assistant speak first without waiting for user input.
   */
  greeting?: GreetingConfig;
}

/**
 * Reasoning effort for reasoning-capable models
 */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Interim response trigger type
 */
export type InterimResponseTrigger = 'tool' | 'latency';

/**
 * Interim response configuration
 * Provides filler messages while tools execute or during high latency
 */
export interface InterimResponseConfig {
  /**
   * Interim response type:
   * - 'llm_interim_response': a lightweight LLM generates contextual filler messages
   * - 'static_interim_response': randomly selects one of the pre-defined `texts`
   */
  type: 'llm_interim_response' | 'static_interim_response';

  /**
   * What triggers the interim response (OR logic)
   * @default ['latency']
   */
  triggers: InterimResponseTrigger[];

  /**
   * Latency threshold in milliseconds before the 'latency' trigger fires.
   * Wire: `latency_threshold_ms`
   * @default 2000
   */
  latencyThresholdInMs?: number;

  /**
   * Model used to generate the filler text ('llm_interim_response' only)
   * @default 'gpt-4.1-mini'
   */
  model?: string;

  /** Instructions for LLM interim response generation ('llm_interim_response' only) */
  instructions?: string;

  /**
   * Maximum tokens for the generated filler ('llm_interim_response' only).
   * Wire: `max_completion_tokens`
   * @default 50
   */
  maxCompletionTokens?: number;

  /** Static texts to choose from ('static_interim_response' only) */
  texts?: string[];
}

/**
 * Proactive greeting configuration
 */
export interface GreetingConfig {
  /**
   * Greeting type:
   * - 'llm': Model generates the greeting based on the prompt text
   * - 'pregenerated': Use exact pre-written greeting text
   */
  type: 'llm' | 'pregenerated';

  /**
   * For 'llm': Prompt text to guide the model (e.g., "Greet the user warmly")
   * For 'pregenerated': Exact text the assistant will speak
   */
  text: string;
}

// ============================================================================
// HOOK CONFIGURATION
// ============================================================================

/**
 * Logging verbosity of the hook.
 * 'warn' (default) only prints warnings and errors; use 'debug' during development.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

/**
 * Value a tool executor can return. Objects are JSON-stringified before being sent
 * as `function_call_output`.
 */
export type ToolResult = string | object;

/**
 * Tool executor for function calling.
 *
 * If it returns (or resolves to) a value other than `undefined`, the hook sends it as
 * the `function_call_output` for `callId` and triggers a new response automatically.
 * Return `undefined`/`void` to send the result yourself via `sendToolResult()`.
 */
export type ToolExecutor = (
  name: string,
  args: string,
  callId: string
) => void | ToolResult | Promise<void | ToolResult>;

/**
 * Non-fatal warning emitted by the service (`warning` event)
 */
export type VoiceLiveWarning = VoiceLiveWarningDetails;

/**
 * MCP tool call awaiting client approval (`mcp_approval_request` item).
 * Respond with `approveMcpCall(approvalRequestId, approve)`.
 */
export interface McpApprovalRequest {
  approvalRequestId: string;
  serverLabel: string;
  name: string;
  /** JSON string of the tool arguments */
  arguments: string;
}

/**
 * Complete configuration for useVoiceLive hook
 */
export interface UseVoiceLiveConfig {
  // ===== Connection =====

  /**
   * Connection configuration
   * Required: resourceName, apiKey or token
   */
  connection: VoiceLiveConnectionConfig;

  // ===== Session Configuration =====

  /**
   * Session configuration
   * All parameters are optional with sensible defaults
   */
  session?: VoiceLiveSessionConfig;

  // ===== Audio Capture Configuration =====

  /**
   * Automatically start microphone when session is ready
   * Set to false if you want manual control over mic start/stop
   * @default true
   */
  autoStartMic?: boolean;

  /**
   * Audio sample rate for microphone capture
   * Must match session.inputAudioSamplingRate
   * @default 24000
   */
  audioSampleRate?: number;

  /**
   * Audio constraints for microphone selection
   * Use to specify which microphone device to use
   *
   * @example
   * ```ts
   * // Use specific device
   * audioConstraints: { deviceId: 'device-id-here' }
   *
   * // Request echo cancellation, noise suppression
   * audioConstraints: {
   *   echoCancellation: true,
   *   noiseSuppression: true,
   *   autoGainControl: true
   * }
   * ```
   */
  audioConstraints?: MediaTrackConstraints | boolean;

  // ===== Lifecycle & Handlers =====

  /**
   * Automatically connect on mount
   * @default false
   */
  autoConnect?: boolean;

  /**
   * Console verbosity. Defaults to 'warn' (quiet); set 'debug' to trace every event.
   * @default 'warn'
   */
  logLevel?: LogLevel;

  /**
   * How long the control channel may take to open before the attempt fails with an error
   * (and, with `reconnect` enabled, is retried). Guards against sockets that never open and
   * never error. `0` disables the timeout.
   * @default 15000
   */
  connectTimeoutMs?: number;

  /**
   * Automatically reconnect after an unexpected control-channel close (network drop,
   * `1006`, service restart, WebRTC negotiation timeout). `true` uses exponential backoff
   * (500 ms → 8 s, 5 attempts); pass an object to tune it. Off by default.
   *
   * During attempts `connectionState` is `'reconnecting'`; the microphone (WebRTC) and
   * capture (WebSocket) are re-attached automatically; the proactive greeting is **not**
   * re-sent. Standard-mode sessions start fresh (the service keeps no history) — Foundry
   * agents continue the conversation when `connection.conversationId` is set. Use
   * `connection.getToken` so a fresh token is used for each attempt.
   * @default false
   */
  reconnect?: boolean | Partial<ReconnectOptions>;

  /**
   * Event handler for all Voice Live server events (raw wire format).
   * Fired before the hook's own handling, for every event — including events arriving
   * over the WebRTC data channel when `transport: 'webrtc'`.
   */
  onEvent?: (event: VoiceLiveServerEvent) => void;

  /**
   * Transcript callback for receiving user and assistant transcripts.
   * Accumulates delta events automatically - delivers partial updates and final text.
   * User partials require `inputAudioTranscription` to be enabled.
   *
   * @param role - 'user' or 'assistant'
   * @param text - Accumulated transcript text
   * @param isFinal - Whether this is the final transcript for this turn
   */
  onTranscript?: (role: 'user' | 'assistant', text: string, isFinal: boolean) => void;

  /**
   * Tool executor for function calling.
   * Return a value (or a Promise of one) to have the result sent automatically.
   */
  toolExecutor?: ToolExecutor;

  /**
   * Called for non-fatal `warning` events from the service.
   */
  onWarning?: (warning: VoiceLiveWarning) => void;

  /**
   * Called when an MCP tool call requires approval (`requireApproval: 'always'` or per-tool).
   * Respond with `approveMcpCall(request.approvalRequestId, true | false)`.
   */
  onMcpApprovalRequest?: (request: McpApprovalRequest) => void;

  /**
   * Called with the raw (snake_case) session object on every `session.updated`.
   */
  onSessionUpdated?: (session: Record<string, unknown>) => void;

  /** Called before each reconnect attempt (1-based) with the delay that will be waited */
  onReconnecting?: (attempt: number, delayMs: number) => void;

  /** Called once a reconnect attempt produced a ready session */
  onReconnected?: () => void;
}

/**
 * Session activity state - tracks what the session is doing
 */
export type SessionState = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * Connection state of the control channel.
 * `'reconnecting'` is only reached with the `reconnect` option.
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'error';

/**
 * Auto-reconnect policy (see `UseVoiceLiveConfig.reconnect`)
 */
export interface ReconnectOptions {
  /** Maximum consecutive attempts before giving up @default 5 */
  maxAttempts: number;
  /** Delay before the first attempt in ms; doubles per attempt @default 500 */
  initialDelayMs: number;
  /** Upper bound for the delay in ms @default 8000 */
  maxDelayMs: number;
  /** Random jitter as a fraction of the delay (0–1) @default 0.2 */
  jitter: number;
}

/**
 * Return type for useVoiceLive hook
 */
export interface UseVoiceLiveReturn {
  /** Current connection state (`'reconnecting'` only with the `reconnect` option) */
  connectionState: ConnectionState;

  /** Current reconnect attempt (1-based) while `connectionState === 'reconnecting'`, else 0 */
  reconnectAttempt: number;

  /** Current session activity state (idle/listening/thinking/speaking) */
  sessionState: SessionState;

  /** Active transport ('websocket' or 'webrtc') */
  transport: VoiceLiveTransport;

  /** Video stream for avatar */
  videoStream: MediaStream | null;

  /**
   * Assistant audio as a MediaStream. Attach it to an `<audio autoPlay>` element
   * (or the `VoiceLiveAvatar` component). In WebRTC mode this is the remote RTP track.
   */
  audioStream: MediaStream | null;

  /**
   * Session expiry as epoch milliseconds (from `session.created` / `session.updated`
   * `expires_at`), or null when unknown.
   */
  sessionExpiresAt: number | null;

  /** Audio context for visualization and analysis */
  audioContext: AudioContext | null;

  /** Audio analyser node for visualization (pre-configured for frequency analysis) */
  audioAnalyser: AnalyserNode | null;

  /** Whether the session is ready for interaction */
  isReady: boolean;

  /** Whether microphone is currently active */
  isMicActive: boolean;

  /** Whether microphone is muted (capture running but audio not sent) */
  isMuted: boolean;

  /** Error message if any */
  error: string | null;

  /** Connect to Voice Live API */
  connect: () => Promise<void>;

  /** Disconnect from Voice Live API */
  disconnect: () => void;

  /** Start microphone capture (for manual control) */
  startMic: () => Promise<void>;

  /** Stop microphone capture (for manual control) */
  stopMic: () => void;

  /** Toggle microphone mute (instant, keeps capture running) */
  toggleMute: () => void;

  /** Send a raw event to the API (typed client events or any `{ type, ... }` object) */
  sendEvent: (event: VoiceLiveClientEvent | VoiceLiveEvent) => void;

  /** Update session configuration (agent-mode aware) */
  updateSession: (config: Partial<VoiceLiveSessionConfig>) => void;

  /**
   * Send a user text message (`conversation.item.create` with `input_text`) and,
   * by default, trigger a response.
   */
  sendText: (text: string, options?: { triggerResponse?: boolean }) => void;

  /**
   * Send a function-call result (`function_call_output`) for `callId` and, by default,
   * trigger a response. Objects are JSON-stringified.
   */
  sendToolResult: (
    callId: string,
    output: ToolResult,
    options?: { triggerResponse?: boolean }
  ) => void;

  /** Cancel the in-progress response (`response.cancel`) and flush local playback */
  cancelResponse: () => void;

  /** Clear the server-side input audio buffer (`input_audio_buffer.clear`) */
  clearInputAudio: () => void;

  /**
   * Commit the input audio buffer as a user turn (`input_audio_buffer.commit`).
   * Only needed with manual turn detection (`turnDetection: null`).
   */
  commitInputAudio: () => void;

  /**
   * Ask the model to respond now (manual turn control, or after a tool result you sent yourself).
   * Serialized with every other turn, so it can never overlap a running response.
   */
  createResponse: () => void;

  /** Approve or deny a pending MCP tool call (`mcp_approval_response`) */
  approveMcpCall: (approvalRequestId: string, approve: boolean) => void;

  /**
   * Get current audio playback time in milliseconds (for viseme synchronization).
   * Returns null before playback starts and always null on the WebRTC transport.
   */
  getAudioPlaybackTime: () => number | null;
}
