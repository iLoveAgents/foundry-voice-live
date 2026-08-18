/**
 * Microsoft Foundry Voice Live API - React Library
 *
 * A comprehensive React library for integrating Microsoft Foundry Voice Live API with avatar support.
 * Designed to be portable and reusable across projects.
 *
 * @packageDocumentation
 */

// ==================== Hooks ====================
export { useAudioCapture } from './hooks/useAudioCapture';
export { useVoiceLive } from './hooks/useVoiceLive';

// ==================== Components ====================
export { VoiceLiveAvatar } from './components/VoiceLiveAvatar';

// ==================== Constants ====================
export {
  DEFAULT_API_VERSION,
  DEFAULT_WEBRTC_API_VERSION,
  MIN_WEBRTC_API_VERSION,
  DEFAULT_MODEL,
  VOICE_LIVE_DATA_CHANNEL,
} from './utils/constants';
export { OPENAI_VOICES, AZURE_REALTIME_NATIVE_VOICES } from './types/voiceLive';
export {
  SERVER_EVENT_TYPES,
  CLIENT_EVENT_TYPES,
  TYPED_SERVER_EVENT_TYPES,
  OTHER_SERVER_EVENT_TYPES,
} from './types/events';

// ==================== Utilities ====================
export {
  createChromaKeyProcessor,
  DEFAULT_GREEN_SCREEN,
  type ChromaKeyProcessor,
} from './utils/chromaKey';

export {
  buildSessionConfig,
  buildAgentSessionConfig,
  convertToSessionUpdate,
  validateConfig,
  DEFAULT_SESSION_CONFIG,
  AGENT_OWNED_FIELDS,
} from './utils/sessionBuilder';

export {
  arrayBufferToBase64,
  createAudioDataCallback,
  buildMicConstraints,
} from './utils/audioHelpers';

export { buildGreetingEvents } from './utils/greeting';

export {
  buildVoiceLiveUrl,
  resolveConnectionMode,
  validateTransport,
  redactUrl,
  type ConnectionMode,
  type ResolvedConnection,
} from './utils/connectionUrl';

export { createLogger, type Logger } from './utils/logger';

export {
  // Voice helpers
  withVoice,
  withHDVoice,
  withCustomVoice,
  withPersonalVoice,
  withAzureRealtimeVoice,
  // Avatar helpers
  withAvatar,
  withTransparentBackground,
  withBackgroundImage,
  withAvatarCrop,
  // Turn detection helpers
  withSemanticVAD,
  withEndOfUtterance,
  withoutTurnDetection,
  // Audio enhancement helpers
  withEchoCancellation,
  withoutEchoCancellation,
  withDeepNoiseReduction,
  withNearFieldNoiseReduction,
  withoutNoiseReduction,
  withSampleRate,
  // Output helpers
  withViseme,
  withWordTimestamps,
  // Transcription helpers
  withTranscription,
  withoutTranscription,
  // Tools helpers
  withTools,
  withToolChoice,
  withMcpServer,
  withFoundryAgentTool,
  withParallelToolCalls,
  // Model behaviour helpers
  withReasoningEffort,
  withMetadata,
  // Conversation helpers
  withInterimResponse,
  withGreeting,
  // Composition helpers
  compose,
  sessionConfig,
  SessionConfigBuilder,
} from './utils/configHelpers';

// ==================== Core building blocks (advanced) ====================
// Framework-agnostic pieces the hook is built from. Useful for custom integrations
// (non-React apps, custom audio pipelines); the hook remains the supported entry point.
export {
  WebSocketTransport,
  type WebSocketTransportOptions,
} from './core/transports/websocketTransport';
export {
  WebRtcTransport,
  type WebRtcTransportOptions,
  DEFAULT_DATA_CHANNEL_FALLBACK_MS,
  RTC_NEGOTIATION_TIMEOUT_CLOSE_CODE,
} from './core/transports/webrtcTransport';
export type {
  VoiceLiveTransport as VoiceLiveTransportInstance,
  TransportCallbacks,
  TransportCloseInfo,
  TransportConnectOptions,
  TransportKind,
  TransportState,
} from './core/transports/types';
export { OutputAudioGraph, PcmPlayer, type OutputAudioGraphOptions, type PcmPlayerOptions } from './core/audioOutput';
export { AvatarConnection, encodeAvatarSdp, decodeAvatarSdp, type AvatarConnectionCallbacks } from './core/avatarConnection';
export { WebRtcMicrophone } from './core/microphone';
export {
  resolveReconnectOptions,
  computeBackoffDelay,
  isReconnectableClose,
  DEFAULT_RECONNECT_OPTIONS,
} from './core/reconnect';
export { parseServerEvent, SeenEventIds } from './core/serverEvents';

// ==================== Configuration ====================
export {
  createVoiceLiveConfig,
} from './presets';

// ==================== Types ====================
export type {
  // Base event type + typed protocol events
  VoiceLiveEvent,
  VoiceLiveServerEvent,
  VoiceLiveClientEvent,
  ServerEventType,
  ClientEventType,
  ServerEventOf,
  VoiceLiveErrorDetails,
  VoiceLiveWarningDetails,
  WireContentPart,
  WireConversationItem,
  WireConversationRequestItem,
  WireMessageRequestItem,
  WireFunctionCallRequestItem,
  WireFunctionCallOutputRequestItem,
  WireMcpApprovalResponseRequestItem,
  WireResponse,
  WireResponseCreateOptions,
  WireSession,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  ConversationItemCreatedEvent,
  ConversationItemTruncatedEvent,
  InputAudioTranscriptionDeltaEvent,
  InputAudioTranscriptionCompletedEvent,
  InputAudioBufferSpeechStartedEvent,
  InputAudioBufferSpeechStoppedEvent,
  ResponseCreatedEvent,
  ResponseDoneEvent,
  ResponseTextDeltaEvent,
  ResponseAudioDeltaEvent,
  ResponseAudioTranscriptDeltaEvent,
  ResponseFunctionCallArgumentsDoneEvent,
  ResponseAnimationVisemeDeltaEvent,
  ResponseAudioTimestampDeltaEvent,
  ServerErrorEvent,
  ServerWarningEvent,
  RtcCallSdpCreatedEvent,
  RtcCallErrorEvent,
  RtcCallSdpCreateClientEvent,

  // Connection & transport
  VoiceLiveConnectionConfig,
  VoiceLiveTransport,
  KnownVoiceLiveModel,
  VoiceLiveModel,
  ConnectionState,

  // Session configuration types
  VoiceLiveSessionConfig,
  Modality,
  AudioFormat,
  InputAudioSamplingRate,
  InputAudioEchoCancellation,
  InputAudioNoiseReduction,
  NoiseReductionType,
  InputAudioTranscription,
  TranscriptionModel,
  CustomSpeechConfig,
  TurnDetectionConfig,
  TurnDetectionType,
  Eagerness,
  EndOfUtteranceDetection,
  EndOfUtteranceModel,
  EndOfUtteranceThreshold,
  VoiceConfig,
  VoiceType,
  StandardVoice,
  AzureRealtimeNativeVoiceName,
  PersonalVoiceModel,
  TimestampType,
  AnimationOutput,
  AnimationConfig,
  AvatarConfig,
  AvatarVideoConfig,
  AvatarBackground,
  AvatarCrop,
  AvatarCodec,
  Tool,
  FunctionTool,
  MCPTool,
  McpRequireApproval,
  FoundryAgentTool,
  FoundryAgentContextType,
  ToolChoice,
  ReasoningEffort,
  GreetingConfig,
  InterimResponseConfig,
  InterimResponseTrigger,

  // Hook configuration and return types
  UseVoiceLiveConfig,
  UseVoiceLiveReturn,
  SessionState,
  ReconnectOptions,
  LogLevel,
  ToolExecutor,
  ToolResult,
  VoiceLiveWarning,
  McpApprovalRequest,

  // Audio capture
  AudioCaptureConfig,
  AudioCaptureReturn,
  AudioDataCallback,

  // Component props
  VoiceLiveAvatarProps,
  ChromaKeyConfig,
} from './types';
