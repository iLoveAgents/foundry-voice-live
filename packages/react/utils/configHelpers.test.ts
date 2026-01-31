import { describe, it, expect } from 'vitest';
import { withVoice, withSemanticVAD, compose } from './configHelpers';

describe('configHelpers', () => {
  describe('withVoice', () => {
    it('should add voice configuration', () => {
      const config = withVoice('en-US-Ava:DragonHDLatestNeural');

      // Voice is stored as a string when passed as string
      expect(config.voice).toBe('en-US-Ava:DragonHDLatestNeural');
    });
  });

  describe('withSemanticVAD', () => {
    it('should add semantic VAD turn detection', () => {
      const config = withSemanticVAD();

      expect(config.turnDetection).toEqual({
        type: 'azure_semantic_vad',
        threshold: 0.5,
        prefixPaddingMs: 300,
        speechDurationMs: 80,
        silenceDurationMs: 500,
        removeFillerWords: false,
        interruptResponse: true,
        createResponse: true,
        autoTruncate: undefined,
      });
    });

    it('should accept custom options', () => {
      const config = withSemanticVAD({
        threshold: 0.7,
        removeFillerWords: true,
        interruptResponse: false,
      });

      expect(config.turnDetection).toEqual({
        type: 'azure_semantic_vad',
        threshold: 0.7,
        prefixPaddingMs: 300,
        speechDurationMs: 80,
        silenceDurationMs: 500,
        removeFillerWords: true,
        interruptResponse: false,
        createResponse: true,
        autoTruncate: undefined,
      });
    });
  });

  describe('compose', () => {
    it('should compose multiple configuration helpers', () => {
      const config = compose(
        (c: Partial<import('../types').VoiceLiveSessionConfig>) => withVoice('en-US-Ava:DragonHDLatestNeural', c),
        (c: Partial<import('../types').VoiceLiveSessionConfig>) => withSemanticVAD({ threshold: 0.7 }, c)
      )({}) as import('../types').VoiceLiveSessionConfig;

      expect(config.voice).toBeDefined();
      expect(config.turnDetection).toBeDefined();
      expect(config.turnDetection?.threshold).toBe(0.7);
    });
  });
});
