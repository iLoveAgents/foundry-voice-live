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

// ==================== Utilities ====================
export {
  createChromaKeyProcessor,
  DEFAULT_GREEN_SCREEN,
  type ChromaKeyProcessor,
} from './utils/chromaKey';

export {
  buildSessionConfig,
  validateConfig,
  DEFAULT_SESSION_CONFIG,
} from './utils/sessionBuilder';

export {
  arrayBufferToBase64,
  createAudioDataCallback,
} from './utils/audioHelpers';

export {
  // Voice helpers
  withVoice,
  withHDVoice,
  withCustomVoice,
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
  // Function calling helpers
  withTools,
  withToolChoice,
  // Composition helpers
  compose,
  sessionConfig,
  SessionConfigBuilder,
} from './utils/configHelpers';

// ==================== Configuration ====================
export {
  createVoiceLiveConfig,
} from './presets';

// ==================== Types ====================
export type {
  // Event types
  VoiceLiveEvent,
  VoiceLiveSession,
  AvatarConfig,
  IceServerConfig,

  // Configuration types
  VoiceLiveConfig,
  AudioCaptureConfig,
  ChromaKeyConfig,

  // Hook return types
  AudioCaptureReturn,
  VoiceLiveReturn,
  ConnectionState,

  // Component props
  VoiceLiveAvatarProps,

  // Event handlers
  VoiceLiveEventHandler,
  ToolExecutor,
  ModalController,
  AudioDataCallback,

  // Utility types
  LogLevel,
  LoggerConfig,
} from './types';
