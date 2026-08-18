/**
 * Tests for session builder wire format conversion
 * Verifies camelCase config is correctly converted to snake_case API format
 */

import { describe, it, expect } from 'vitest';
import {
  buildSessionConfig,
  buildAgentSessionConfig,
  AGENT_OWNED_FIELDS,
  convertToSessionUpdate,
  validateConfig,
} from './sessionBuilder';

describe('Session Builder Wire Format', () => {
  it('converts transcription phraseList to phrase_list', () => {
    const result = buildSessionConfig({
      inputAudioTranscription: {
        model: 'azure-speech',
        language: 'en',
        phraseList: ['Neo QLED TV', 'TUF Gaming'],
      },
    });

    expect(result.input_audio_transcription.phrase_list).toEqual([
      'Neo QLED TV',
      'TUF Gaming',
    ]);
  });

  it('converts transcription customSpeech to custom_speech', () => {
    const result = buildSessionConfig({
      inputAudioTranscription: {
        model: 'azure-speech',
        customSpeech: { 'zh-CN': 'model-id-123' },
      },
    });

    expect(result.input_audio_transcription.custom_speech).toEqual({
      'zh-CN': 'model-id-123',
    });
  });

  it('converts interimResponse to interim_response with snake_case fields', () => {
    const result = buildSessionConfig({
      interimResponse: {
        type: 'llm_interim_response',
        triggers: ['tool', 'latency'],
        latencyThresholdInMs: 3000,
        model: 'gpt-4.1-mini',
        instructions: 'Say something brief.',
        maxCompletionTokens: 30,
      },
    });

    expect(result.interim_response).toEqual({
      type: 'llm_interim_response',
      triggers: ['tool', 'latency'],
      latency_threshold_ms: 3000,
      model: 'gpt-4.1-mini',
      instructions: 'Say something brief.',
      max_completion_tokens: 30,
    });
    // Regression: the wire key is latency_threshold_ms (not latency_threshold_in_ms)
    expect(result.interim_response).not.toHaveProperty('latency_threshold_in_ms');
  });

  it('converts static interimResponse with texts', () => {
    const result = buildSessionConfig({
      interimResponse: {
        type: 'static_interim_response',
        triggers: ['tool'],
        texts: ['One moment...', 'Let me check.'],
      },
    });

    expect(result.interim_response).toEqual({
      type: 'static_interim_response',
      triggers: ['tool'],
      texts: ['One moment...', 'Let me check.'],
    });
  });

  it('converts turn detection camelCase to snake_case', () => {
    const result = buildSessionConfig({
      turnDetection: {
        type: 'azure_semantic_vad',
        threshold: 0.5,
        prefixPaddingMs: 300,
        speechDurationMs: 80,
        silenceDurationMs: 500,
        removeFillerWords: true,
        interruptResponse: true,
        autoTruncate: true,
      },
    });

    expect(result.turn_detection.type).toBe('azure_semantic_vad');
    expect(result.turn_detection.prefix_padding_ms).toBe(300);
    expect(result.turn_detection.speech_duration_ms).toBe(80);
    expect(result.turn_detection.silence_duration_ms).toBe(500);
    expect(result.turn_detection.remove_filler_words).toBe(true);
    expect(result.turn_detection.interrupt_response).toBe(true);
    expect(result.turn_detection.auto_truncate).toBe(true);
  });

  it('converts endOfUtteranceDetection to snake_case', () => {
    const result = buildSessionConfig({
      turnDetection: {
        type: 'azure_semantic_vad',
        endOfUtteranceDetection: {
          model: 'semantic_detection_v1',
          thresholdLevel: 'medium',
          timeoutMs: 1000,
        },
      },
    });

    expect(result.turn_detection.end_of_utterance_detection).toEqual({
      model: 'semantic_detection_v1',
      threshold_level: 'medium',
      timeout_ms: 1000,
    });
  });

  it('converts avatar video crop to snake_case', () => {
    const result = buildSessionConfig({
      avatar: {
        character: 'lisa',
        style: 'casual-sitting',
        video: {
          codec: 'h264',
          crop: {
            topLeft: [0.1, 0.1],
            bottomRight: [0.9, 0.9],
          },
          background: {
            color: '#00FF00FF',
            imageUrl: 'https://example.com/bg.jpg',
          },
        },
      },
    });

    expect(result.avatar.video.crop).toEqual({
      top_left: [0.1, 0.1],
      bottom_right: [0.9, 0.9],
    });
    expect(result.avatar.video.background).toEqual({
      color: '#00FF00FF',
      image_url: 'https://example.com/bg.jpg',
    });
  });

  it('converts maxResponseOutputTokens to snake_case', () => {
    const result = buildSessionConfig({
      maxResponseOutputTokens: 4096,
    });

    expect(result.max_response_output_tokens).toBe(4096);
  });

  it('handles null values for disabling features', () => {
    const result = buildSessionConfig({
      inputAudioEchoCancellation: null,
      inputAudioNoiseReduction: null,
      inputAudioTranscription: null,
      turnDetection: null,
    });

    expect(result.input_audio_echo_cancellation).toBeNull();
    expect(result.input_audio_noise_reduction).toBeNull();
    expect(result.input_audio_transcription).toBeNull();
    expect(result.turn_detection).toBeNull();
  });

  it('converts parallelToolCalls, reasoningEffort and metadata', () => {
    const result = buildSessionConfig({
      parallelToolCalls: false,
      reasoningEffort: 'low',
      metadata: { tenant: 'contoso', flow: 'support' },
    });

    expect(result.parallel_tool_calls).toBe(false);
    expect(result.reasoning_effort).toBe('low');
    expect(result.metadata).toEqual({ tenant: 'contoso', flow: 'support' });
  });

  it('omits parallel_tool_calls/reasoning_effort/metadata when not configured', () => {
    const result = buildSessionConfig({});
    expect(result).not.toHaveProperty('parallel_tool_calls');
    expect(result).not.toHaveProperty('reasoning_effort');
    expect(result).not.toHaveProperty('metadata');
  });

  it('converts echo cancellation reference source and channels', () => {
    const result = buildSessionConfig({
      inputAudioEchoCancellation: {
        type: 'server_echo_cancellation',
        referenceSource: 'client',
        channels: 2,
      },
    });

    expect(result.input_audio_echo_cancellation).toEqual({
      type: 'server_echo_cancellation',
      reference_source: 'client',
      channels: 2,
    });
  });

  it('keeps default echo cancellation minimal (no reference_source/channels)', () => {
    const result = buildSessionConfig();
    expect(result.input_audio_echo_cancellation).toEqual({ type: 'server_echo_cancellation' });
  });

  it('converts extended voice options to snake_case', () => {
    const result = buildSessionConfig({
      voice: {
        name: 'en-US-Ava:DragonHDLatestNeural',
        type: 'azure-standard',
        temperature: 0.7,
        rate: '1.1',
        pitch: '+5%',
        volume: 'loud',
        style: 'cheerful',
        preferLocales: ['en-GB', 'es-ES'],
        locale: 'en-US',
        customLexiconUrl: 'https://example.com/lexicon.xml',
        customTextNormalizationUrl: 'https://example.com/tn.xml',
      },
    });

    expect(result.voice).toEqual({
      name: 'en-US-Ava:DragonHDLatestNeural',
      type: 'azure-standard',
      temperature: 0.7,
      rate: '1.1',
      pitch: '+5%',
      volume: 'loud',
      style: 'cheerful',
      prefer_locales: ['en-GB', 'es-ES'],
      locale: 'en-US',
      custom_lexicon_url: 'https://example.com/lexicon.xml',
      custom_text_normalization_url: 'https://example.com/tn.xml',
    });
  });

  it('converts custom, personal and azure-realtime-native voices', () => {
    expect(
      buildSessionConfig({ voice: { name: 'my-voice', type: 'azure-custom', endpointId: 'ep-123' } }).voice
    ).toEqual({ name: 'my-voice', type: 'azure-custom', endpoint_id: 'ep-123' });

    expect(
      buildSessionConfig({
        voice: { name: 'my-personal', type: 'azure-personal', model: 'DragonHDOmniLatestNeural' },
      }).voice
    ).toEqual({ name: 'my-personal', type: 'azure-personal', model: 'DragonHDOmniLatestNeural' });

    expect(buildSessionConfig({ voice: { name: 'ava', type: 'azure-realtime-native' } }).voice).toEqual({
      name: 'ava',
      type: 'azure-realtime-native',
    });
  });

  it('converts appendedTextAfterTruncation and smart end-of-turn detection', () => {
    const result = buildSessionConfig({
      turnDetection: {
        type: 'azure_semantic_vad',
        autoTruncate: true,
        appendedTextAfterTruncation: ' [The user interrupted me.]',
        endOfUtteranceDetection: {
          model: 'smart_end_of_turn_detection',
          thresholdLevel: 'high',
          timeoutMs: 800,
        },
      },
    });

    expect(result.turn_detection.appended_text_after_truncation).toBe(' [The user interrupted me.]');
    expect(result.turn_detection.end_of_utterance_detection).toEqual({
      model: 'smart_end_of_turn_detection',
      threshold_level: 'high',
      timeout_ms: 800,
    });
  });

  it('converts MCP tools to snake_case', () => {
    const result = buildSessionConfig({
      tools: [
        {
          type: 'mcp',
          serverLabel: 'mslearn',
          serverUrl: 'https://learn.microsoft.com/api/mcp',
          allowedTools: ['search'],
          headers: { 'x-tenant': 'contoso' },
          authorization: 'Bearer abc',
          requireApproval: { never: ['search'], always: ['submit'] },
        },
      ],
    });

    expect(result.tools).toEqual([
      {
        type: 'mcp',
        server_label: 'mslearn',
        server_url: 'https://learn.microsoft.com/api/mcp',
        allowed_tools: ['search'],
        headers: { 'x-tenant': 'contoso' },
        authorization: 'Bearer abc',
        require_approval: { never: ['search'], always: ['submit'] },
      },
    ]);
  });

  it('converts foundry_agent tools to snake_case', () => {
    const result = buildSessionConfig({
      tools: [
        {
          type: 'foundry_agent',
          agentName: 'customer-service-agent',
          projectName: 'my-project',
          agentVersion: '2',
          clientId: 'client-1',
          description: 'Handles complex requests',
          foundryResourceOverride: 'other-resource',
          agentContextType: 'no_context',
          returnAgentResponseDirectly: false,
        },
      ],
    });

    expect(result.tools).toEqual([
      {
        type: 'foundry_agent',
        agent_name: 'customer-service-agent',
        project_name: 'my-project',
        agent_version: '2',
        client_id: 'client-1',
        description: 'Handles complex requests',
        foundry_resource_override: 'other-resource',
        agent_context_type: 'no_context',
        return_agent_response_directly: false,
      },
    ]);
  });

  it('passes hand-built wire-format mcp / foundry_agent tools through unchanged', () => {
    const rawMcp = { type: 'mcp', server_label: 'docs', server_url: 'https://docs' };
    const rawAgent = { type: 'foundry_agent', agent_name: 'a', project_name: 'p' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = buildSessionConfig({ tools: [rawMcp as any, rawAgent as any] });
    expect(result.tools).toEqual([rawMcp, rawAgent]);
  });

  it('passes function tools through unchanged', () => {
    const fn = {
      type: 'function' as const,
      name: 'get_weather',
      description: 'Get weather',
      parameters: { type: 'object', properties: {} },
    };
    const result = buildSessionConfig({ tools: [fn] });
    expect(result.tools).toEqual([fn]);
  });

  it('convertToSessionUpdate applies no defaults', () => {
    expect(convertToSessionUpdate({})).toEqual({});
    expect(convertToSessionUpdate({ instructions: 'Hi' })).toEqual({ instructions: 'Hi' });
  });
});

describe('buildAgentSessionConfig', () => {
  it('strips model-owned fields but keeps audio, voice, animation and metadata', () => {
    const result = buildAgentSessionConfig({
      instructions: 'ignored',
      temperature: 0.5,
      maxResponseOutputTokens: 100,
      tools: [{ type: 'function', name: 'x', description: 'y', parameters: {} }],
      voice: { name: 'en-US-AvaNeural', type: 'azure-standard' },
      animation: { outputs: ['viseme_id'] },
      outputAudioTimestampTypes: ['word'],
      metadata: { tenant: 'contoso' },
      interimResponse: { type: 'static_interim_response', triggers: ['tool'], texts: ['One sec'] },
    });

    expect(result).not.toHaveProperty('instructions');
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('max_response_output_tokens');
    expect(result).not.toHaveProperty('tools');
    expect(result.voice).toEqual({ name: 'en-US-AvaNeural', type: 'azure-standard' });
    expect(result.animation).toEqual({ outputs: ['viseme_id'] });
    expect(result.output_audio_timestamp_types).toEqual(['word']);
    expect(result.metadata).toEqual({ tenant: 'contoso' });
    expect(result.interim_response.type).toBe('static_interim_response');
    expect(result.turn_detection.type).toBe('azure_semantic_vad');
  });

  it('does not send a default voice or model-owned defaults so the agent portal settings win', () => {
    const result = buildAgentSessionConfig();
    expect(result).not.toHaveProperty('voice');
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('tool_choice');
    expect(result).not.toHaveProperty('max_response_output_tokens');
    expect(result.input_audio_echo_cancellation).toEqual({ type: 'server_echo_cancellation' });
  });

  it('deep-merges partial turn detection overrides like buildSessionConfig', () => {
    const result = buildAgentSessionConfig({ turnDetection: { type: 'azure_semantic_vad', silenceDurationMs: 900 } });
    expect(result.turn_detection).toMatchObject({ type: 'azure_semantic_vad', silence_duration_ms: 900, threshold: 0.5 });
  });

  it('strips every AGENT_OWNED_FIELDS entry', () => {
    const result = buildAgentSessionConfig({
      reasoningEffort: 'low',
      parallelToolCalls: false,
      toolChoice: 'none',
    });
    expect(result).not.toHaveProperty('reasoning_effort');
    expect(result).not.toHaveProperty('parallel_tool_calls');
    expect(result).not.toHaveProperty('tool_choice');
    expect(AGENT_OWNED_FIELDS).toContain('reasoningEffort');
  });
});

describe('validateConfig', () => {
  it('returns no warnings for a plain configuration', () => {
    expect(validateConfig({}, false, 'gpt-realtime')).toEqual([]);
    expect(validateConfig({ instructions: 'Hi' }, false, 'gpt-4.1')).toEqual([]);
  });

  it('warns about model-owned fields in agent mode', () => {
    const warnings = validateConfig({ instructions: 'Hi', temperature: 0.7 }, true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Agent mode ignores instructions, temperature/);
  });

  it('warns about interim responses with native audio models', () => {
    const warnings = validateConfig(
      { interimResponse: { type: 'llm_interim_response', triggers: ['tool'] } },
      false,
      'gpt-realtime'
    );
    expect(warnings.some((w) => w.includes('interimResponse'))).toBe(true);
    // Fine in agent mode and with cascaded models
    expect(validateConfig({ interimResponse: { type: 'llm_interim_response', triggers: ['tool'] } }, true)).toEqual([]);
    expect(
      validateConfig({ interimResponse: { type: 'llm_interim_response', triggers: ['tool'] } }, false, 'gpt-4.1')
    ).toEqual([]);
  });

  it('warns about semantic_vad and azure-realtime-native voice with incompatible models', () => {
    expect(validateConfig({ turnDetection: { type: 'semantic_vad' } }, false, 'gpt-4.1')[0]).toMatch(/semantic_vad/);
    expect(validateConfig({ turnDetection: { type: 'semantic_vad' } }, false, 'gpt-realtime')).toEqual([]);
    expect(
      validateConfig({ voice: { name: 'ava', type: 'azure-realtime-native' } }, false, 'gpt-realtime')[0]
    ).toMatch(/azure-realtime/);
    expect(validateConfig({ voice: { name: 'ava', type: 'azure-realtime-native' } }, false, 'azure-realtime')).toEqual(
      []
    );
  });

  it('warns about truncation option combinations and client-reference AEC', () => {
    const warnings = validateConfig(
      {
        turnDetection: { type: 'server_vad', appendedTextAfterTruncation: ' [cut]', interruptResponse: false, autoTruncate: true },
        inputAudioEchoCancellation: { type: 'server_echo_cancellation', referenceSource: 'client', channels: 2 },
      },
      false,
      'gpt-4.1'
    );
    expect(warnings.some((w) => w.includes("only supported by 'azure_semantic_vad'"))).toBe(true);
    expect(warnings.some((w) => w.includes('interruptResponse is false'))).toBe(true);
    expect(warnings.some((w) => w.includes("referenceSource 'client'"))).toBe(true);
    expect(validateConfig({ turnDetection: { appendedTextAfterTruncation: ' [cut]' } }, false)[0]).toMatch(
      /requires autoTruncate/
    );
  });

  it('does not warn about the greeting voice in agent mode when no voice is set', () => {
    expect(validateConfig({ greeting: { type: 'pregenerated', text: 'Hi' } }, true)).toEqual([]);
  });

  it('warns about incompatible transcription models', () => {
    expect(validateConfig({ inputAudioTranscription: { model: 'whisper-1' } }, true)[0]).toMatch(/only supported by/);
    expect(validateConfig({ inputAudioTranscription: { model: 'whisper-1' } }, false, 'gpt-4.1')[0]).toMatch(
      /only supported by/
    );
    expect(validateConfig({ inputAudioTranscription: { model: 'azure-speech' } }, false, 'gpt-realtime')[0]).toMatch(
      /not supported by the gpt-realtime family/
    );
    expect(validateConfig({ inputAudioTranscription: { model: 'azure-speech' } }, true)).toEqual([]);
    expect(validateConfig({ inputAudioTranscription: { model: 'whisper-1' } }, false, 'gpt-realtime')).toEqual([]);
    expect(validateConfig({ inputAudioTranscription: { model: 'mai-transcribe' } }, true)).toEqual([]);
  });

  it('warns when a pre-generated greeting is combined with an OpenAI voice', () => {
    expect(validateConfig({ greeting: { type: 'pregenerated', text: 'Hi' } }, false, 'gpt-realtime')[0]).toMatch(
      /Azure voice/
    );
    expect(validateConfig({ greeting: { type: 'pregenerated', text: 'Hi' }, voice: 'alloy' }, false)[0]).toMatch(
      /Azure voice/
    );
    expect(
      validateConfig(
        { greeting: { type: 'pregenerated', text: 'Hi' }, voice: { name: 'en-US-AvaNeural', type: 'azure-standard' } },
        false
      )
    ).toEqual([]);
    expect(validateConfig({ greeting: { type: 'llm', text: 'Greet' }, voice: 'alloy' }, false)).toEqual([]);
  });

  it('never throws', () => {
    expect(() => validateConfig({ instructions: 'x' }, true)).not.toThrow();
  });
});
