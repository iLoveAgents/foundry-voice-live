/**
 * Audio utility functions for Voice Live API
 */

import type { VoiceLiveEvent } from '../types';

/**
 * Convert ArrayBuffer to base64 string safely (without stack overflow)
 * Uses chunking to avoid spreading large arrays
 *
 * @param buffer - Audio data as ArrayBuffer
 * @returns Base64 encoded string
 *
 * @example
 * ```tsx
 * const { startCapture } = useAudioCapture({
 *   sampleRate: 24000,
 *   onAudioData: (audioData) => {
 *     const base64 = arrayBufferToBase64(audioData);
 *     sendEvent({ type: 'input_audio_buffer.append', audio: base64 });
 *   }
 * });
 * ```
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const uint8Array = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
  let binary = '';

  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
    binary += String.fromCharCode(...Array.from(chunk));
  }

  return btoa(binary);
}

/**
 * Helper to create audio data callback for Voice Live API
 * Automatically handles base64 encoding
 *
 * @param sendEvent - The sendEvent function from useVoiceLive hook
 * @returns Callback function for useAudioCapture
 *
 * @example
 * ```tsx
 * const { sendEvent } = useVoiceLive(config);
 * const { startCapture } = useAudioCapture({
 *   sampleRate: 24000,
 *   onAudioData: createAudioDataCallback(sendEvent)
 * });
 * ```
 */
export function createAudioDataCallback(sendEvent: (event: VoiceLiveEvent) => void) {
  return (audioData: ArrayBuffer) => {
    const base64Audio = arrayBufferToBase64(audioData);
    sendEvent({
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    });
  };
}

/**
 * Build getUserMedia constraints for microphone capture with the SDK's defaults
 * (echo cancellation, noise suppression, auto gain control, mono). Used by both the
 * WebSocket capture pipeline (`useAudioCapture`) and the WebRTC transport.
 *
 * @param overrides - Caller constraints merged over the defaults (`true`/`undefined` = defaults)
 * @param sampleRate - Optional capture sample rate (WebSocket transport)
 */
export function buildMicConstraints(
  overrides?: MediaTrackConstraints | boolean,
  sampleRate?: number
): MediaStreamConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    ...(sampleRate !== undefined && { sampleRate }),
  };
  if (overrides === undefined || typeof overrides === 'boolean') {
    return { audio: base };
  }
  return { audio: { ...base, ...overrides } };
}
