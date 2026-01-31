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
 * All events from the API follow this pattern
 */
export interface VoiceLiveEvent {
  type: string;
  event_id?: string;
  [key: string]: any; // Additional event-specific properties
}

// ============================================================================
// MODEL & CONNECTION
// ============================================================================

/**
 * Known Voice Live models with their pricing tiers
 */
export type KnownVoiceLiveModel =
  // Pro tier - Best quality
  | 'gpt-realtime'        // Native audio, best quality
  | 'gpt-4o'              // Azure STT/TTS
  | 'gpt-4.1'             // Azure STT/TTS
  | 'gpt-5'               // Azure STT/TTS
  | 'gpt-5-chat'          // Azure STT/TTS
  // Basic tier
  | 'gpt-realtime-mini'   // Native audio
  | 'gpt-4o-mini'         // Azure STT/TTS
  | 'gpt-4.1-mini'        // Azure STT/TTS
  | 'gpt-5-mini'          // Azure STT/TTS
  // Lite tier
  | 'gpt-5-nano'          // Azure STT/TTS
  | 'phi4-mm-realtime'    // Native audio
  | 'phi4-mini';          // Azure STT/TTS

/**
 * Voice Live model - extensible to support future models
 * Use any string, but known models provide better type hints
 */
export type VoiceLiveModel = KnownVoiceLiveModel | (string & {});

/**
 * Connection configuration for Voice Live API
 */
export interface VoiceLiveConnectionConfig {
  /** Azure AI Foundry resource name */
  resourceName?: string;

  /** API key authentication (or use token for Microsoft Entra) */
  apiKey?: string;

  /** Microsoft Entra authentication token (recommended) */
  token?: string;

  /**
   * Model to use
   * @default 'gpt-realtime'
   */
  model?: VoiceLiveModel;

  /**
   * API version
   * @default '2025-10-01'
   */
  apiVersion?: string;

  // ===== Agent Service Mode (mutually exclusive with model) =====

  /** Agent ID for Azure AI Agent Service */
  agentId?: string;

  /** Project name for Azure AI Agent Service (recommended) */
  projectName?: string;

  /** Project ID for Azure AI Agent Service (deprecated - use projectName) */
  projectId?: string;

  /** Agent access token for Azure AI Agent Service (required for Agent mode) */
  agentAccessToken?: string;

  // ===== Proxy Mode =====

  /**
   * Proxy WebSocket URL (for secure backend proxy)
   * When set, overrides all other connection parameters
   *
   * Supports @iloveagents/foundry-voice-live-proxy-node or custom proxy servers.
   * Mode is automatically detected by the proxy based on URL parameters.
   *
   * Standard mode: 'ws://localhost:8080/ws?model=gpt-realtime'
   * Standard with MSAL: 'ws://localhost:8080/ws?model=gpt-realtime&token=${msalToken}'
   * Agent mode (auto-detected): 'ws://localhost:8080/ws?agentId=xxx&projectName=yyy&token=${msalToken}'
   *
   * @see {@link https://github.com/iLoveAgents/foundry-voice-live-proxy}
   */
  proxyUrl?: string;
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
}

/**
 * Noise reduction type
 */
export type NoiseReductionType =
  | 'azure_deep_noise_suppression'  // Voice Live: Optimized for close microphones
  | 'near_field'                     // Azure OpenAI: Close-talking microphones
  | 'far_field';                     // Azure OpenAI: Far-field microphones

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
  | 'gpt-4o-transcribe-diarize';

/**
 * Input audio transcription configuration
 * Used with non-multimodal models (gpt-4o, gpt-4.1, gpt-5, etc.)
 */
export interface InputAudioTranscription {
  /**
   * Transcription model
   * Use 'azure-speech' for Voice Live or standard models for Azure OpenAI
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
}

// ============================================================================
// TURN DETECTION
// ============================================================================

/**
 * Turn detection type
 */
export type TurnDetectionType =
  | 'server_vad'                      // Volume-based (Azure OpenAI default)
  | 'semantic_vad'                    // Semantic (gpt-realtime/mini only)
  | 'azure_semantic_vad'              // Voice Live: Azure semantic (all models)
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
  | 'semantic_detection_v1'              // English only
  | 'semantic_detection_v1_multilingual'; // Multi-language support

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
   * Auto-truncate on interruption
   * @default false
   */
  autoTruncate?: boolean;

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
 * Azure OpenAI standard voices
 */
export type StandardVoice =
  | 'alloy' | 'ash' | 'ballad' | 'coral'
  | 'echo' | 'sage' | 'shimmer' | 'verse';

/**
 * Voice type (Voice Live)
 */
export type VoiceType = 'azure-standard' | 'azure-custom';

/**
 * Voice configuration
 * Supports Azure OpenAI standard voices and Voice Live Azure voices
 */
export interface VoiceConfig {
  /**
   * Voice name
   * - Azure OpenAI: 'alloy', 'echo', etc.
   * - Voice Live standard: 'en-US-AvaNeural'
   * - Voice Live HD: 'en-US-Ava:DragonHDLatestNeural'
   * - Voice Live custom: Your custom voice name
   */
  name: string | StandardVoice;

  /**
   * Voice type (Voice Live only)
   * Required when using Azure voices
   */
  type?: VoiceType;

  /**
   * Temperature for HD voices (0.0-1.0)
   * Higher values = more variability in intonation, prosody
   * @default 0.8
   */
  temperature?: number;

  /**
   * Speaking rate ('0.5' to '1.5')
   * @default '1.0'
   */
  rate?: string;
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
 * Tool definition (currently only functions supported)
 */
export type Tool = FunctionTool;

/**
 * Tool choice strategy
 */
export type ToolChoice =
  | 'auto'      // Let model decide
  | 'none'      // Don't call functions
  | 'required'  // Must call a function
  | {           // Specific function
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

  /** Avatar configuration */
  avatar?: AvatarConfig;
}

// ============================================================================
// RESPONSE.CREATE OPTIONS
// ============================================================================

/**
 * Conversation control mode
 */
export type ConversationMode = 'auto' | 'none';

/**
 * Content part for conversation items
 */
export interface ContentPart {
  type: 'input_text' | 'input_audio' | 'item_reference';
  text?: string;
  audio?: string;      // Base64
  transcript?: string;
  id?: string;         // For item_reference
}

/**
 * Conversation item for response.create
 */
export interface ConversationItem {
  type: 'message' | 'function_call' | 'function_call_output';
  id?: string;
  role?: 'system' | 'user' | 'assistant';
  content?: ContentPart[];
  callId?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

/**
 * Options for response.create event
 * Can override session configuration per response
 */
export interface ResponseCreateOptions {
  // Override session settings
  modalities?: Modality[];
  instructions?: string;
  voice?: string | StandardVoice | VoiceConfig;
  outputAudioFormat?: AudioFormat;
  tools?: Tool[];
  toolChoice?: ToolChoice;
  temperature?: number;
  maxResponseOutputTokens?: number | 'inf';

  // Response-specific settings
  /**
   * Conversation control
   * @default 'auto'
   */
  conversation?: ConversationMode;

  /**
   * Metadata (max 16 key-value pairs, max 64 char keys, 512 char values)
   */
  metadata?: Record<string, string>;

  /**
   * Input items to create new context
   * Without including default conversation
   */
  input?: ConversationItem[];
}

// ============================================================================
// HOOK CONFIGURATION
// ============================================================================

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
   * Event handler for all Voice Live events
   */
  onEvent?: (event: any) => void;

  /**
   * Tool executor for function calling
   */
  toolExecutor?: (name: string, args: string, callId: string) => void;
}

/**
 * Return type for useVoiceLive hook
 */
export interface UseVoiceLiveReturn {
  /** Current connection state */
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';

  /** Video stream for avatar */
  videoStream: MediaStream | null;

  /** Audio stream for avatar */
  audioStream: MediaStream | null;

  /** Audio context for visualization and analysis */
  audioContext: AudioContext | null;

  /** Audio analyser node for visualization (pre-configured for frequency analysis) */
  audioAnalyser: AnalyserNode | null;

  /** Whether the session is ready for interaction */
  isReady: boolean;

  /** Whether microphone is currently active */
  isMicActive: boolean;

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

  /** Send an event to the API */
  sendEvent: (event: any) => void;

  /** Update session configuration */
  updateSession: (config: Partial<VoiceLiveSessionConfig>) => void;

  /** Get current audio playback time in milliseconds (for viseme synchronization) */
  getAudioPlaybackTime: () => number | null;
}

// ============================================================================
// AGENT SERVICE CONFIGURATION
// ============================================================================

/**
 * Configuration for Azure AI Agent Service mode
 */
export interface AgentServiceConfig {
  /** Azure AI Foundry resource name */
  resourceName: string;

  /** Agent ID */
  agentId: string;

  /** Project ID */
  projectId: string;

  /** API key or token authentication */
  apiKey?: string;
  token?: string;

  /**
   * API version
   * @default '2025-10-01'
   */
  apiVersion?: string;

  // Session configuration (instructions NOT supported in agent mode)
  session?: Omit<VoiceLiveSessionConfig, 'instructions'>;

  // Lifecycle & handlers
  autoConnect?: boolean;
  onEvent?: (event: any) => void;
  toolExecutor?: (name: string, args: string, callId: string) => void;
}
