/**
 * Tests for session builder wire format conversion
 * Verifies camelCase config is correctly converted to snake_case API format
 */

import { describe, it, expect } from 'vitest';
import { buildSessionConfig, buildAgentSessionConfig, buildSessionUpdate, buildResponseConfig } from './sessionBuilder';

describe('Session Builder Wire Format', () => {
  it('serializes native voices, sequential tools, reasoning and metadata', () => {
    const result = buildSessionConfig({
      voice: { type: 'azure-realtime-native', name: 'ava' },
      parallelToolCalls: false,
      reasoningEffort: 'low',
      metadata: { trace: 'example' },
    });
    expect(result.voice).toEqual({ type: 'azure-realtime-native', name: 'ava' });
    expect(result.parallel_tool_calls).toBe(false);
    expect(result.reasoning_effort).toBe('low');
    expect(result.metadata).toEqual({ trace: 'example' });
  });

  it('preserves custom voice endpoint and prosody options', () => {
    expect(buildSessionUpdate({ voice: {
      name: 'my-voice', type: 'azure-custom', endpointId: 'deployment-id',
      customLexiconUrl: 'https://example.com/lexicon.xml',
      customTextNormalizationUrl: 'https://example.com/rules.txt',
      preferLocales: ['de-DE'], locale: 'de-DE', style: 'cheerful',
      pitch: '+10%', volume: 'soft', rate: '1.1',
    } }).voice).toEqual({
      name: 'my-voice', type: 'azure-custom', endpoint_id: 'deployment-id',
      custom_lexicon_url: 'https://example.com/lexicon.xml',
      custom_text_normalization_url: 'https://example.com/rules.txt',
      prefer_locales: ['de-DE'], locale: 'de-DE', style: 'cheerful',
      pitch: '+10%', volume: 'soft', rate: '1.1',
    });
  });

  it('infers explicit wire discriminators for existing string voices', () => {
    expect(buildSessionConfig({ voice: 'marin' }).voice).toEqual({ type: 'openai', name: 'marin' });
    expect(buildSessionConfig({ voice: 'de-DE-KatjaNeural' }).voice.type).toBe('azure-standard');
  });

  it('does not reset settings on a partial session update', () => {
    expect(buildSessionUpdate({ temperature: 0.9 })).toEqual({ temperature: 0.9 });
    expect(buildSessionUpdate({ interimResponse: null })).toEqual({ interim_response: null });
  });

  it('does not merge Azure VAD fields into a different discriminator', () => {
    expect(buildSessionConfig({ turnDetection: { type: 'semantic_vad', eagerness: 'low' } }).turn_detection)
      .toEqual({ type: 'semantic_vad', eagerness: 'low' });
  });

  it('passes MCP and Foundry tools through and normalizes legacy tool choice', () => {
    const tools = [
      { type: 'mcp' as const, server_label: 'docs', server_url: 'https://example.com/mcp', require_approval: 'always' as const },
      { type: 'foundry_agent' as const, agent_name: 'helper', project_name: 'project', return_agent_response_directly: false },
    ];
    expect(buildSessionUpdate({ tools }).tools).toEqual(tools);
    expect(buildSessionUpdate({ toolChoice: { type: 'function', function: { name: 'lookup' } } }).tool_choice)
      .toEqual({ type: 'function', name: 'lookup' });
    expect(buildSessionUpdate({ toolChoice: 'lookup' }).tool_choice).toBe('lookup');
  });

  it('retains supported agent audio extensions while stripping model policy', () => {
    const config = {
      instructions: 'ignored', temperature: 0.9, parallelToolCalls: false,
      animation: { modelName: 'default', outputs: ['blendshapes' as const] },
      outputAudioTimestampTypes: ['word' as const], metadata: { trace: 'agent' },
    };
    const result = buildAgentSessionConfig(config);
    expect(result).not.toHaveProperty('instructions');
    expect(result).not.toHaveProperty('temperature');
    expect(result).not.toHaveProperty('parallel_tool_calls');
    expect(result.animation).toEqual({ model_name: 'default', outputs: ['blendshapes'] });
    expect(result.output_audio_timestamp_types).toEqual(['word']);
    expect(buildSessionUpdate({ instructions: 'ignored', metadata: { trace: 'agent' } }, true))
      .toEqual({ metadata: { trace: 'agent' } });
  });

  it('serializes echo reference, MAI and preview smart turn settings', () => {
    const result = buildSessionConfig({
      inputAudioEchoCancellation: { type: 'server_echo_cancellation', referenceSource: 'client', channels: 2 },
      inputAudioTranscription: { model: 'mai-transcribe-2', phraseList: ['Foundry'] },
      turnDetection: { endOfUtteranceDetection: { model: 'smart_end_of_turn_detection', thresholdLevel: 'high' } },
    });
    expect(result.input_audio_echo_cancellation).toEqual({ type: 'server_echo_cancellation', reference_source: 'client', channels: 2 });
    expect(result.input_audio_transcription.model).toBe('mai-transcribe-2');
    expect(result.turn_detection.end_of_utterance_detection.model).toBe('smart_end_of_turn_detection');
  });

  it('serializes photo avatar scenes and websocket output', () => {
    const result = buildSessionConfig({ avatar: {
      character: 'photo-url', type: 'photo-avatar', model: 'vasa-1',
      outputProtocol: 'websocket', outputAuditAudio: false,
      scene: { positionX: 0.2, rotationZ: 0.1, amplitude: 1 }, video: { gopSize: 10 },
    } });
    expect(result.avatar.output_protocol).toBe('websocket');
    expect(result.avatar.output_audit_audio).toBe(false);
    expect(result.avatar.scene.position_x).toBe(0.2);
    expect(result.avatar.video.gop_size).toBe(10);
  });

  it('serializes response content and hosted invocation without session defaults', () => {
    expect(buildResponseConfig({
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', imageUrl: 'https://example.com/image.png' }] }],
      preGeneratedAssistantMessage: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      invokeInput: { event: 'test' },
    })).toEqual({
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'https://example.com/image.png' }] }],
      pre_generated_assistant_message: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      invoke_input: { event: 'test' },
    });
    expect(buildResponseConfig({ input: [{ type: 'function_call_output', callId: 'call-1', output: 'ok' }] }).input)
      .toEqual([{ type: 'function_call_output', call_id: 'call-1', output: 'ok' }]);
  });

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
        instructions: 'Say something brief.',
      },
    });

    expect(result.interim_response).toEqual({
      type: 'llm_interim_response',
      triggers: ['tool', 'latency'],
      latency_threshold_ms: 3000,
      instructions: 'Say something brief.',
    });
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
});
