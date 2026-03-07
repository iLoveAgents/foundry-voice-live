/**
 * useAudioCapture Hook
 *
 * React hook for capturing and processing microphone audio using Web Audio API.
 * Handles microphone access, AudioContext setup, and AudioWorklet processing.
 *
 * Features:
 * - Automatic microphone permission handling
 * - AudioWorklet-based audio processing
 * - Pause/resume capability
 * - Proper cleanup on unmount
 * - PCM16 audio output at configurable sample rate
 *
 * @example
 * ```tsx
 * const { isCapturing, startCapture, stopCapture, error } = useAudioCapture({
 *   sampleRate: 24000,
 *   onAudioData: (data) => sendToServer(data)
 * });
 * ```
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { AudioCaptureConfig, AudioCaptureReturn } from '../types';

/**
 * Inline AudioWorklet processor code
 * Converts float32 audio samples to PCM16 format
 */
const AUDIO_PROCESSOR_CODE = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input && input.length > 0) {
      const inputData = input[0]; // Get first channel

      if (inputData && inputData.length > 0) {
        // Convert float32 audio samples to PCM16
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Clamp to [-1, 1] and convert to 16-bit integer
          const clamped = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = Math.round(clamped * 32767);
        }

        // Send the PCM16 data to the main thread
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
      }
    }

    // Return true to keep the processor alive
    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
`;

/**
 * Create a blob URL for the inline audio processor
 */
function createProcessorBlobUrl(): string {
  const blob = new Blob([AUDIO_PROCESSOR_CODE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

/**
 * Hook for capturing and processing microphone audio
 */
export function useAudioCapture({
  sampleRate = 24000,
  workletPath, // Now optional - will use inline processor if not provided
  audioConstraints,
  onAudioData,
  autoStart = false,
}: AudioCaptureConfig = {}): AudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMutedRef = useRef(false);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const audioBufferRef = useRef<Int16Array[]>([]);
  const bufferedSamplesRef = useRef<number>(0);

  // Buffer size: 2400 samples = 4800 bytes = 100ms at 24kHz mono PCM16
  // Reduces WebSocket message frequency by batching small worklet outputs
  const BUFFER_SAMPLES = 2400;

  /**
   * Flush exactly BUFFER_SAMPLES from the buffer, leaving any remainder.
   * This ensures bounded message sizes (~100ms chunks) regardless of input timing.
   */
  const flushAudioBuffer = useCallback(() => {
    if (bufferedSamplesRef.current < BUFFER_SAMPLES || !onAudioData) return;

    // Merge buffered chunks into a flat array
    const chunks = audioBufferRef.current;
    const totalSamples = bufferedSamplesRef.current;
    const flat = new Int16Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      flat.set(chunk, offset);
      offset += chunk.length;
    }

    // Send exactly BUFFER_SAMPLES, keep remainder
    const output = flat.slice(0, BUFFER_SAMPLES);
    const remainder = flat.slice(BUFFER_SAMPLES);

    audioBufferRef.current = remainder.length > 0 ? [remainder] : [];
    bufferedSamplesRef.current = remainder.length;

    onAudioData(output.buffer);
  }, [onAudioData]);

  /**
   * Start capturing audio from the microphone
   */
  const startCapture = useCallback(async () => {
    try {
      setError(null);

      // Request microphone access with sensible defaults for voice applications
      const defaultConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: sampleRate,
        channelCount: 1,
      };
      const mergedConstraints = audioConstraints
        ? { ...defaultConstraints, ...audioConstraints }
        : defaultConstraints;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: mergedConstraints,
      });
      streamRef.current = stream;

      // Create AudioContext with specified sample rate
      const audioContext = new AudioContext({ sampleRate });
      audioContextRef.current = audioContext;

      // Determine processor path: use inline processor if no custom path provided
      let processorUrl: string;
      if (workletPath) {
        // Use custom worklet path (advanced usage)
        processorUrl = workletPath;
      } else {
        // Use inline processor (default - zero config!)
        processorUrl = createProcessorBlobUrl();
        blobUrlRef.current = processorUrl;
      }

      // Load AudioWorklet processor
      await audioContext.audioWorklet.addModule(processorUrl);

      // Create audio source and worklet node
      const source = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(audioContext, 'audio-capture-processor');

      sourceRef.current = source;
      audioWorkletNodeRef.current = workletNode;

      // Set up audio data handler BEFORE connecting
      // Buffer incoming samples into ~100ms chunks to reduce WebSocket message frequency
      if (onAudioData) {
        workletNode.port.onmessage = (event) => {
          if (isMutedRef.current) return;

          const incoming = new Int16Array(event.data as ArrayBuffer);
          audioBufferRef.current.push(incoming);
          bufferedSamplesRef.current += incoming.length;

          // Flush when we've accumulated enough samples
          while (bufferedSamplesRef.current >= BUFFER_SAMPLES) {
            flushAudioBuffer();
          }
        };
      }

      // Connect audio graph
      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      setIsCapturing(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start audio capture';
      setError(errorMessage);
      console.error('Audio capture error:', err);
      throw err;
    }
  }, [sampleRate, workletPath, audioConstraints, onAudioData, flushAudioBuffer]);

  /**
   * Stop capturing audio and release resources
   */
  const stopCapture = useCallback(() => {
    // Disconnect and cleanup audio nodes
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.disconnect();
      audioWorkletNodeRef.current.port.onmessage = null;
      audioWorkletNodeRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Cleanup blob URL if we created one
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    // Clear audio buffer
    audioBufferRef.current = [];
    bufferedSamplesRef.current = 0;

    // Reset mute state so a new capture session starts unmuted
    isMutedRef.current = false;
    setIsMuted(false);

    setIsCapturing(false);
  }, []);

  /**
   * Pause audio capture (suspend context)
   */
  const pauseCapture = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state === 'running') {
      audioContextRef.current.suspend();
    }
  }, []);

  /**
   * Resume audio capture
   */
  const resumeCapture = useCallback(() => {
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  }, []);

  /**
   * Toggle mute - instant, keeps worklet running
   * Uses ref for synchronous check in audio callback (no re-render delay)
   */
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      isMutedRef.current = !prev;
      return !prev;
    });
  }, []);

  // Update audio data handler when callback changes
  useEffect(() => {
    const workletNode = audioWorkletNodeRef.current;
    if (workletNode && onAudioData) {
      workletNode.port.onmessage = (event) => {
        if (isMutedRef.current) return;

        const incoming = new Int16Array(event.data as ArrayBuffer);
        audioBufferRef.current.push(incoming);
        bufferedSamplesRef.current += incoming.length;

        while (bufferedSamplesRef.current >= BUFFER_SAMPLES) {
          flushAudioBuffer();
        }
      };
    }
  }, [onAudioData, flushAudioBuffer]);

  // Auto-start if requested
  useEffect(() => {
    if (autoStart) {
      startCapture();
    }
  }, [autoStart, startCapture]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return {
    stream: streamRef.current,
    audioContext: audioContextRef.current,
    isCapturing,
    isMuted,
    error,
    startCapture,
    stopCapture,
    pauseCapture,
    resumeCapture,
    toggleMute,
  };
}
