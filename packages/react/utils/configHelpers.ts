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
  EndOfUtteranceModel,
  Tool,
  MCPTool,
  FoundryAgentTool,
  GreetingConfig,
  InterimResponseConfig,
  InputAudioTranscription,
  AzureRealtimeNativeVoiceName,
  PersonalVoiceModel,
  ReasoningEffort,
} from '../types/voiceLive';

/** Extra voice options accepted by the voice helpers (everything except name/type) */
export type VoiceOptions = Omit<VoiceConfig, 'name' | 'type'>;

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
  options: VoiceOptions = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    voice: {
      ...options,
      name: voiceName,
      type: 'azure-standard', // HD voices use azure-standard type
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
 * // For endpointId, prosody, etc. use withVoice({ name, type: 'azure-custom', endpointId })
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

/**
 * Configure an Azure personal voice
 *
 * @param voiceName - Personal voice name
 * @param model - Underlying neural model (e.g. 'DragonHDOmniLatestNeural')
 * @param options - Additional voice options (temperature, rate, locale, ...)
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withPersonalVoice('my-personal-voice', 'DragonHDOmniLatestNeural');
 * ```
 */
export function withPersonalVoice(
  voiceName: string,
  model: PersonalVoiceModel,
  options: VoiceOptions = {},
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    voice: {
      ...options,
      name: voiceName,
      type: 'azure-personal',
      model,
    },
  };
}

/**
 * Configure an Azure Realtime native voice (model 'azure-realtime' only)
 *
 * @param voiceName - Native voice name ('ava', 'andrew', 'diya', ...)
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * // connection: { model: 'azure-realtime' }
 * const config = withAzureRealtimeVoice('ava');
 * ```
 */
export function withAzureRealtimeVoice(
  voiceName: AzureRealtimeNativeVoiceName,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    voice: {
      name: voiceName,
      type: 'azure-realtime-native',
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
    /**
     * Text appended to the truncated assistant turn (requires autoTruncate),
     * e.g. ' [The user interrupted me.]'
     */
    appendedTextAfterTruncation?: string;
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
      appendedTextAfterTruncation: options.appendedTextAfterTruncation,
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
    /** Detection model; defaults to the text-based semantic model matching the VAD language mode */
    model?: EndOfUtteranceModel;
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
 * Enable server-side echo cancellation
 *
 * @param config - Session configuration to update
 * @param options - Optional Live-Reference AEC settings (`referenceSource: 'client'`,
 *   `channels: 2`) — types/wire only; stereo capture is not implemented by useAudioCapture yet
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withEchoCancellation(baseConfig);
 * ```
 */
export function withEchoCancellation(
  config: Partial<VoiceLiveSessionConfig> = {},
  options: { referenceSource?: 'server' | 'client'; channels?: 1 | 2 } = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    inputAudioEchoCancellation: {
      type: 'server_echo_cancellation',
      ...(options.referenceSource !== undefined && { referenceSource: options.referenceSource }),
      ...(options.channels !== undefined && { channels: options.channels }),
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
    model?: InputAudioTranscription['model'];
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

/**
 * Add a remote MCP server (server-side tool execution with optional approval flow).
 * Appends to existing tools (unlike `withTools`, which replaces them).
 *
 * @param server - MCP server definition (label, URL, allowed tools, approval policy)
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withMcpServer({
 *   serverLabel: 'mslearn',
 *   serverUrl: 'https://learn.microsoft.com/api/mcp',
 *   requireApproval: 'never',
 * }, baseConfig);
 * ```
 */
export function withMcpServer(
  server: Omit<MCPTool, 'type'>,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    tools: [...(config.tools ?? []), { type: 'mcp', ...server }],
    toolChoice: config.toolChoice ?? 'auto',
  };
}

/**
 * Add a Foundry agent as a tool (chat-supervisor pattern).
 * Appends to existing tools.
 *
 * @param agent - Foundry agent tool definition
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withFoundryAgentTool({
 *   agentName: 'customer-service-agent',
 *   projectName: 'my-foundry-project',
 *   description: 'Handles complex customer requests',
 * }, baseConfig);
 * ```
 */
export function withFoundryAgentTool(
  agent: Omit<FoundryAgentTool, 'type'>,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    tools: [...(config.tools ?? []), { type: 'foundry_agent', ...agent }],
    toolChoice: config.toolChoice ?? 'auto',
  };
}

/**
 * Allow or forbid parallel tool calls (default: allowed)
 *
 * @param enabled - false forces sequential tool calls
 * @param config - Session configuration to update
 * @returns Updated configuration
 */
export function withParallelToolCalls(
  enabled: boolean = true,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    parallelToolCalls: enabled,
  };
}

// ============================================================================
// MODEL BEHAVIOUR HELPERS
// ============================================================================

/**
 * Set reasoning effort for reasoning-capable models
 *
 * @param effort - 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
 * @param config - Session configuration to update
 * @returns Updated configuration
 */
export function withReasoningEffort(
  effort: ReasoningEffort,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    reasoningEffort: effort,
  };
}

/**
 * Attach session metadata (up to 16 key/value pairs; surfaced in Foundry logs).
 * Merges with existing metadata.
 *
 * @param metadata - Key/value pairs
 * @param config - Session configuration to update
 * @returns Updated configuration
 */
export function withMetadata(
  metadata: Record<string, string>,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    metadata: { ...config.metadata, ...metadata },
  };
}

// ============================================================================
// CONVERSATION HELPERS
// ============================================================================

/**
 * Configure interim responses (filler messages during tool execution or latency).
 * Supported in agent mode and with cascaded text models + Azure voices.
 *
 * @param interim - Interim response configuration
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withInterimResponse({
 *   type: 'llm_interim_response',
 *   triggers: ['tool', 'latency'],
 *   latencyThresholdInMs: 1500,
 * }, baseConfig);
 * ```
 */
export function withInterimResponse(
  interim: InterimResponseConfig,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    interimResponse: interim,
  };
}

/**
 * Configure a proactive greeting (assistant speaks first)
 *
 * @param greeting - Greeting configuration
 * @param config - Session configuration to update
 * @returns Updated configuration
 *
 * @example
 * ```tsx
 * const config = withGreeting({ type: 'pregenerated', text: 'Hello! How can I help?' }, baseConfig);
 * ```
 */
export function withGreeting(
  greeting: GreetingConfig,
  config: Partial<VoiceLiveSessionConfig> = {}
): Partial<VoiceLiveSessionConfig> {
  return {
    ...config,
    greeting,
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

  /** Set HD voice with options (temperature, rate, pitch, locale, ...) */
  hdVoice(name: string, options: VoiceOptions = {}): this {
    this.config = withHDVoice(name, options, this.config);
    return this;
  }

  /** Set custom voice */
  customVoice(name: string): this {
    this.config = withCustomVoice(name, this.config);
    return this;
  }

  /** Set Azure personal voice */
  personalVoice(name: string, model: PersonalVoiceModel, options: VoiceOptions = {}): this {
    this.config = withPersonalVoice(name, model, options, this.config);
    return this;
  }

  /** Set Azure Realtime native voice (model 'azure-realtime' only) */
  azureRealtimeVoice(name: AzureRealtimeNativeVoiceName): this {
    this.config = withAzureRealtimeVoice(name, this.config);
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
      appendedTextAfterTruncation?: string;
    } = {}
  ): this {
    this.config = withSemanticVAD(options, this.config);
    return this;
  }

  /** Add end-of-utterance detection */
  endOfUtterance(
    options: {
      model?: EndOfUtteranceModel;
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

  /** Enable server echo cancellation (optionally with Live-Reference AEC settings) */
  echoCancellation(options: { referenceSource?: 'server' | 'client'; channels?: 1 | 2 } = {}): this {
    this.config = withEchoCancellation(this.config, options);
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
      model?: InputAudioTranscription['model'];
      language?: string;
      prompt?: string;
      phraseList?: string[];
      customSpeech?: Record<string, string>;
    } = {}
  ): this {
    this.config = withTranscription(options, this.config);
    return this;
  }

  /** Set tools (replaces existing tools) */
  tools(tools: Tool[]): this {
    this.config = withTools(tools, this.config);
    return this;
  }

  /** Set tool choice mode */
  toolChoice(choice: 'auto' | 'none' | 'required'): this {
    this.config = withToolChoice(choice, this.config);
    return this;
  }

  /**
   * Add a remote MCP server (appends to existing tools)
   *
   * @example
   * ```tsx
   * sessionConfig().mcpServer({
   *   serverLabel: 'mslearn',
   *   serverUrl: 'https://learn.microsoft.com/api/mcp',
   *   requireApproval: 'always',
   * })
   * ```
   */
  mcpServer(server: Omit<MCPTool, 'type'>): this {
    this.config = withMcpServer(server, this.config);
    return this;
  }

  /** Add a Foundry agent as a tool (appends to existing tools) */
  foundryAgentTool(agent: Omit<FoundryAgentTool, 'type'>): this {
    this.config = withFoundryAgentTool(agent, this.config);
    return this;
  }

  /** Allow (default) or forbid parallel tool calls */
  parallelToolCalls(enabled: boolean = true): this {
    this.config = withParallelToolCalls(enabled, this.config);
    return this;
  }

  /** Set reasoning effort for reasoning-capable models */
  reasoningEffort(effort: ReasoningEffort): this {
    this.config = withReasoningEffort(effort, this.config);
    return this;
  }

  /** Attach session metadata (merges) */
  metadata(metadata: Record<string, string>): this {
    this.config = withMetadata(metadata, this.config);
    return this;
  }

  /**
   * Configure proactive greeting (assistant speaks first)
   *
   * @example
   * ```tsx
   * // LLM-generated greeting
   * sessionConfig().greeting({ type: 'llm', text: 'Greet the user warmly.' })
   *
   * // Pre-generated greeting (exact text)
   * sessionConfig().greeting({ type: 'pregenerated', text: 'Hello! How can I help?' })
   * ```
   */
  greeting(config: GreetingConfig): this {
    this.config = withGreeting(config, this.config);
    return this;
  }

  /**
   * Configure interim responses (filler messages during tool execution or latency).
   * Supported in agent mode and with cascaded text models + Azure voices
   * (not by native audio models such as gpt-realtime).
   * Defaults: latencyThresholdInMs 2000, model 'gpt-4.1-mini', maxCompletionTokens 50.
   *
   * @example
   * ```tsx
   * // LLM-generated filler
   * sessionConfig().interimResponse({
   *   type: 'llm_interim_response',
   *   triggers: ['tool', 'latency'],
   *   latencyThresholdInMs: 1500,
   * })
   *
   * // Static filler texts
   * sessionConfig().interimResponse({
   *   type: 'static_interim_response',
   *   triggers: ['tool'],
   *   texts: ['Let me look that up...', 'One moment please...'],
   * })
   * ```
   */
  interimResponse(config: InterimResponseConfig): this {
    this.config = withInterimResponse(config, this.config);
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
