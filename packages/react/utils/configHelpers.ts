/**
 * Configuration Helper Functions
 *
 * Fluent API helpers for building Voice Live configurations.
 * These functions make it easy to compose complex configurations
 * with a clean, readable syntax.
 *
 * @example
 * ```tsx
 * const config = withVoice('en-US-Ava:DragonHDLatestNeural', {
 *   session: withSemanticVAD(withEchoCancellation(baseConfig))
 * });
 * ```
 */

import type {
  VoiceLiveSessionConfig,
  VoiceConfig,
  StandardVoice,
  TurnDetectionConfig,
} from '../types/voiceLive';

// ============================================================================
// VOICE CONFIGURATION HELPERS
// ============================================================================

/**
 * Add or update voice configuration
 *
 * @param voice - Voice name or full voice configuration
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withVoice('en-US-Ava:DragonHDLatestNeural', baseConfig);
 * ```
 */
export function withVoice(
  voice: string | StandardVoice | VoiceConfig,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    voice,
  };
}

/**
 * Configure an HD voice with temperature and rate
 * HD voices are Azure voices with advanced prosody control.
 * Voice names typically include ':DragonHDLatestNeural'
 *
 * @param voiceName - Azure HD voice name (e.g., 'en-US-Ava:DragonHDLatestNeural')
 * @param options - Voice options (temperature, rate)
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withHDVoice('en-US-Ava:DragonHDLatestNeural', {
 *   temperature: 0.8,
 *   rate: '1.1'
 * }, baseConfig);
 * ```
 */
export function withHDVoice(
  voiceName: string,
  options: {
    temperature?: number;
    rate?: string;
  } = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    voice: {
      name: voiceName,
      type: 'azure-standard', // HD voices use azure-standard type
      temperature: options.temperature,
      rate: options.rate,
    },
  };
}

/**
 * Configure a custom voice
 *
 * @param voiceName - Custom voice name/ID
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withCustomVoice('my-custom-voice-id', baseConfig);
 * ```
 */
export function withCustomVoice(
  voiceName: string,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    voice: {
      name: voiceName,
      type: 'azure-custom',
    },
  };
}

// ============================================================================
// AVATAR CONFIGURATION HELPERS
// ============================================================================

/**
 * Add avatar configuration
 *
 * @param character - Avatar character name
 * @param style - Avatar style/pose
 * @param options - Additional avatar options
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withAvatar('lisa', 'casual-standing', {
 *   resolution: { width: 1920, height: 1080 },
 *   bitrate: 2000000
 * }, baseConfig);
 * ```
 */
export function withAvatar(
  character: string,
  style: string,
  options: {
    customized?: boolean;
    resolution?: { width: number; height: number };
    bitrate?: number;
    codec?: 'h264' | 'vp8' | 'vp9';
  } = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    avatar: {
      character,
      style,
      customized: options.customized,
      video: {
        codec: options.codec || 'vp9',
        resolution: options.resolution || { width: 1920, height: 1080 },
        bitrate: options.bitrate || 1000000,
      },
    },
  };
}

/**
 * Enable transparent background for avatar using chroma key
 *
 * Sets avatar background to a solid color that can be removed client-side
 * for transparent overlay on custom backgrounds.
 *
 * @param config - Session configuration to update
 * @param options - Optional configuration
 * @param options.keyColor - Chroma key color (default: '#00FF00FF' green).
 *                          Change if avatar outfit conflicts with default green.
 * @returns Updated configuration with background color set
 *
 * @example
 * ```tsx
 * // Simple - use default green key
 * const config = withTransparentBackground(baseConfig);
 *
 * // Advanced - custom key color if green conflicts
 * const config = withTransparentBackground(baseConfig, { keyColor: '#0000FFFF' });
 * ```
 */
export function withTransparentBackground(
  config: Partial<VoiceLiveSessionConfig> = {},
  options: { keyColor?: string } = {}
): Partial<VoiceLiveSessionConfig> {
  const keyColor = options.keyColor || '#00FF00FF';

  return {
    ...config,
    avatar: {
      ...config.avatar,
      character: config.avatar?.character || '',
      style: config.avatar?.style || '',
      video: {
        ...config.avatar?.video,
        codec: config.avatar?.video?.codec || 'vp9',
        resolution: config.avatar?.video?.resolution || { width: 1920, height: 1080 },
        bitrate: config.avatar?.video?.bitrate || 1000000,
        background: {
          color: keyColor,
        },
      },
    },
  };
}

/**
 * Add custom background image to avatar
 *
 * @param imageUrl - URL to background image
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withBackgroundImage('https://example.com/bg.jpg', baseConfig);
 * ```
 */
export function withBackgroundImage(
  imageUrl: string,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    avatar: {
      ...config.avatar,
      character: config.avatar?.character || '',
      style: config.avatar?.style || '',
      video: {
        ...config.avatar?.video,
        codec: config.avatar?.video?.codec || 'vp9',
        resolution: config.avatar?.video?.resolution || { width: 1920, height: 1080 },
        bitrate: config.avatar?.video?.bitrate || 1000000,
        background: {
          imageUrl,
        },
      },
    },
  };
}

/**
 * Add avatar video cropping
 *
 * @param crop - Crop coordinates
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withAvatarCrop(
 *   { topLeft: [0.1, 0.1], bottomRight: [0.9, 0.9] },
 *   baseConfig
 * );
 * ```
 */
export function withAvatarCrop(
  crop: {
    topLeft: [number, number];
    bottomRight: [number, number];
  },
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    avatar: {
      ...config.avatar,
      character: config.avatar?.character || '',
      style: config.avatar?.style || '',
      video: {
        ...config.avatar?.video,
        codec: config.avatar?.video?.codec || 'vp9',
        resolution: config.avatar?.video?.resolution || { width: 1920, height: 1080 },
        bitrate: config.avatar?.video?.bitrate || 1000000,
        crop: {
          topLeft: crop.topLeft,
          bottomRight: crop.bottomRight,
        },
      },
    },
  };
}

// ============================================================================
// TURN DETECTION HELPERS
// ============================================================================

/**
 * Configure Azure Semantic VAD turn detection
 *
 * @param options - Semantic VAD options
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withSemanticVAD({
 *   threshold: 0.5,
 *   removeFillerWords: true,
 *   interruptResponse: true
 * }, baseConfig);
 * ```
 */
export function withSemanticVAD(
  options: {
    threshold?: number;
    prefixPaddingMs?: number;
    speechDurationMs?: number;
    silenceDurationMs?: number;
    removeFillerWords?: boolean;
    interruptResponse?: boolean;
    autoTruncate?: boolean;
  } = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    turnDetection: {
      type: 'azure_semantic_vad',
      threshold: options.threshold ?? 0.5,
      prefixPaddingMs: options.prefixPaddingMs ?? 300,
      speechDurationMs: options.speechDurationMs ?? 80,
      silenceDurationMs: options.silenceDurationMs ?? 500,
      removeFillerWords: options.removeFillerWords ?? false,
      interruptResponse: options.interruptResponse ?? true,
      createResponse: true,
      autoTruncate: options.autoTruncate,
    },
  };
}

/**
 * Configure multilingual semantic VAD
 *
 * @param languages - Language codes to support
 * @param options - Additional VAD options
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withMultilingualVAD(
 *   ['en', 'es', 'fr', 'de'],
 *   { threshold: 0.5 },
 *   baseConfig
 * );
 * ```
 */
export function withMultilingualVAD(
  languages: string[],
  options: {
    threshold?: number;
    prefixPaddingMs?: number;
    speechDurationMs?: number;
    silenceDurationMs?: number;
    removeFillerWords?: boolean;
    interruptResponse?: boolean;
  } = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    turnDetection: {
      type: 'azure_semantic_vad_multilingual',
      languages,
      threshold: options.threshold ?? 0.5,
      prefixPaddingMs: options.prefixPaddingMs ?? 300,
      speechDurationMs: options.speechDurationMs ?? 80,
      silenceDurationMs: options.silenceDurationMs ?? 500,
      removeFillerWords: options.removeFillerWords ?? true,
      interruptResponse: options.interruptResponse ?? true,
      createResponse: true,
    },
  };
}

/**
 * Add end-of-utterance detection
 *
 * @param options - End-of-utterance options
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withEndOfUtterance({
 *   thresholdLevel: 'medium',
 *   timeoutMs: 1000
 * }, baseConfig);
 * ```
 */
export function withEndOfUtterance(
  options: {
    model?: string;
    thresholdLevel?: 'default' | 'low' | 'medium' | 'high';
    timeoutMs?: number;
  } = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  const isMultilingual =
    config.turnDetection?.type === 'azure_semantic_vad_multilingual';

  return {
    ...config,
    turnDetection: {
      ...config.turnDetection,
      type: config.turnDetection?.type || 'azure_semantic_vad',
      endOfUtteranceDetection: {
        model: options.model || (isMultilingual ? 'semantic_detection_v1_multilingual' : 'semantic_detection_v1'),
        thresholdLevel: options.thresholdLevel || 'default',
        timeoutMs: options.timeoutMs || 1000,
      },
    } as TurnDetectionConfig,
  };
}

/**
 * Disable turn detection (manual mode)
 *
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withoutTurnDetection(baseConfig);
 * ```
 */
export function withoutTurnDetection(
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    turnDetection: null,
  };
}

// ============================================================================
// AUDIO ENHANCEMENT HELPERS
// ============================================================================

/**
 * Enable echo cancellation
 *
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withEchoCancellation(baseConfig);
 * ```
 */
export function withEchoCancellation(
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioEchoCancellation: {
      type: 'server_echo_cancellation',
    },
  };
}

/**
 * Disable echo cancellation
 *
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withoutEchoCancellation(baseConfig);
 * ```
 */
export function withoutEchoCancellation(
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioEchoCancellation: null,
  };
}

/**
 * Enable Azure deep noise suppression
 *
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withDeepNoiseReduction(baseConfig);
 * ```
 */
export function withDeepNoiseReduction(
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioNoiseReduction: {
      type: 'azure_deep_noise_suppression',
    },
  };
}

/**
 * Enable near-field noise reduction (lighter processing)
 *
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withNearFieldNoiseReduction(baseConfig);
 * ```
 */
export function withNearFieldNoiseReduction(
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioNoiseReduction: {
      type: 'near_field',
    },
  };
}

/**
 * Disable noise reduction
 *
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withoutNoiseReduction(baseConfig);
 * ```
 */
export function withoutNoiseReduction(
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioNoiseReduction: null,
  };
}

/**
 * Set input audio sampling rate
 *
 * @param sampleRate - Sample rate (16000 or 24000)
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withSampleRate(24000, baseConfig);
 * ```
 */
export function withSampleRate(
  sampleRate: 16000 | 24000,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioSamplingRate: sampleRate,
  };
}

// ============================================================================
// OUTPUT CONFIGURATION HELPERS
// ============================================================================

/**
 * Enable viseme (lip-sync) output
 *
 * IMPORTANT: Visemes only work with Azure STANDARD voices.
 * HD voices (with :DragonHDLatestNeural) do NOT support viseme output.
 * Use standard voices like 'en-US-AvaNeural' instead.
 *
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withViseme({
 *   voice: {
 *     name: 'en-US-AvaNeural',  // Standard voice
 *     type: 'azure-standard',
 *   }
 * });
 * ```
 */
export function withViseme(
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    animation: {
      outputs: ['viseme_id'],
    },
  };
}

/**
 * Enable word-level audio timestamps
 *
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withWordTimestamps(baseConfig);
 * ```
 */
export function withWordTimestamps(
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    outputAudioTimestampTypes: ['word'],
  };
}

// ============================================================================
// INPUT TRANSCRIPTION HELPERS
// ============================================================================

/**
 * Enable input audio transcription
 *
 * @param options - Transcription options
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withTranscription({
 *   model: 'whisper-1',
 *   language: 'en'
 * }, baseConfig);
 * ```
 */
export function withTranscription(
  options: {
    model?: 'azure-speech' | 'whisper-1' | 'gpt-4o-transcribe' | 'gpt-4o-mini-transcribe';
    language?: string;
    prompt?: string;
  } = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioTranscription: {
      model: options.model || 'whisper-1',
      language: options.language,
      prompt: options.prompt,
    },
  };
}

/**
 * Disable input audio transcription
 *
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withoutTranscription(baseConfig);
 * ```
 */
export function withoutTranscription(
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioTranscription: null,
  };
}

// ============================================================================
// FUNCTION CALLING HELPERS
// ============================================================================

/**
 * Add function tools
 *
 * @param tools - Tool definitions
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withTools([
 *   { type: 'function', name: 'get_weather', ... }
 * ], baseConfig);
 * ```
 */
export function withTools(
  tools: any[],
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    tools,
    toolChoice: 'auto',
  };
}

/**
 * Set tool choice behavior
 *
 * @param toolChoice - Tool choice mode
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withToolChoice('required', baseConfig);
 * ```
 */
export function withToolChoice(
  toolChoice: 'auto' | 'none' | 'required',
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    toolChoice,
  };
}

// ============================================================================
// COMPOSITION HELPERS
// ============================================================================

/**
 * Compose multiple configuration functions
 *
 * @param fns - Configuration functions to compose
 * @returns Composed configuration function
 *
 * @example
 * ```tsx
 * const enhance = compose(
 *   withEchoCancellation,
 *   withDeepNoiseReduction,
 *   withSemanticVAD()
 * );
 * const config = enhance(baseConfig);
 * ```
 */
export function compose<T>(
  ...fns: Array<(config: T) => T>
): (config: T) => T {
  return (config: T) => fns.reduce((acc, fn) => fn(acc), config);
}
