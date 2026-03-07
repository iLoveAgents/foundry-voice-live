/**
 * Tests for session builder wire format conversion
 * Verifies camelCase config is correctly converted to snake_case API format
 */

import { describe, it, expect } from 'vitest';
import { buildSessionConfig } from './sessionBuilder';

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
        instructions: 'Say something brief.',
      },
    });

    expect(result.interim_response).toEqual({
      type: 'llm_interim_response',
      triggers: ['tool', 'latency'],
      latency_threshold_in_ms: 3000,
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
