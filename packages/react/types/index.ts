/**
 * Microsoft Foundry Voice Live API - TypeScript Type Definitions
 *
 * Comprehensive type definitions for the Voice Live API React library.
 * Protocol/session types live in `voiceLive.ts`, wire-format events in `events.ts`;
 * this file adds the audio-capture and component prop types.
 */

// ==================== Voice Live protocol & session types ====================

export * from './voiceLive';
export * from './events';

// ==================== Audio capture ====================

/**
 * Audio data callback for audio capture (raw PCM16 buffer)
 */
export type AudioDataCallback = (audioData: ArrayBuffer) => void;

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
  /** Whether audio is muted (capture running but data not forwarded) */
  isMuted: boolean;
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
  /** Toggle mute (instant, keeps worklet running) */
  toggleMute: () => void;
}

// ==================== Connection ====================

// ==================== Component Props ====================

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
