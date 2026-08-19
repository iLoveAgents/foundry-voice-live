/**
 * Session Configuration Builder
 *
 * Converts typed TypeScript configuration objects to Microsoft Foundry Voice Live API
 * wire format (JSON with snake_case). Handles all Voice Live parameters
 * with sensible defaults optimized for production use.
 *
 * Wire-format keys are verified against the official `@azure/ai-voicelive` SDK by
 * `protocolContract.test.ts`.
 *
 * @module sessionBuilder
 */

import type {
  VoiceLiveSessionConfig,
  VoiceConfig,
  TurnDetectionConfig,
  StandardVoice,
  Tool,
} from '../types/voiceLive';
import { OPENAI_VOICES } from '../types/voiceLive';

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

/** Native-audio models that do not support interim responses / cascaded-only features */
const NATIVE_AUDIO_MODELS = [
  'gpt-realtime',
  'gpt-realtime-mini',
  'phi4-mm-realtime',
  'azure-realtime',
];

/** Models that support OpenAI `semantic_vad` and near/far-field noise reduction */
const OPENAI_REALTIME_MODELS = ['gpt-realtime', 'gpt-realtime-mini'];

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
 * Session fields owned by the Foundry agent (configured in the portal). They are stripped
 * from agent-mode session.update payloads and reported by `validateConfig`.
 */
export const AGENT_OWNED_FIELDS = [
  'instructions',
  'temperature',
  'tools',
  'toolChoice',
  'maxResponseOutputTokens',
  'reasoningEffort',
  'parallelToolCalls',
] as const satisfies readonly (keyof VoiceLiveSessionConfig)[];

/**
 * Defaults for agent mode: the shared defaults minus agent-owned fields and minus the
 * default voice, so the agent's portal voice is used unless the caller sets one.
 */
const AGENT_DEFAULT_SESSION_CONFIG: VoiceLiveSessionConfig = omitKeys(DEFAULT_SESSION_CONFIG, [
  ...AGENT_OWNED_FIELDS,
  'voice',
]);

/**
 * Build session configuration for Foundry Agent mode
 *
 * Agent mode uses agents configured in the Microsoft Foundry portal: instructions,
 * temperature, tools and token limits come from the agent (see `AGENT_OWNED_FIELDS`)
 * and are stripped here. Audio settings, voice, transcription, interim responses,
 * animation, avatar and metadata are deep-merged over the shared defaults.
 *
 * @param userConfig - Optional audio, voice, and avatar configuration overrides
 * @returns Session configuration for agent mode in wire format
 */
export function buildAgentSessionConfig(
  userConfig?: VoiceLiveSessionConfig
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const overrides = userConfig ? omitKeys(userConfig, AGENT_OWNED_FIELDS) : {};
  return convertToSessionUpdate(deepMerge(AGENT_DEFAULT_SESSION_CONFIG, overrides));
}

/**
 * Shallow copy of `obj` without the given keys
 */
function omitKeys<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

/**
 * Convert typed config to session.update wire format
 *
 * Transforms camelCase TypeScript config to snake_case JSON format
 * required by the Microsoft Foundry Voice Live API WebSocket protocol.
 * No defaults are applied here — see `buildSessionConfig` for that.
 *
 * @param config - Typed session configuration
 * @returns Plain object with snake_case fields for API transmission
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function convertToSessionUpdate(config: VoiceLiveSessionConfig): any {
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

  if (config.parallelToolCalls !== undefined) {
    session.parallel_tool_calls = config.parallelToolCalls;
  }

  if (config.reasoningEffort !== undefined) {
    session.reasoning_effort = config.reasoningEffort;
  }

  if (config.metadata !== undefined) {
    session.metadata = config.metadata;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ec: any = { type: config.inputAudioEchoCancellation.type };
      if (config.inputAudioEchoCancellation.referenceSource !== undefined) {
        ec.reference_source = config.inputAudioEchoCancellation.referenceSource;
      }
      if (config.inputAudioEchoCancellation.channels !== undefined) {
        ec.channels = config.inputAudioEchoCancellation.channels;
      }
      session.input_audio_echo_cancellation = ec;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transcription: any = {
        model: config.inputAudioTranscription.model,
        language: config.inputAudioTranscription.language,
        prompt: config.inputAudioTranscription.prompt,
      };
      if (config.inputAudioTranscription.phraseList) {
        transcription.phrase_list = config.inputAudioTranscription.phraseList;
      }
      if (config.inputAudioTranscription.customSpeech) {
        transcription.custom_speech = config.inputAudioTranscription.customSpeech;
      }
      session.input_audio_transcription = transcription;
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
    session.tools = config.tools.map(convertTool);
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

  // Voice Live: Interim response
  if (config.interimResponse) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const interim: any = {
      type: config.interimResponse.type,
      triggers: config.interimResponse.triggers,
    };
    if (config.interimResponse.latencyThresholdInMs !== undefined) {
      interim.latency_threshold_ms = config.interimResponse.latencyThresholdInMs;
    }
    if (config.interimResponse.model !== undefined) {
      interim.model = config.interimResponse.model;
    }
    if (config.interimResponse.instructions !== undefined) {
      interim.instructions = config.interimResponse.instructions;
    }
    if (config.interimResponse.maxCompletionTokens !== undefined) {
      interim.max_completion_tokens = config.interimResponse.maxCompletionTokens;
    }
    if (config.interimResponse.texts !== undefined) {
      interim.texts = config.interimResponse.texts;
    }
    session.interim_response = interim;
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
 * Convert a tool definition to wire format.
 * Function tools (and any unknown/hand-built objects) pass through unchanged;
 * MCP and Foundry agent tools are converted from camelCase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertTool(tool: Tool): any {
  // Hand-built wire-format objects (server_label / agent_name …) pass through unchanged
  const raw = tool as unknown as Record<string, unknown>;
  if (
    'server_label' in raw ||
    'server_url' in raw ||
    'agent_name' in raw ||
    'project_name' in raw
  ) {
    return tool;
  }

  if (tool.type === 'mcp') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mcp: any = {
      type: 'mcp',
      server_label: tool.serverLabel,
      server_url: tool.serverUrl,
    };
    if (tool.allowedTools !== undefined) mcp.allowed_tools = tool.allowedTools;
    if (tool.headers !== undefined) mcp.headers = tool.headers;
    if (tool.authorization !== undefined) mcp.authorization = tool.authorization;
    if (tool.requireApproval !== undefined) mcp.require_approval = tool.requireApproval;
    return mcp;
  }

  if (tool.type === 'foundry_agent') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent: any = {
      type: 'foundry_agent',
      agent_name: tool.agentName,
      project_name: tool.projectName,
    };
    if (tool.agentVersion !== undefined) agent.agent_version = tool.agentVersion;
    if (tool.clientId !== undefined) agent.client_id = tool.clientId;
    if (tool.description !== undefined) agent.description = tool.description;
    if (tool.foundryResourceOverride !== undefined)
      agent.foundry_resource_override = tool.foundryResourceOverride;
    if (tool.agentContextType !== undefined) agent.agent_context_type = tool.agentContextType;
    if (tool.returnAgentResponseDirectly !== undefined) {
      agent.return_agent_response_directly = tool.returnAgentResponseDirectly;
    }
    return agent;
  }

  // Function tools are already in wire format (name/description/parameters)
  return tool;
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

  if (voice.pitch !== undefined) {
    voiceConfig.pitch = voice.pitch;
  }

  if (voice.volume !== undefined) {
    voiceConfig.volume = voice.volume;
  }

  if (voice.style !== undefined) {
    voiceConfig.style = voice.style;
  }

  if (voice.preferLocales !== undefined) {
    voiceConfig.prefer_locales = voice.preferLocales;
  }

  if (voice.locale !== undefined) {
    voiceConfig.locale = voice.locale;
  }

  if (voice.customLexiconUrl !== undefined) {
    voiceConfig.custom_lexicon_url = voice.customLexiconUrl;
  }

  if (voice.customTextNormalizationUrl !== undefined) {
    voiceConfig.custom_text_normalization_url = voice.customTextNormalizationUrl;
  }

  if (voice.endpointId !== undefined) {
    voiceConfig.endpoint_id = voice.endpointId;
  }

  if (voice.model !== undefined) {
    voiceConfig.model = voice.model;
  }

  return voiceConfig;
}

/**
 * Convert turn detection config to wire format
 *
 * Handles conversion for all turn detection types:
 * - server_vad: Basic VAD
 * - semantic_vad: OpenAI semantic VAD
 * - azure_semantic_vad(_en/_multilingual): Azure semantic VAD with filler word removal
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

  if (config.appendedTextAfterTruncation !== undefined) {
    turnDetection.appended_text_after_truncation = config.appendedTextAfterTruncation;
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
 * Returns human-readable warnings for configuration combinations that the service
 * ignores or rejects. Never throws — the hook logs the warnings before connecting.
 *
 * @param config - Session configuration to validate
 * @param isAgentMode - Whether this is a Foundry agent session
 * @param model - Model name for standard mode (used for model-specific checks)
 * @returns List of warnings (empty when the configuration looks fine)
 */
export function validateConfig(
  config: VoiceLiveSessionConfig,
  isAgentMode: boolean,
  model?: string
): string[] {
  const warnings: string[] = [];
  const modelName = model?.toLowerCase();

  // Agent mode: model behaviour is configured in the Foundry portal
  if (isAgentMode) {
    const ignored = AGENT_OWNED_FIELDS.filter((field) => {
      const value = config[field];
      return Array.isArray(value) ? value.length > 0 : value !== undefined;
    });
    if (ignored.length > 0) {
      warnings.push(
        `Agent mode ignores ${ignored.join(', ')} — configure these on the agent in the Microsoft Foundry portal.`
      );
    }
  }

  // Interim responses require a cascaded (text) model or agent mode
  if (
    config.interimResponse &&
    !isAgentMode &&
    modelName &&
    NATIVE_AUDIO_MODELS.includes(modelName)
  ) {
    warnings.push(
      `interimResponse is not supported by native audio models (${modelName}). ` +
        'Use a cascaded model such as gpt-4.1 with an Azure voice, or agent mode.'
    );
  }

  // OpenAI semantic_vad only works with the gpt-realtime family
  if (
    config.turnDetection?.type === 'semantic_vad' &&
    !isAgentMode &&
    modelName &&
    !OPENAI_REALTIME_MODELS.includes(modelName)
  ) {
    warnings.push(
      `turnDetection.type 'semantic_vad' is only supported by ${OPENAI_REALTIME_MODELS.join('/')}; ` +
        "use 'azure_semantic_vad' instead."
    );
  }

  // Azure Realtime native voices only work with the azure-realtime model
  if (
    typeof config.voice === 'object' &&
    config.voice?.type === 'azure-realtime-native' &&
    !isAgentMode &&
    modelName &&
    modelName !== 'azure-realtime'
  ) {
    warnings.push("voice.type 'azure-realtime-native' requires model 'azure-realtime'.");
  }

  const td = config.turnDetection;
  if (td) {
    if (td.appendedTextAfterTruncation !== undefined) {
      if (!td.autoTruncate) {
        warnings.push('turnDetection.appendedTextAfterTruncation requires autoTruncate: true.');
      }
      if (
        td.type &&
        td.type !== 'azure_semantic_vad' &&
        td.type !== 'azure_semantic_vad_multilingual'
      ) {
        warnings.push(
          "turnDetection.appendedTextAfterTruncation is only supported by 'azure_semantic_vad' and 'azure_semantic_vad_multilingual'."
        );
      }
    }
    if (td.autoTruncate && td.interruptResponse === false) {
      warnings.push('turnDetection.autoTruncate has no effect when interruptResponse is false.');
    }
  }

  // Transcription model compatibility: whisper-1 / gpt-4o-transcribe* only with the gpt-realtime family;
  // azure-speech only with other models and agents (mai-transcribe works everywhere)
  const transcriptionModel = config.inputAudioTranscription?.model;
  if (transcriptionModel && transcriptionModel !== 'mai-transcribe') {
    const openAiTranscription = transcriptionModel !== 'azure-speech';
    const realtimeFamily = !!modelName && OPENAI_REALTIME_MODELS.includes(modelName);
    if (openAiTranscription && (isAgentMode || (modelName && !realtimeFamily))) {
      warnings.push(
        `inputAudioTranscription.model '${transcriptionModel}' is only supported by ${OPENAI_REALTIME_MODELS.join('/')}; ` +
          "use 'azure-speech' (or 'mai-transcribe') for other models and Foundry agents."
      );
    }
    if (!openAiTranscription && !isAgentMode && realtimeFamily) {
      warnings.push(
        "inputAudioTranscription.model 'azure-speech' is not supported by the gpt-realtime family; " +
          "use 'whisper-1', 'gpt-4o-transcribe' or 'mai-transcribe'."
      );
    }
  }

  // Pre-generated greetings are synthesized by Azure TTS — OpenAI voices only produce audio via the model
  if (config.greeting?.type === 'pregenerated') {
    const voice = config.voice;
    // In agent mode an unset voice means "the agent's (Azure) voice" — only standard mode defaults to 'alloy'
    const isOpenAiVoice =
      (voice === undefined && !isAgentMode) ||
      (typeof voice === 'string' && (OPENAI_VOICES as readonly string[]).includes(voice)) ||
      (typeof voice === 'object' && voice.type === 'openai');
    if (isOpenAiVoice) {
      warnings.push(
        "greeting.type 'pregenerated' is spoken by Azure TTS and needs an Azure voice; with an OpenAI voice " +
          "(e.g. the default 'alloy') the greeting is added as text only. Use an Azure voice or greeting.type 'llm'."
      );
    }
  }

  // Client-reference AEC needs stereo capture that useAudioCapture does not implement yet
  if (config.inputAudioEchoCancellation?.referenceSource === 'client') {
    warnings.push(
      "inputAudioEchoCancellation.referenceSource 'client' requires interleaved stereo capture, " +
        'which useAudioCapture does not implement yet — the service will reject mono audio.'
    );
  }

  return warnings;
}
