/**
 * Microsoft Foundry Voice Live API - TypeScript Type Definitions
 *
 * Comprehensive type definitions for the Voice Live API React library.
 * These types are designed to be portable and framework-agnostic where possible.
 */

// ==================== Export Comprehensive Voice Live Types ====================

// Export all comprehensive types from voiceLive.ts
export * from './voiceLive';

// ==================== Legacy Types (for backward compatibility) ====================

// ==================== Voice Live API Events ====================

/**
 * Base event structure for all Voice Live API events
 */
export interface VoiceLiveEvent {
  type: string;
  event_id?: string;
  [key: string]: any;
}

/**
 * Session configuration for Voice Live API
 */
export interface VoiceLiveSession {
  modalities?: string[];
  instructions?: string;
  voice?: {
    name: string;
  };
  turn_detection?: {
    type: string;
  };
  input_audio_format?: string;
  output_audio_format?: string;
  tools?: any[];
  avatar?: AvatarConfig;
}

/**
 * Avatar configuration for the Voice Live API session
 */
export interface AvatarConfig {
  character: string;
  style: string;
  customized?: boolean;
  video?: {
    codec: string;
    resolution: {
      width: number;
      height: number;
    };
    bitrate: number;
    background?: {
      color: string;
    };
  };
}

/**
 * ICE server configuration from Voice Live API
 */
export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

// ==================== Hook Configuration Types ====================

/**
 * Configuration for Microsoft Foundry Voice Live API connection
 */
export interface VoiceLiveConfig {
  /** Azure AI Foundry resource name (without protocol or domain) */
  resourceName: string;
  /** Azure Speech/AI Services API key */
  apiKey: string;
  /** Avatar character (e.g., "lisa", "john") */
  avatarCharacter: string;
  /** Avatar style/pose (e.g., "casual-standing", "technical-sitting") */
  avatarStyle: string;
  /** System instructions for the AI assistant */
  systemInstructions?: string;
  /** Voice name for TTS (e.g., "en-US-Ava:DragonHDLatestNeural") */
  voiceName?: string;
  /** Tool definitions for function calling */
  tools?: any[];
  /** Custom session configuration overrides */
  sessionConfig?: Partial<VoiceLiveSession>;
}

/**
 * Configuration for audio capture
 */
export interface AudioCaptureConfig {
  /** Sample rate for audio processing (default: 24000) */
  sampleRate?: number;
  /**
   * Optional path to custom AudioWorklet processor script.
   * If not provided, uses inline processor (zero config).
   * Advanced: Provide custom path for specialized audio processing.
   */
  workletPath?: string;
  /** Audio constraints for getUserMedia */
  audioConstraints?: MediaTrackConstraints;
  /** Callback for receiving processed audio data */
  onAudioData?: AudioDataCallback;
  /** Whether to automatically start capture */
  autoStart?: boolean;
}

// ==================== Hook Return Types ====================

/**
 * Connection states for Voice Live API
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Return type for useAudioCapture hook
 */
export interface AudioCaptureReturn {
  /** Current audio stream from microphone */
  stream: MediaStream | null;
  /** Audio context instance */
  audioContext: AudioContext | null;
  /** Whether audio capture is active */
  isCapturing: boolean;
  /** Error message if capture failed */
  error: string | null;
  /** Start audio capture */
  startCapture: () => Promise<void>;
  /** Stop audio capture */
  stopCapture: () => void;
  /** Pause audio capture (suspend context) */
  pauseCapture: () => void;
  /** Resume audio capture */
  resumeCapture: () => void;
}

/**
 * Return type for useVoiceLive hook
 */
export interface VoiceLiveReturn {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Video stream from avatar (WebRTC) */
  videoStream: MediaStream | null;
  /** Audio stream from avatar (WebRTC) */
  audioStream: MediaStream | null;
  /** Whether the session is ready for interaction */
  isReady: boolean;
  /** Error message if connection failed */
  error: string | null;
  /** Connect to Voice Live API */
  connect: () => Promise<void>;
  /** Disconnect from Voice Live API */
  disconnect: () => void;
  /** Send an event to the Voice Live API */
  sendEvent: (event: VoiceLiveEvent) => void;
  /** Update session configuration */
  updateSession: (config: Partial<VoiceLiveSession>) => void;
}

// ==================== Component Props ====================

/**
 * Props for VoiceLiveAvatar component
 */
export interface VoiceLiveAvatarProps {
  /** Video stream from the avatar */
  videoStream: MediaStream | null;
  /** Audio stream from the avatar */
  audioStream: MediaStream | null;
  /** Whether the avatar is loading/connecting */
  loading?: boolean;
  /** Loading message to display */
  loadingMessage?: string;
  /** Whether to show control buttons */
  showControls?: boolean;
  /** Custom control buttons */
  controls?: React.ReactNode;
  /** CSS class name for the container */
  className?: string;
  /** CSS class name for the canvas element */
  canvasClassName?: string;
  /** Inline styles for the container */
  style?: React.CSSProperties;
  /** Whether to enable transparent background (removes green screen via chroma key). Default: true */
  transparentBackground?: boolean;
  /** Optional chroma key configuration for customizing background removal (color, threshold, etc.) */
  chromaKeyConfig?: ChromaKeyConfig;
  /** Callback when video metadata is loaded */
  onVideoReady?: () => void;
  /** Callback when audio is ready */
  onAudioReady?: () => void;
}

/**
 * Chroma Key Configuration
 */
export interface ChromaKeyConfig {
  /** Key color to remove (RGB 0-1) */
  keyColor: [number, number, number];
  /** Color similarity threshold (0-1) */
  similarity: number;
  /** Edge smoothness for blending (0-1) */
  smoothness: number;
}

// ==================== Event Handlers ====================

/**
 * Event handler for Voice Live API events
 */
export type VoiceLiveEventHandler = (event: VoiceLiveEvent) => void;

/**
 * Tool execution function type
 */
export type ToolExecutor = (
  toolName: string,
  args: string,
  callId: string
) => void | Promise<void>;

/**
 * Modal controller interface for tool interactions
 */
export interface ModalController {
  showModal: (
    title: string,
    content: string,
    contentType?: 'text' | 'markdown' | 'mermaid',
    size?: 'small' | 'medium' | 'large' | 'full'
  ) => void;
  closeModal: () => void;
}

// ==================== Utility Types ====================

/**
 * Audio data callback for audio capture
 */
export type AudioDataCallback = (audioData: ArrayBuffer) => void;

/**
 * Logging levels for the library
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level?: LogLevel;
  prefix?: string;
  enableTimestamps?: boolean;
}
