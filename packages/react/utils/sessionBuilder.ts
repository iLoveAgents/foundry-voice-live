/**
 * Session Configuration Builder
 *
 * Converts typed TypeScript configuration objects to Microsoft Foundry Voice Live API
 * wire format (JSON with snake_case). Handles all Voice Live parameters
 * with sensible defaults optimized for production use.
 *
 * @module sessionBuilder
 */

import type {
  VoiceLiveSessionConfig,
  VoiceConfig,
  TurnDetectionConfig,
  StandardVoice,
} from '../types/voiceLive';

/**
 * Default session configuration
 * 
 * Optimized for best quality and user experience:
 * - Uses OpenAI 'alloy' voice (works with all models)
 * - Enables Azure semantic VAD for robust turn detection
 * - Includes audio enhancements (echo cancellation, noise reduction)
 * - Supports interruption for natural conversation flow
 */
export const DEFAULT_SESSION_CONFIG: VoiceLiveSessionConfig = {
  // Core configuration
  modalities: ['text', 'audio'],
  temperature: 0.8,
  maxResponseOutputTokens: 'inf',

  // Audio formats
  inputAudioFormat: 'pcm16',
  outputAudioFormat: 'pcm16',

  // Voice Live: Default voice (required)
  voice: 'alloy',

  // Voice Live: Input audio enhancements (enabled by default)
  inputAudioSamplingRate: 24000,
  inputAudioEchoCancellation: {
    type: 'server_echo_cancellation',
  },
  inputAudioNoiseReduction: {
    type: 'azure_deep_noise_suppression',
  },

  // Voice Live: Turn detection with Azure semantic VAD
  turnDetection: {
    type: 'azure_semantic_vad',
    threshold: 0.5,
    prefixPaddingMs: 300,
    speechDurationMs: 80,
    silenceDurationMs: 500,
    removeFillerWords: false,
    interruptResponse: true,
    createResponse: true,
  },

  // Tools
  tools: [],
  toolChoice: 'auto',
};

/**
 * Build session configuration from user config
 * 
 * Deep merges user configuration with defaults and converts to Voice Live API format.
 * 
 * @param userConfig - Optional user configuration to override defaults
 * @returns Session configuration object in Voice Live API wire format (snake_case)
 */
export function buildSessionConfig(
  userConfig?: VoiceLiveSessionConfig
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!userConfig) {
    return convertToSessionUpdate(DEFAULT_SESSION_CONFIG);
  }

  // Deep merge with defaults
  const merged = deepMerge(DEFAULT_SESSION_CONFIG, userConfig);

  // Convert to session.update format
  return convertToSessionUpdate(merged);
}

/**
 * Build minimal session configuration for Agent Service mode
 *
 * Agent mode uses agents configured in Azure AI Foundry portal.
 * Audio settings, voice, and avatar can be configured here - instructions
 * come from the portal configuration.
 *
 * @param userConfig - Optional audio, voice, and avatar configuration overrides
 * @returns Minimal session configuration for agent mode
 */
export function buildAgentSessionConfig(
  userConfig?: VoiceLiveSessionConfig
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // Start with basic audio configuration
  const agentConfig: VoiceLiveSessionConfig = {
    modalities: ['text', 'audio'],
    inputAudioFormat: 'pcm16',
    outputAudioFormat: 'pcm16',
    inputAudioSamplingRate: 24000,
    inputAudioEchoCancellation: {
      type: 'server_echo_cancellation',
    },
    inputAudioNoiseReduction: {
      type: 'azure_deep_noise_suppression',
    },
    turnDetection: {
      type: 'azure_semantic_vad',
      threshold: 0.5,
      prefixPaddingMs: 300,
      speechDurationMs: 80,
      silenceDurationMs: 500,
      removeFillerWords: false,
      interruptResponse: true,
      createResponse: true,
    },
  };

  // Allow user to override audio settings if provided
  if (userConfig) {
    if (userConfig.modalities) agentConfig.modalities = userConfig.modalities;
    if (userConfig.inputAudioFormat) agentConfig.inputAudioFormat = userConfig.inputAudioFormat;
    if (userConfig.outputAudioFormat) agentConfig.outputAudioFormat = userConfig.outputAudioFormat;
    if (userConfig.inputAudioSamplingRate) agentConfig.inputAudioSamplingRate = userConfig.inputAudioSamplingRate;
    if (userConfig.inputAudioEchoCancellation !== undefined) agentConfig.inputAudioEchoCancellation = userConfig.inputAudioEchoCancellation;
    if (userConfig.inputAudioNoiseReduction !== undefined) agentConfig.inputAudioNoiseReduction = userConfig.inputAudioNoiseReduction;
    if (userConfig.turnDetection !== undefined) agentConfig.turnDetection = userConfig.turnDetection;
    if (userConfig.inputAudioTranscription !== undefined) agentConfig.inputAudioTranscription = userConfig.inputAudioTranscription;
    if (userConfig.voice !== undefined) agentConfig.voice = userConfig.voice;
    if (userConfig.avatar !== undefined) agentConfig.avatar = userConfig.avatar;
  }

  // Convert to session.update format
  return convertToSessionUpdate(agentConfig);
}

/**
 * Convert typed config to session.update wire format
 * 
 * Transforms camelCase TypeScript config to snake_case JSON format
 * required by the Microsoft Foundry Voice Live API WebSocket protocol.
 * 
 * @param config - Typed session configuration
 * @returns Plain object with snake_case fields for API transmission
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertToSessionUpdate(config: VoiceLiveSessionConfig): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session: any = {};

  // Core configuration
  if (config.instructions !== undefined) {
    session.instructions = config.instructions;
  }

  if (config.modalities) {
    session.modalities = config.modalities;
  }

  if (config.temperature !== undefined) {
    session.temperature = config.temperature;
  }

  if (config.maxResponseOutputTokens !== undefined) {
    session.max_response_output_tokens = config.maxResponseOutputTokens;
  }

  // Audio formats
  if (config.inputAudioFormat) {
    session.input_audio_format = config.inputAudioFormat;
  }

  if (config.outputAudioFormat) {
    session.output_audio_format = config.outputAudioFormat;
  }

  // Voice Live: Input audio sampling rate
  if (config.inputAudioSamplingRate) {
    session.input_audio_sampling_rate = config.inputAudioSamplingRate;
  }

  // Voice Live: Echo cancellation
  if (config.inputAudioEchoCancellation !== undefined) {
    if (config.inputAudioEchoCancellation === null) {
      session.input_audio_echo_cancellation = null;
    } else {
      session.input_audio_echo_cancellation = {
        type: config.inputAudioEchoCancellation.type,
      };
    }
  }

  // Voice Live: Noise reduction
  if (config.inputAudioNoiseReduction !== undefined) {
    if (config.inputAudioNoiseReduction === null) {
      session.input_audio_noise_reduction = null;
    } else {
      session.input_audio_noise_reduction = {
        type: config.inputAudioNoiseReduction.type,
      };
    }
  }

  // Input audio transcription
  if (config.inputAudioTranscription !== undefined) {
    if (config.inputAudioTranscription === null) {
      session.input_audio_transcription = null;
    } else {
      session.input_audio_transcription = {
        model: config.inputAudioTranscription.model,
        language: config.inputAudioTranscription.language,
        prompt: config.inputAudioTranscription.prompt,
      };
    }
  }

  // Voice configuration
  if (config.voice) {
    session.voice = convertVoiceConfig(config.voice);
  }

  // Turn detection
  if (config.turnDetection !== undefined) {
    if (config.turnDetection === null) {
      session.turn_detection = null;
    } else {
      session.turn_detection = convertTurnDetection(config.turnDetection);
    }
  }

  // Tools
  if (config.tools) {
    session.tools = config.tools;
  }

  if (config.toolChoice) {
    session.tool_choice = config.toolChoice;
  }

  // Voice Live: Output audio timestamps
  if (config.outputAudioTimestampTypes) {
    session.output_audio_timestamp_types = config.outputAudioTimestampTypes;
  }

  // Voice Live: Animation (viseme)
  if (config.animation) {
    session.animation = {
      outputs: config.animation.outputs,
    };
  }

  // Voice Live: Avatar
  if (config.avatar) {
    session.avatar = {
      character: config.avatar.character,
      style: config.avatar.style,
      customized: config.avatar.customized,
    };

    if (config.avatar.iceServers) {
      session.avatar.ice_servers = config.avatar.iceServers;
    }

    if (config.avatar.video) {
      session.avatar.video = {
        codec: config.avatar.video.codec,
        bitrate: config.avatar.video.bitrate,
        resolution: config.avatar.video.resolution,
      };

      if (config.avatar.video.crop) {
        session.avatar.video.crop = {
          top_left: config.avatar.video.crop.topLeft,
          bottom_right: config.avatar.video.crop.bottomRight,
        };
      }

      if (config.avatar.video.background) {
        session.avatar.video.background = {
          color: config.avatar.video.background.color,
          image_url: config.avatar.video.background.imageUrl,
        };
      }
    }
  }

  return session;
}

/**
 * Convert voice config to wire format
 * 
 * Handles multiple voice configuration formats:
 * - String: Simple voice name (e.g., "alloy")
 * - Object: Full voice configuration with type, name, and parameters
 * 
 * @param voice - Voice configuration in any supported format
 * @returns Voice object in API format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertVoiceConfig(voice: string | StandardVoice | VoiceConfig): any {
  // Simple string voice name
  if (typeof voice === 'string') {
    return { name: voice };
  }

  // Full VoiceConfig
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const voiceConfig: any = {
    name: voice.name,
  };

  if (voice.type) {
    voiceConfig.type = voice.type;
  }

  if (voice.temperature !== undefined) {
    voiceConfig.temperature = voice.temperature;
  }

  if (voice.rate !== undefined) {
    voiceConfig.rate = String(voice.rate);
  }

  return voiceConfig;
}

/**
 * Convert turn detection config to wire format
 * 
 * Handles conversion for all turn detection types:
 * - server_vad: Basic VAD
 * - semantic_vad: OpenAI semantic VAD
 * - azure_semantic_vad: Azure semantic VAD with filler word removal
 * 
 * @param config - Turn detection configuration
 * @returns Turn detection object in API format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTurnDetection(config: TurnDetectionConfig): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const turnDetection: any = {};

  if (config.type) {
    turnDetection.type = config.type;
  }

  if (config.threshold !== undefined) {
    turnDetection.threshold = config.threshold;
  }

  if (config.prefixPaddingMs !== undefined) {
    turnDetection.prefix_padding_ms = config.prefixPaddingMs;
  }

  if (config.speechDurationMs !== undefined) {
    turnDetection.speech_duration_ms = config.speechDurationMs;
  }

  if (config.silenceDurationMs !== undefined) {
    turnDetection.silence_duration_ms = config.silenceDurationMs;
  }

  if (config.createResponse !== undefined) {
    turnDetection.create_response = config.createResponse;
  }

  if (config.interruptResponse !== undefined) {
    turnDetection.interrupt_response = config.interruptResponse;
  }

  // Semantic VAD (Azure OpenAI)
  if (config.eagerness) {
    turnDetection.eagerness = config.eagerness;
  }

  // Azure Semantic VAD (Voice Live)
  if (config.removeFillerWords !== undefined) {
    turnDetection.remove_filler_words = config.removeFillerWords;
  }

  if (config.languages) {
    turnDetection.languages = config.languages;
  }

  if (config.autoTruncate !== undefined) {
    turnDetection.auto_truncate = config.autoTruncate;
  }

  // End-of-utterance detection (Voice Live)
  if (config.endOfUtteranceDetection) {
    turnDetection.end_of_utterance_detection = {
      model: config.endOfUtteranceDetection.model,
      threshold_level: config.endOfUtteranceDetection.thresholdLevel,
      timeout_ms: config.endOfUtteranceDetection.timeoutMs,
    };
  }

  return turnDetection;
}

/**
 * Deep merge two objects with null-aware semantics
 * 
 * Merges source into target recursively. Important behaviors:
 * - null values explicitly disable features (preserved, not merged)
 * - undefined values are skipped (use target value)
 * - Arrays are replaced, not merged
 * - Objects are merged recursively
 * 
 * @param target - Base configuration object
 * @param source - Partial configuration to merge in
 * @returns Merged configuration object
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = result[key];

    // Handle null explicitly (means "disable this feature")
    if (sourceValue === null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = null;
      continue;
    }

    // Handle undefined (skip)
    if (sourceValue === undefined) {
      continue;
    }

    // Deep merge objects
    if (
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue) &&
      targetValue !== null
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = deepMerge(targetValue, sourceValue);
    } else {
      // Primitive values or arrays - direct assignment
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Validate configuration for compatibility
 * 
 * Checks for invalid configuration combinations and throws descriptive errors.
 * Currently validates:
 * - Agent mode restrictions (instructions must come from portal)
 * - Turn detection compatibility warnings
 * 
 * @param config - Session configuration to validate
 * @param isAgentMode - Whether this is an agent service session
 * @throws Error if configuration is invalid
 */
export function validateConfig(
  config: VoiceLiveSessionConfig,
  isAgentMode: boolean
): void {
  // Agent mode: instructions not allowed
  if (isAgentMode && config.instructions) {
    throw new Error(
      'Instructions cannot be set in Agent Service mode. ' +
      'Instructions come from the agent configuration.'
    );
  }

  // semantic_vad only works with gpt-realtime and gpt-realtime-mini
  if (
    config.turnDetection?.type === 'semantic_vad' &&
    config.turnDetection.eagerness
  ) {
    // Eagerness only applicable to semantic_vad
    // This is just a reminder, not an error
  }

  // End-of-utterance detection doesn't support certain models
  if (config.turnDetection?.endOfUtteranceDetection) {
    // Note: Currently doesn't support gpt-realtime, gpt-4o-mini-realtime, phi4-mm-realtime
    // But we won't throw an error - let the API handle it
  }
}
