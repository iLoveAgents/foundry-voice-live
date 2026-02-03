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
  Tool,
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
 * Use `multilingual: true` to enable automatic detection of 10 languages:
 * English, Spanish, French, Italian, German, Japanese, Portuguese, Chinese, Korean, Hindi
 *
 * @param options - Semantic VAD options
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * // English-only VAD (default)
 * const config = withSemanticVAD();
 *
 * // Multilingual VAD (auto-detects 10 languages)
 * const config = withSemanticVAD({ multilingual: true });
 *
 * // With filler word removal
 * const config = withSemanticVAD({
 *   multilingual: true,
 *   removeFillerWords: true,
 *   fillerWordLanguages: ['en', 'es'],  // improves filler detection accuracy
 * });
 *
 * // With custom threshold and interruption
 * const config = withSemanticVAD({
 *   threshold: 0.5,
 *   interruptResponse: true,
 * }, baseConfig);
 * ```
 */
export function withSemanticVAD(
  options: {
    /**
     * Enable multilingual VAD (auto-detects 10 languages)
     * Supported: English, Spanish, French, Italian, German, Japanese, Portuguese, Chinese, Korean, Hindi
     * @default false (English-only)
     */
    multilingual?: boolean;
    /** Activation threshold (0.0-1.0). Higher = requires higher confidence of speech @default 0.5 */
    threshold?: number;
    /** Audio to include before speech detection (ms) @default 300 */
    prefixPaddingMs?: number;
    /** Minimum speech duration to start detection (ms) @default 80 */
    speechDurationMs?: number;
    /** Silence duration to detect end of speech (ms) @default 500 */
    silenceDurationMs?: number;
    /**
     * Remove filler words ("umm", "ah", etc.) to reduce false barge-in
     * @default false
     */
    removeFillerWords?: boolean;
    /**
     * Languages for filler word detection accuracy (only used when removeFillerWords=true)
     * Supported: en, es, fr, it, de, ja, pt, zh, ko, hi
     */
    fillerWordLanguages?: string[];
    /**
     * Enable barge-in interruption
     * @default false
     */
    interruptResponse?: boolean;
    /**
     * Auto-truncate on interruption
     * @default false
     */
    autoTruncate?: boolean;
  } = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  const type = options.multilingual
    ? 'azure_semantic_vad_multilingual'
    : 'azure_semantic_vad';

  return {
    ...config,
    turnDetection: {
      type,
      threshold: options.threshold ?? 0.5,
      prefixPaddingMs: options.prefixPaddingMs ?? 300,
      speechDurationMs: options.speechDurationMs ?? 80,
      silenceDurationMs: options.silenceDurationMs ?? 500,
      removeFillerWords: options.removeFillerWords,
      languages: options.fillerWordLanguages,
      interruptResponse: options.interruptResponse,
      createResponse: true,
      autoTruncate: options.autoTruncate,
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
 * // Basic transcription
 * const config = withTranscription({
 *   model: 'whisper-1',
 *   language: 'en'
 * }, baseConfig);
 *
 * // With phrase list (Voice Live, azure-speech only)
 * const config = withTranscription({
 *   model: 'azure-speech',
 *   language: 'en',
 *   phraseList: ['Neo QLED TV', 'TUF Gaming', 'AutoQuote Explorer']
 * }, baseConfig);
 *
 * // With custom speech models (Voice Live, azure-speech only)
 * const config = withTranscription({
 *   model: 'azure-speech',
 *   language: 'en',
 *   customSpeech: { 'zh-CN': 'your-custom-model-id' }
 * }, baseConfig);
 * ```
 */
export function withTranscription(
  options: {
    model?: 'azure-speech' | 'whisper-1' | 'gpt-4o-transcribe' | 'gpt-4o-mini-transcribe';
    language?: string;
    prompt?: string;
    /** Phrase list for recognition improvement (Voice Live, azure-speech only) */
    phraseList?: string[];
    /** Custom speech models per locale (Voice Live, azure-speech only) */
    customSpeech?: Record<string, string>;
  } = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioTranscription: {
      model: options.model || 'whisper-1',
      language: options.language,
      prompt: options.prompt,
      phraseList: options.phraseList,
      customSpeech: options.customSpeech,
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
  tools: Tool[],
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

// ============================================================================
// SESSION CONFIG BUILDER
// ============================================================================

/**
 * Fluent builder for Voice Live session configuration
 *
 * Provides a clean, chainable API for building complex configurations.
 * The builder is directly usable as a config object (no .build() required).
 *
 * @example
 * ```tsx
 * const config = sessionConfig()
 *   .instructions('You are a helpful assistant.')
 *   .voice('en-US-AvaMultilingualNeural')
 *   .avatar('lisa', 'casual-sitting')
 *   .semanticVAD({ multilingual: true })
 *   .echoCancellation()
 *   .noiseReduction();
 *
 * useVoiceLive({
 *   connection: { resourceName: 'my-resource', apiKey: 'key' },
 *   session: config,  // works directly, no .build() needed
 * });
 * ```
 */
export class SessionConfigBuilder {
  private config: Partial<VoiceLiveSessionConfig> = {};

  /** Set system instructions */
  instructions(text: string): this {
    this.config.instructions = text;
    return this;
  }

  /** Set voice by name or full config */
  voice(voice: string | VoiceConfig): this {
    this.config = withVoice(voice, this.config);
    return this;
  }

  /** Set HD voice with options */
  hdVoice(
    name: string,
    options: { temperature?: number; rate?: string } = {}
  ): this {
    this.config = withHDVoice(name, options, this.config);
    return this;
  }

  /** Set custom voice */
  customVoice(name: string): this {
    this.config = withCustomVoice(name, this.config);
    return this;
  }

  /** Configure avatar */
  avatar(
    character: string,
    style: string,
    options: {
      customized?: boolean;
      resolution?: { width: number; height: number };
      bitrate?: number;
      codec?: 'h264' | 'vp8' | 'vp9';
    } = {}
  ): this {
    this.config = withAvatar(character, style, options, this.config);
    return this;
  }

  /** Enable transparent background for avatar */
  transparentBackground(options: { keyColor?: string } = {}): this {
    this.config = withTransparentBackground(this.config, options);
    return this;
  }

  /** Set avatar background image */
  backgroundImage(imageUrl: string): this {
    this.config = withBackgroundImage(imageUrl, this.config);
    return this;
  }

  /** Set avatar crop */
  avatarCrop(crop: {
    topLeft: [number, number];
    bottomRight: [number, number];
  }): this {
    this.config = withAvatarCrop(crop, this.config);
    return this;
  }

  /**
   * Configure semantic VAD
   * @param options.multilingual Enable multilingual detection (10 languages)
   */
  semanticVAD(
    options: {
      multilingual?: boolean;
      threshold?: number;
      prefixPaddingMs?: number;
      speechDurationMs?: number;
      silenceDurationMs?: number;
      removeFillerWords?: boolean;
      fillerWordLanguages?: string[];
      interruptResponse?: boolean;
      autoTruncate?: boolean;
    } = {}
  ): this {
    this.config = withSemanticVAD(options, this.config);
    return this;
  }

  /** Add end-of-utterance detection */
  endOfUtterance(
    options: {
      model?: string;
      thresholdLevel?: 'default' | 'low' | 'medium' | 'high';
      timeoutMs?: number;
    } = {}
  ): this {
    this.config = withEndOfUtterance(options, this.config);
    return this;
  }

  /** Disable turn detection (manual mode) */
  noTurnDetection(): this {
    this.config = withoutTurnDetection(this.config);
    return this;
  }

  /** Enable server echo cancellation */
  echoCancellation(): this {
    this.config = withEchoCancellation(this.config);
    return this;
  }

  /** Enable deep noise reduction */
  noiseReduction(type: 'deep' | 'nearField' = 'deep'): this {
    this.config =
      type === 'deep'
        ? withDeepNoiseReduction(this.config)
        : withNearFieldNoiseReduction(this.config);
    return this;
  }

  /** Set input audio sample rate */
  sampleRate(rate: 16000 | 24000): this {
    this.config = withSampleRate(rate, this.config);
    return this;
  }

  /** Enable viseme output (for lip-sync) */
  viseme(): this {
    this.config = withViseme(this.config);
    return this;
  }

  /** Enable word timestamps */
  wordTimestamps(): this {
    this.config = withWordTimestamps(this.config);
    return this;
  }

  /** Configure input transcription */
  transcription(
    options: {
      model?:
        | 'azure-speech'
        | 'whisper-1'
        | 'gpt-4o-transcribe'
        | 'gpt-4o-mini-transcribe';
      language?: string;
      prompt?: string;
      phraseList?: string[];
      customSpeech?: Record<string, string>;
    } = {}
  ): this {
    this.config = withTranscription(options, this.config);
    return this;
  }

  /** Add function tools */
  tools(tools: Tool[]): this {
    this.config = withTools(tools, this.config);
    return this;
  }

  /** Set tool choice mode */
  toolChoice(choice: 'auto' | 'none' | 'required'): this {
    this.config = withToolChoice(choice, this.config);
    return this;
  }

  /** Build the final configuration */
  build(): Partial<VoiceLiveSessionConfig> {
    return { ...this.config };
  }
}

/**
 * Create a new session configuration builder
 *
 * @example
 * ```tsx
 * const config = sessionConfig()
 *   .instructions('You are a helpful assistant.')
 *   .voice('en-US-AvaMultilingualNeural')
 *   .avatar('lisa', 'casual-sitting')
 *   .semanticVAD({ multilingual: true })
 *   .echoCancellation()
 *   .noiseReduction()
 *   .build();
 *
 * const { connect } = useVoiceLive({
 *   connection: { resourceName: 'my-resource', apiKey: 'key' },
 *   session: config,
 * });
 * ```
 */
export function sessionConfig(
  initial: Partial<VoiceLiveSessionConfig> = {}
): SessionConfigBuilder {
  const builder = new SessionConfigBuilder();
  // Apply initial config
  Object.assign(builder['config'], initial);
  return builder;
}
