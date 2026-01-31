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
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  /**
   * Start capturing audio from the microphone
   */
  const startCapture = useCallback(async () => {
    try {
      setError(null);

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints || true,
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
      if (onAudioData) {
        workletNode.port.onmessage = (event) => {
          onAudioData(event.data as ArrayBuffer);
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
  }, [sampleRate, workletPath, audioConstraints, onAudioData]);

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

  // Update audio data handler when callback changes
  useEffect(() => {
    const workletNode = audioWorkletNodeRef.current;
    if (workletNode && onAudioData) {
      workletNode.port.onmessage = (event) => {
        onAudioData(event.data as ArrayBuffer);
      };
    }
  }, [onAudioData]);

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
    error,
    startCapture,
    stopCapture,
    pauseCapture,
    resumeCapture,
  };
}
