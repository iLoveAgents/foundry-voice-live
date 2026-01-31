/**
 * Audio utility functions for Voice Live API
 */

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
export function createAudioDataCallback(sendEvent: (event: any) => void) {
  return (audioData: ArrayBuffer) => {
    const base64Audio = arrayBufferToBase64(audioData);
    sendEvent({
      type: 'input_audio_buffer.append',
      audio: base64Audio,
    });
  };
}
