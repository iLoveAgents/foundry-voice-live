/**
 * Tests for all configuration helper functions
 * Verifies all README-documented helpers exist and work correctly
 */

import { describe, it, expect } from 'vitest';
import {
  // Voice helpers
  withVoice,
  withHDVoice,
  withCustomVoice,
  // Avatar helpers
  withAvatar,
  withTransparentBackground,
  withBackgroundImage,
  withAvatarCrop,
  // VAD helpers
  withSemanticVAD,
  withEndOfUtterance,
  withoutTurnDetection,
  // Audio helpers
  withEchoCancellation,
  withoutEchoCancellation,
  withDeepNoiseReduction,
  withNearFieldNoiseReduction,
  withoutNoiseReduction,
  withSampleRate,
  // Output helpers
  withViseme,
  withWordTimestamps,
  // Transcription helpers
  withTranscription,
  withoutTranscription,
  // Tools helpers
  withTools,
  withToolChoice,
  // Composition
  compose,
  sessionConfig,
} from './configHelpers';

describe('Voice Helpers', () => {
  it('withVoice sets voice name', () => {
    const config = withVoice('en-US-AvaMultilingualNeural');
    expect(config.voice).toBe('en-US-AvaMultilingualNeural');
  });

  it('withVoice merges with base config', () => {
    const config = withVoice('en-US-AvaMultilingualNeural', { instructions: 'Be helpful' });
    expect(config.voice).toBe('en-US-AvaMultilingualNeural');
    expect(config.instructions).toBe('Be helpful');
  });

  it('withHDVoice sets voice with options', () => {
    const config = withHDVoice('en-US-Ava:DragonHDLatestNeural', { temperature: 0.8, rate: '1.1' });
    expect(config.voice).toEqual({
      name: 'en-US-Ava:DragonHDLatestNeural',
      type: 'azure-standard',
      temperature: 0.8,
      rate: '1.1',
    });
  });

  it('withCustomVoice sets custom voice type', () => {
    const config = withCustomVoice('my-custom-voice-id');
    expect(config.voice).toEqual({
      name: 'my-custom-voice-id',
      type: 'azure-custom',
    });
  });
});

describe('Avatar Helpers', () => {
  it('withAvatar sets character and style', () => {
    const config = withAvatar('lisa', 'casual-sitting', { codec: 'h264' });
    expect(config.avatar?.character).toBe('lisa');
    expect(config.avatar?.style).toBe('casual-sitting');
    expect(config.avatar?.video?.codec).toBe('h264');
  });

  it('withAvatar merges with base config', () => {
    const config = withAvatar('lisa', 'casual-sitting', { codec: 'h264' }, {
      instructions: 'You are helpful.',
      voice: { name: 'en-US-AvaMultilingualNeural', type: 'azure-standard' },
    });
    expect(config.avatar?.character).toBe('lisa');
    expect(config.instructions).toBe('You are helpful.');
    expect(config.voice).toEqual({ name: 'en-US-AvaMultilingualNeural', type: 'azure-standard' });
  });

  it('withTransparentBackground sets green screen color', () => {
    const base = withAvatar('lisa', 'casual-sitting', {});
    const config = withTransparentBackground(base);
    expect(config.avatar?.video?.background?.color).toBe('#00FF00FF');
  });

  it('withTransparentBackground accepts custom key color', () => {
    const base = withAvatar('lisa', 'casual-sitting', {});
    const config = withTransparentBackground(base, { keyColor: '#0000FFFF' });
    expect(config.avatar?.video?.background?.color).toBe('#0000FFFF');
  });

  it('withBackgroundImage sets image URL', () => {
    const base = withAvatar('lisa', 'casual-sitting', {});
    const config = withBackgroundImage('https://example.com/bg.jpg', base);
    expect(config.avatar?.video?.background?.imageUrl).toBe('https://example.com/bg.jpg');
  });

  it('withAvatarCrop sets crop coordinates', () => {
    const base = withAvatar('lisa', 'casual-sitting', {});
    const config = withAvatarCrop({ topLeft: [0.1, 0.1], bottomRight: [0.9, 0.9] }, base);
    expect(config.avatar?.video?.crop).toEqual({
      topLeft: [0.1, 0.1],
      bottomRight: [0.9, 0.9],
    });
  });
});

describe('VAD Helpers', () => {
  it('withSemanticVAD sets semantic VAD config', () => {
    const config = withSemanticVAD({ threshold: 0.5, removeFillerWords: true });
    expect(config.turnDetection?.type).toBe('azure_semantic_vad');
    expect(config.turnDetection?.threshold).toBe(0.5);
    expect(config.turnDetection?.removeFillerWords).toBe(true);
  });

  it('withSemanticVAD uses defaults (respects API defaults)', () => {
    const config = withSemanticVAD();
    expect(config.turnDetection).toEqual({
      type: 'azure_semantic_vad',
      threshold: 0.5,
      prefixPaddingMs: 300,
      speechDurationMs: 80,
      silenceDurationMs: 500,
      removeFillerWords: undefined,  // API default is false
      languages: undefined,
      interruptResponse: undefined,  // API default is false
      createResponse: true,
      autoTruncate: undefined,
    });
  });

  it('withSemanticVAD multilingual option sets multilingual VAD type', () => {
    const config = withSemanticVAD({ multilingual: true, threshold: 0.6 });
    expect(config.turnDetection?.type).toBe('azure_semantic_vad_multilingual');
    expect(config.turnDetection?.threshold).toBe(0.6);
  });

  it('withSemanticVAD fillerWordLanguages sets languages for filler detection', () => {
    const config = withSemanticVAD({
      multilingual: true,
      removeFillerWords: true,
      fillerWordLanguages: ['en', 'es', 'fr'],
    });
    expect(config.turnDetection?.type).toBe('azure_semantic_vad_multilingual');
    expect(config.turnDetection?.removeFillerWords).toBe(true);
    expect(config.turnDetection?.languages).toEqual(['en', 'es', 'fr']);
  });

  it('withSemanticVAD supports interruptResponse option', () => {
    const config = withSemanticVAD({ interruptResponse: true });
    expect(config.turnDetection?.interruptResponse).toBe(true);
  });

  it('withEndOfUtterance adds EOU detection', () => {
    const base = withSemanticVAD({ threshold: 0.5 });
    const config = withEndOfUtterance({ thresholdLevel: 'medium', timeoutMs: 1000 }, base);
    expect(config.turnDetection?.endOfUtteranceDetection).toEqual({
      model: 'semantic_detection_v1',
      thresholdLevel: 'medium',
      timeoutMs: 1000,
    });
  });

  it('withoutTurnDetection disables turn detection', () => {
    const config = withoutTurnDetection({ instructions: 'Manual mode' });
    expect(config.turnDetection).toBeNull();
    expect(config.instructions).toBe('Manual mode');
  });
});

describe('Audio Helpers', () => {
  it('withEchoCancellation enables echo cancellation', () => {
    const config = withEchoCancellation();
    expect(config.inputAudioEchoCancellation).toEqual({
      type: 'server_echo_cancellation',
    });
  });

  it('withoutEchoCancellation disables echo cancellation', () => {
    const config = withoutEchoCancellation();
    expect(config.inputAudioEchoCancellation).toBeNull();
  });

  it('withDeepNoiseReduction enables deep noise suppression', () => {
    const config = withDeepNoiseReduction();
    expect(config.inputAudioNoiseReduction).toEqual({
      type: 'azure_deep_noise_suppression',
    });
  });

  it('withNearFieldNoiseReduction enables near field reduction', () => {
    const config = withNearFieldNoiseReduction();
    expect(config.inputAudioNoiseReduction).toEqual({
      type: 'near_field',
    });
  });

  it('withoutNoiseReduction disables noise reduction', () => {
    const config = withoutNoiseReduction();
    expect(config.inputAudioNoiseReduction).toBeNull();
  });

  it('withSampleRate sets sample rate', () => {
    const config = withSampleRate(24000);
    expect(config.inputAudioSamplingRate).toBe(24000);
  });
});

describe('Output Helpers', () => {
  it('withViseme enables viseme output', () => {
    const config = withViseme();
    expect(config.animation).toEqual({ outputs: ['viseme_id'] });
  });

  it('withWordTimestamps enables word timestamps', () => {
    const config = withWordTimestamps();
    expect(config.outputAudioTimestampTypes).toEqual(['word']);
  });
});

describe('Transcription Helpers', () => {
  it('withTranscription enables transcription', () => {
    const config = withTranscription({ model: 'whisper-1', language: 'en' });
    expect(config.inputAudioTranscription).toEqual({
      model: 'whisper-1',
      language: 'en',
      prompt: undefined,
      phraseList: undefined,
      customSpeech: undefined,
    });
  });

  it('withTranscription uses defaults', () => {
    const config = withTranscription();
    expect(config.inputAudioTranscription?.model).toBe('whisper-1');
  });

  it('withTranscription supports phraseList for Voice Live', () => {
    const config = withTranscription({
      model: 'azure-speech',
      language: 'en',
      phraseList: ['Neo QLED TV', 'TUF Gaming', 'AutoQuote Explorer'],
    });
    expect(config.inputAudioTranscription?.model).toBe('azure-speech');
    expect(config.inputAudioTranscription?.phraseList).toEqual([
      'Neo QLED TV',
      'TUF Gaming',
      'AutoQuote Explorer',
    ]);
  });

  it('withTranscription supports customSpeech for Voice Live', () => {
    const config = withTranscription({
      model: 'azure-speech',
      language: 'en',
      customSpeech: {
        'zh-CN': '847cb03d-7f22-4b11-444-e1be1d77bf17',
      },
    });
    expect(config.inputAudioTranscription?.model).toBe('azure-speech');
    expect(config.inputAudioTranscription?.customSpeech).toEqual({
      'zh-CN': '847cb03d-7f22-4b11-444-e1be1d77bf17',
    });
  });

  it('withTranscription supports all Voice Live options together', () => {
    const config = withTranscription({
      model: 'azure-speech',
      language: 'en',
      phraseList: ['Product A', 'Product B'],
      customSpeech: { 'zh-CN': 'model-id' },
    });
    expect(config.inputAudioTranscription).toEqual({
      model: 'azure-speech',
      language: 'en',
      prompt: undefined,
      phraseList: ['Product A', 'Product B'],
      customSpeech: { 'zh-CN': 'model-id' },
    });
  });

  it('withoutTranscription disables transcription', () => {
    const config = withoutTranscription();
    expect(config.inputAudioTranscription).toBeNull();
  });
});

describe('Tools Helpers', () => {
  it('withTools adds tools and sets toolChoice to auto', () => {
    const config = withTools([
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get weather for a location',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
      },
    ]);
    expect(config.tools).toHaveLength(1);
    expect(config.tools![0]!.name).toBe('get_weather');
    expect(config.toolChoice).toBe('auto');
  });

  it('withToolChoice sets tool choice mode', () => {
    const base = withTools([{ type: 'function', name: 'test', description: 'Test', parameters: { type: 'object', properties: {} } }]);
    const config = withToolChoice('required', base);
    expect(config.toolChoice).toBe('required');
  });
});

describe('Composition', () => {
  it('compose chains functions left to right', () => {
    const addA = (s: string) => s + 'A';
    const addB = (s: string) => s + 'B';
    const addC = (s: string) => s + 'C';

    const combined = compose(addA, addB, addC);
    expect(combined('')).toBe('ABC');
  });

  it('helpers can be nested for composition', () => {
    const config = withSemanticVAD(
      { threshold: 0.5 },
      withEchoCancellation(
        withDeepNoiseReduction(
          withAvatar('lisa', 'casual-sitting', { codec: 'h264' }, {
            instructions: 'You are a helpful assistant.',
          })
        )
      )
    );

    expect(config.avatar?.character).toBe('lisa');
    expect(config.instructions).toBe('You are a helpful assistant.');
    expect(config.inputAudioEchoCancellation?.type).toBe('server_echo_cancellation');
    expect(config.inputAudioNoiseReduction?.type).toBe('azure_deep_noise_suppression');
    expect(config.turnDetection?.type).toBe('azure_semantic_vad');
  });
});

describe('Session Builder', () => {
  it('sessionConfig() creates a builder', () => {
    const builder = sessionConfig();
    expect(builder).toBeDefined();
    expect(typeof builder.build).toBe('function');
  });

  it('builder chains methods fluently', () => {
    const config = sessionConfig()
      .instructions('You are helpful.')
      .voice('en-US-AvaMultilingualNeural')
      .build();

    expect(config.instructions).toBe('You are helpful.');
    expect(config.voice).toBe('en-US-AvaMultilingualNeural');
  });

  it('builder combines avatar and audio settings', () => {
    const config = sessionConfig()
      .avatar('lisa', 'casual-sitting', { codec: 'h264' })
      .echoCancellation()
      .noiseReduction('deep')
      .build();

    expect(config.avatar?.character).toBe('lisa');
    expect(config.avatar?.style).toBe('casual-sitting');
    expect(config.inputAudioEchoCancellation?.type).toBe('server_echo_cancellation');
    expect(config.inputAudioNoiseReduction?.type).toBe('azure_deep_noise_suppression');
  });

  it('builder supports semantic VAD with multilingual', () => {
    const config = sessionConfig()
      .semanticVAD({ multilingual: true, interruptResponse: true })
      .build();

    expect(config.turnDetection?.type).toBe('azure_semantic_vad_multilingual');
    expect(config.turnDetection?.interruptResponse).toBe(true);
  });

  it('builder supports HD voice', () => {
    const config = sessionConfig()
      .hdVoice('en-US-Ava:DragonHDLatestNeural', { temperature: 0.8 })
      .build();

    expect(config.voice).toEqual({
      name: 'en-US-Ava:DragonHDLatestNeural',
      type: 'azure-standard',
      temperature: 0.8,
      rate: undefined,
    });
  });

  it('builder supports transcription with phrase list', () => {
    const config = sessionConfig()
      .transcription({
        model: 'azure-speech',
        phraseList: ['Product A', 'Product B'],
      })
      .build();

    expect(config.inputAudioTranscription?.model).toBe('azure-speech');
    expect(config.inputAudioTranscription?.phraseList).toEqual(['Product A', 'Product B']);
  });

  it('builder supports tools', () => {
    const config = sessionConfig()
      .tools([
        {
          type: 'function',
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: {} },
        },
      ])
      .toolChoice('required')
      .build();

    expect(config.tools).toHaveLength(1);
    expect(config.toolChoice).toBe('required');
  });

  it('builder supports viseme and word timestamps', () => {
    const config = sessionConfig()
      .viseme()
      .wordTimestamps()
      .build();

    expect(config.animation?.outputs).toEqual(['viseme_id']);
    expect(config.outputAudioTimestampTypes).toEqual(['word']);
  });

  it('builder supports initial config', () => {
    const config = sessionConfig({ modalities: ['text', 'audio'] })
      .instructions('Hello')
      .build();

    expect(config.modalities).toEqual(['text', 'audio']);
    expect(config.instructions).toBe('Hello');
  });

  it('full builder example works', () => {
    const config = sessionConfig()
      .instructions('You are a helpful assistant.')
      .hdVoice('en-US-Ava:DragonHDLatestNeural', { temperature: 0.8 })
      .avatar('lisa', 'casual-sitting', { codec: 'h264', bitrate: 2000000 })
      .semanticVAD({ multilingual: true, removeFillerWords: true })
      .endOfUtterance({ thresholdLevel: 'medium' })
      .echoCancellation()
      .noiseReduction()
      .transcription({ model: 'azure-speech', language: 'en' })
      .build();

    expect(config.instructions).toBe('You are a helpful assistant.');
    expect(config.avatar?.character).toBe('lisa');
    expect(config.turnDetection?.type).toBe('azure_semantic_vad_multilingual');
    expect(config.turnDetection?.endOfUtteranceDetection?.thresholdLevel).toBe('medium');
    expect(config.inputAudioEchoCancellation?.type).toBe('server_echo_cancellation');
    expect(config.inputAudioNoiseReduction?.type).toBe('azure_deep_noise_suppression');
    expect(config.inputAudioTranscription?.model).toBe('azure-speech');
  });
});

describe('All README helpers are exported', () => {
  const readmeHelpers = [
    // Voice
    { name: 'withVoice', fn: withVoice },
    { name: 'withHDVoice', fn: withHDVoice },
    { name: 'withCustomVoice', fn: withCustomVoice },
    // Avatar
    { name: 'withAvatar', fn: withAvatar },
    { name: 'withTransparentBackground', fn: withTransparentBackground },
    { name: 'withBackgroundImage', fn: withBackgroundImage },
    { name: 'withAvatarCrop', fn: withAvatarCrop },
    // VAD
    { name: 'withSemanticVAD', fn: withSemanticVAD },
    { name: 'withEndOfUtterance', fn: withEndOfUtterance },
    { name: 'withoutTurnDetection', fn: withoutTurnDetection },
    // Audio
    { name: 'withEchoCancellation', fn: withEchoCancellation },
    { name: 'withDeepNoiseReduction', fn: withDeepNoiseReduction },
    { name: 'withNearFieldNoiseReduction', fn: withNearFieldNoiseReduction },
    { name: 'withSampleRate', fn: withSampleRate },
    // Output
    { name: 'withViseme', fn: withViseme },
    { name: 'withWordTimestamps', fn: withWordTimestamps },
    { name: 'withTranscription', fn: withTranscription },
    // Tools
    { name: 'withTools', fn: withTools },
    { name: 'withToolChoice', fn: withToolChoice },
  ];

  readmeHelpers.forEach(({ name, fn }) => {
    it(`${name} is exported and is a function`, () => {
      expect(typeof fn).toBe('function');
    });
  });
});
