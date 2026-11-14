/**
 * useVoiceLive Hook - Comprehensive Implementation
 *
 * React hook for Microsoft Foundry Voice Live WebSocket sessions.
 * Provides microphone capture, audio playback, and WebRTC avatar rendering.
 *
 * @example
 * ```tsx
 * // Simple usage with defaults
 * const { connectionState, videoStream, connect } = useVoiceLive({
 *   connection: {
 *     proxyUrl: 'ws://localhost:8080/ws',
 *   },
 * });
 *
 * // Advanced usage with full config
 * const api = useVoiceLive({
 *   connection: {
 *     proxyUrl: 'ws://localhost:8080/ws',
 *     model: 'gpt-4o', // or any model
 *   },
 *   session: {
 *     instructions: 'You are helpful',
 *     voice: {
 *       name: 'en-US-Ava:DragonHDLatestNeural',
 *       type: 'azure-standard',
 *       temperature: 0.9,
 *       rate: '1.2',
 *     },
 *     turnDetection: {
 *       type: 'azure_semantic_vad',
 *       removeFillerWords: true,
 *       endOfUtteranceDetection: {
 *         model: 'semantic_detection_v1',
 *       },
 *     },
 *     avatar: {
 *       character: 'lisa',
 *       style: 'casual-sitting',
 *     },
 *   },
 *   toolExecutor: (name, args, id) => {},
 * });
 * ```
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  UseVoiceLiveConfig,
  UseVoiceLiveReturn,
  VoiceLiveEvent,
  SessionState,
  ResponseCreateOptions,
  VoiceLiveSessionConfig,
  OutputAudioFormat,
  InputAudioSamplingRate,
} from '../types/voiceLive';
import { buildSessionConfig, buildAgentSessionConfig, buildSessionUpdate, buildResponseConfig } from '../utils/sessionBuilder';
import { buildConnectionUrl, redactConnectionUrl } from '../utils/connectionHelpers';
import { VoiceLiveWebRTCTransport } from '../utils/webRTCTransport';
import { useAudioCapture } from './useAudioCapture';
import { arrayBufferToBase64 } from '../utils/audioHelpers';

/**
 * Inline AudioWorklet processor for playback with Lanczos-3 resampling.
 * Runs entirely off the main thread for optimal performance.
 *
 * Receives PCM16 Int16Array buffers via postMessage, resamples from source
 * sample rate to output sample rate using Lanczos-3 interpolation, and
 * plays back via a queue-based buffer for gapless audio.
 */
const AUDIO_PLAYBACK_PROCESSOR_CODE = `
class AudioPlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.bufferQueue = [];
    this.currentBuffer = null;
    this.currentOffset = 0;
    this.sourceSampleRate = (options && options.processorOptions && options.processorOptions.sourceSampleRate) || 24000;
    this.ratio = sampleRate / this.sourceSampleRate;

    this.port.onmessage = (event) => {
      if (event.data === null) {
        // Stop signal - clear queue (barge-in)
        this.bufferQueue = [];
        this.currentBuffer = null;
        this.currentOffset = 0;
      } else if (typeof event.data.sourceSampleRate === 'number') {
        this.sourceSampleRate = event.data.sourceSampleRate;
        this.ratio = sampleRate / this.sourceSampleRate;
      } else {
        // Receive Int16Array buffer, convert and resample
        const int16 = new Int16Array(event.data);
        const resampled = this.resample(int16);
        this.bufferQueue.push(resampled);
      }
    };
  }

  // Lanczos-3 kernel
  lanczos(x) {
    if (x === 0) return 1;
    if (Math.abs(x) >= 3) return 0;
    const px = Math.PI * x;
    const pa = px / 3;
    return (Math.sin(px) * Math.sin(pa)) / (px * pa);
  }

  // Convert Int16 PCM to Float32 and resample using Lanczos-3
  resample(int16) {
    const sourceLen = int16.length;
    const outputLen = Math.ceil(sourceLen * this.ratio);
    const output = new Float32Array(outputLen);

    for (let i = 0; i < outputLen; i++) {
      const srcIdx = i / this.ratio;
      const center = Math.floor(srcIdx);
      const frac = srcIdx - center;

      let sample = 0;
      for (let j = -2; j <= 3; j++) {
        const idx = center + j;
        if (idx >= 0 && idx < sourceLen) {
          sample += (int16[idx] / 32768.0) * this.lanczos(frac - j);
        }
      }
      output[i] = sample;
    }
    return output;
  }

  process(inputs, outputs) {
    const channel = outputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      if (!this.currentBuffer || this.currentOffset >= this.currentBuffer.length) {
        if (this.bufferQueue.length > 0) {
          this.currentBuffer = this.bufferQueue.shift();
          this.currentOffset = 0;
        } else {
          channel[i] = 0;
          continue;
        }
      }
      channel[i] = this.currentBuffer[this.currentOffset];
      this.currentOffset++;
    }
    return true;
  }
}

registerProcessor('audio-playback-processor', AudioPlaybackProcessor);
`;

function getOutputSampleRate(format: OutputAudioFormat): number {
  if (format === 'pcm16_16000hz') return 16000;
  if (format === 'pcm16') return 24000;
  return 8000;
}

function createPlaybackProcessorBlobUrl(): string {
  const blob = new Blob([AUDIO_PLAYBACK_PROCESSOR_CODE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

/**
 * Utility to get timestamp for logging
 */
const getTimestamp = (): string => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now
    .getMilliseconds()
    .toString()
    .padStart(3, '0')}`;
};

/**
 * Hook for Microsoft Foundry Voice Live API integration
 * Uses typed configuration with raw protocol events available through sendEvent/onEvent.
 */
export function useVoiceLive(config: UseVoiceLiveConfig): UseVoiceLiveReturn {
  const {
    connection,
    session,
    autoConnect = false,
    autoStartMic = true,
    audioSampleRate = session?.inputAudioSamplingRate ?? (session?.inputAudioFormat?.startsWith('g711_') ? 8000 : 24000),
    audioConstraints,
    onEvent,
    onTranscript,
    toolExecutor,
  } = config;

  const [connectionState, setConnectionState] = useState<UseVoiceLiveReturn['connectionState']>('disconnected');
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [isReady, setIsReady] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [, forceUpdate] = useState({});

  const wsRef = useRef<WebSocket | null>(null);
  const voiceRTCRef = useRef<VoiceLiveWebRTCTransport | null>(null);
  const transportRef = useRef<'websocket' | 'webrtc'>('websocket');
  const connectionAttemptRef = useRef(0);
  const greetingSentRef = useRef(false);
  const remoteAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const [rtcMicActive, setRTCMicActive] = useState(false);
  const [rtcMuted, setRTCMuted] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const playbackWorkletRef = useRef<AudioWorkletNode | null>(null);
  const playbackBlobUrlRef = useRef<string | null>(null);
  const playbackInitPromiseRef = useRef<Promise<void> | null>(null);
  const currentResponseIdRef = useRef<string | null>(null);
  const responseStartTimeRef = useRef<number | null>(null);
  const isFirstChunkRef = useRef<boolean>(true);
  const isAgentModeRef = useRef<boolean>(false);
  const assistantTranscriptRef = useRef<string>('');
  const sessionOutputAudioFormatRef = useRef<OutputAudioFormat>(session?.outputAudioFormat ?? 'pcm16');
  const outputAudioFormatRef = useRef<OutputAudioFormat>(session?.outputAudioFormat ?? 'pcm16');
  const requestedOutputFormatsRef = useRef<OutputAudioFormat[]>([]);
  const playbackSourceRateRef = useRef<number | null>(null);

  // Keep a stable ref for sendEvent to use in audio capture callback
  const sendEventRef = useRef<(event: VoiceLiveEvent) => void>();

  /**
   * Handle audio data from microphone
   * Converts to base64 and sends to Voice Live API
   */
  const handleAudioData = useCallback((audioData: ArrayBuffer) => {
    const base64Audio = arrayBufferToBase64(audioData);
    if (sendEventRef.current) {
      sendEventRef.current({
        type: 'input_audio_buffer.append',
        audio: base64Audio,
      });
    }
  }, []);

  /**
   * Integrate audio capture for microphone input
   */
  const {
    isCapturing: captureActive,
    isMuted: captureMuted,
    startCapture,
    stopCapture,
    toggleMute: toggleCaptureMute,
  } = useAudioCapture({
    sampleRate: audioSampleRate,
    audioConstraints: typeof audioConstraints === 'boolean' ? undefined : audioConstraints,
    onAudioData: handleAudioData,
    autoStart: false, // Manual control - we'll start when session is ready
  });

  /**
   * Send an event to the Voice Live API
   */
  const sendEvent = useCallback((event: VoiceLiveEvent): void => {
    if (voiceRTCRef.current) {
      voiceRTCRef.current.sendEvent(event);
      return;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Skip logging for verbose events
      const skipSendLogging = [
        'input_audio_buffer.append',
        'conversation.item.create',
        'response.create',
      ];
      if (!skipSendLogging.includes(event.type)) {
        console.log(`[${getTimestamp()}] Sending:`, event.type);
      }
      if (event.type === 'response.create') {
        const response = event.response as { output_audio_format?: OutputAudioFormat } | undefined;
        requestedOutputFormatsRef.current.push(response?.output_audio_format ?? sessionOutputAudioFormatRef.current);
      }
      wsRef.current.send(JSON.stringify(event));
    } else {
      console.warn('WebSocket not connected, cannot send event:', event.type);
    }
  }, []);

  // Keep sendEventRef up to date
  useEffect(() => {
    sendEventRef.current = sendEvent;
  }, [sendEvent]);

  /** Send only requested changes; defaults belong to initial session setup. */
  const updateSession = useCallback((partialSession: Partial<VoiceLiveSessionConfig>): void => {
    sendEvent({
      type: 'session.update',
      session: buildSessionUpdate(partialSession, isAgentModeRef.current),
    });
  }, [sendEvent]);

  const createResponse = useCallback((options?: ResponseCreateOptions): void => {
    sendEvent({ type: 'response.create', ...(options ? { response: buildResponseConfig(options) } : {}) });
  }, [sendEvent]);

  const appendText = useCallback((id: string, delta: string, contentIndex?: number): void => {
    sendEvent({ type: 'input_text.delta', id, delta, ...(contentIndex !== undefined ? { content_index: contentIndex } : {}) });
  }, [sendEvent]);

  const finishText = useCallback((id: string, contentIndex?: number): void => {
    sendEvent({ type: 'input_text.done', id, ...(contentIndex !== undefined ? { content_index: contentIndex } : {}) });
  }, [sendEvent]);

  const stopMic = useCallback((): void => {
    if (voiceRTCRef.current) voiceRTCRef.current.stopMic();
    else stopCapture();
  }, [stopCapture]);

  const toggleMute = useCallback((): void => {
    if (voiceRTCRef.current) voiceRTCRef.current.toggleMute();
    else if (transportRef.current === 'websocket') toggleCaptureMute();
  }, [toggleCaptureMute]);

  const startMic = useCallback(async (): Promise<void> => {
    if (voiceRTCRef.current) return voiceRTCRef.current.startMic(audioConstraints);
    if (transportRef.current === 'webrtc') throw new Error('Connect the WebRTC session before starting the microphone.');
    if (session?.inputAudioFormat && session.inputAudioFormat !== 'pcm16') {
      throw new Error('Built-in microphone capture requires pcm16. Use autoStartMic: false and sendEvent for encoded audio input.');
    }
    if (session?.inputAudioEchoCancellation?.referenceSource === 'client') {
      throw new Error('Client echo reference requires interleaved stereo audio. Use autoStartMic: false and sendEvent with your microphone/reference stream.');
    }
    if (session?.inputAudioSamplingRate && audioSampleRate !== session.inputAudioSamplingRate) {
      throw new Error('audioSampleRate must match session.inputAudioSamplingRate.');
    }
    await startCapture();
  }, [session, audioSampleRate, startCapture, audioConstraints]);

  const getMicrophoneStatus = useCallback(() => voiceRTCRef.current?.getMicrophoneStatus() ?? Promise.resolve(null), []);

  /**
   * Stop all audio playback immediately (for interruptions/barge-in)
   * Sends null to the playback worklet to clear its queue
   */
  const stopAudioPlayback = useCallback(() => {
    if (playbackWorkletRef.current) {
      playbackWorkletRef.current.port.postMessage(null);
    }
    console.log(`[${getTimestamp()}] Audio playback stopped (user interruption)`);
  }, []);

  /**
   * Initialize the playback AudioWorklet (lazy, on first audio chunk)
   * Sets up the worklet with Lanczos-3 resampling running off the main thread
   */
  const initPlaybackWorklet = useCallback(async () => {
    if (playbackWorkletRef.current) return;

    // Guard against concurrent init calls (race condition on first audio chunks)
    if (playbackInitPromiseRef.current) {
      await playbackInitPromiseRef.current;
      return;
    }

    const audioContext = audioContextRef.current;
    if (!audioContext) return;

    const initPromise = (async () => {
      const blobUrl = createPlaybackProcessorBlobUrl();
      playbackBlobUrlRef.current = blobUrl;

      await audioContext.audioWorklet.addModule(blobUrl);

      const workletNode = new AudioWorkletNode(audioContext, 'audio-playback-processor', {
        processorOptions: { sourceSampleRate: getOutputSampleRate(outputAudioFormatRef.current) },
      });

      // Connect worklet to gain node (for visualization) or directly to destination
      if (audioGainRef.current) {
        workletNode.connect(audioGainRef.current);
      } else {
        workletNode.connect(audioContext.destination);
      }

      playbackWorkletRef.current = workletNode;
      playbackSourceRateRef.current = getOutputSampleRate(outputAudioFormatRef.current);
      console.log(`[${getTimestamp()}] Playback worklet initialized (Lanczos-3 resampling, off main thread)`);
    })();

    playbackInitPromiseRef.current = initPromise;
    await initPromise;
  }, []);

  /**
   * Play audio chunk for voice-only mode via AudioWorklet
   * Decodes base64 PCM16 and sends raw Int16Array to worklet for
   * Lanczos-3 resampling and queue-based gapless playback (all off main thread)
   */
  const playAudioChunk = useCallback(async (base64Audio: string) => {
    try {
      const audioContext = audioContextRef.current;
      if (!audioContext) return;

      // Resume AudioContext if suspended (browser autoplay policy)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Initialize worklet on first chunk
      if (!playbackWorkletRef.current) {
        await initPlaybackWorklet();
      }

      const outputFormat = outputAudioFormatRef.current;
      const outputRate = getOutputSampleRate(outputFormat);
      if (playbackSourceRateRef.current !== outputRate) {
        playbackWorkletRef.current?.port.postMessage({ sourceSampleRate: outputRate });
        playbackSourceRateRef.current = outputRate;
      }

      // Track response start time for viseme sync
      if (isFirstChunkRef.current) {
        responseStartTimeRef.current = audioContext.currentTime;
        isFirstChunkRef.current = false;
      }

      // Decode base64 to raw bytes
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Transfer PCM16 buffer to worklet (transferable for zero-copy performance)
      let buffer: ArrayBuffer = bytes.buffer;
      if (outputFormat === 'g711_ulaw' || outputFormat === 'g711_alaw') {
        const samples = new Int16Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
          if (outputFormat === 'g711_ulaw') {
            const sample = (~bytes[i]!) & 0xff;
            const magnitude = (((sample & 0x0f) << 3) + 0x84) << ((sample & 0x70) >> 4);
            samples[i] = sample & 0x80 ? 0x84 - magnitude : magnitude - 0x84;
          } else {
            const sample = bytes[i]! ^ 0x55;
            const segment = (sample & 0x70) >> 4;
            let magnitude = (sample & 0x0f) << 4;
            magnitude += segment === 0 ? 8 : 0x108;
            if (segment > 1) magnitude <<= segment - 1;
            samples[i] = sample & 0x80 ? magnitude : -magnitude;
          }
        }
        buffer = samples.buffer;
      }
      playbackWorkletRef.current?.port.postMessage(buffer, [buffer]);
    } catch (err) {
      console.error('Error playing audio chunk:', err);
    }
  }, [initPlaybackWorklet]);

  /**
   * Handle WebSocket messages
   */
  const handleMessage = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (event: MessageEvent): Promise<void> => {
      // Using any for parsed JSON since events have various structures
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = JSON.parse(event.data);

      // Skip verbose event logging
      const skipLogging = [
        'response.audio.delta',
        'response.audio_transcript.delta',
        'response.text.delta',
        'response.audio.done',
        'response.content_part.added',
        'response.content_part.done',
        'response.output_item.done',
        'conversation.item.created',
        'response.created',
        'response.function_call_arguments.delta',
        'response.output_item.added',
        'response.animation_viseme.delta',
        'response.audio_timestamp.delta',
      ];

      if (!skipLogging.includes(data.type)) {
        console.log(`[${getTimestamp()}]`, data.type);
      }

      // Call custom event handler if provided
      if (onEvent) {
        onEvent(data);
      }

      // Handle specific events
      switch (data.type) {
        case 'session.created': {
          console.log(`[${getTimestamp()}] Session created`);
          setSessionExpiresAt(typeof data.session?.expires_at === 'number' ? data.session.expires_at : null);
          if (transportRef.current === 'webrtc') break;

          // Send session.update immediately after session.created
          // Don't start audio capture until session is configured
          const initialSession: VoiceLiveSessionConfig = {
            ...(data.session?.model === 'azure-realtime' && session?.voice === undefined
              ? { voice: { type: 'azure-realtime-native', name: 'ava' } as const } : {}),
            ...session,
            inputAudioSamplingRate: session?.inputAudioSamplingRate ?? audioSampleRate as InputAudioSamplingRate,
          };
          const sessionConfig = isAgentModeRef.current
            ? buildAgentSessionConfig(initialSession)
            : buildSessionConfig(initialSession);

          console.log(`[${getTimestamp()}] Configuring session...`);
          sendEvent({
            type: 'session.update',
            session: sessionConfig,
          });
          break;
        }

        case 'session.updated':
          console.log(`[${getTimestamp()}] Session configured`);
          if (typeof data.session?.expires_at === 'number') setSessionExpiresAt(data.session.expires_at);
          if (data.session?.output_audio_format) {
            sessionOutputAudioFormatRef.current = data.session.output_audio_format;
            outputAudioFormatRef.current = data.session.output_audio_format;
          }

          if (transportRef.current === 'webrtc') break;

          // Set up WebRTC after session update (avatar mode)
          if (data.session?.avatar?.ice_servers && (data.session.avatar.output_protocol ?? session?.avatar?.outputProtocol) !== 'websocket' && !pcRef.current) {
            console.log(`[${getTimestamp()}] Setting up avatar WebRTC...`);

            const newConfig: RTCConfiguration = {
              iceServers: data.session.avatar.ice_servers,
            };
            const newPc = new RTCPeerConnection(newConfig);
            pcRef.current = newPc;

            // Handle incoming tracks
            newPc.ontrack = (event) => {
              if (event.track.kind === 'video') {
                console.log(`[${getTimestamp()}] Video stream connected`);
                setVideoStream(event.streams[0] || null);
              } else if (event.track.kind === 'audio') {
                console.log(`[${getTimestamp()}] Audio stream connected`);
                setAudioStream(event.streams[0] || null);
              }
            };

            // Log connection state changes
            newPc.oniceconnectionstatechange = () => {
              if (newPc.iceConnectionState === 'connected') {
                console.log(`[${getTimestamp()}] ICE connected`);
              } else if (newPc.iceConnectionState === 'failed') {
                console.log(`[${getTimestamp()}] ICE connection failed`);
                setError('ICE connection failed');
              }
            };

            newPc.onconnectionstatechange = () => {
              if (newPc.connectionState === 'connected') {
                console.log(`[${getTimestamp()}] WebRTC connected`);
              } else if (newPc.connectionState === 'failed') {
                console.log(`[${getTimestamp()}] WebRTC connection failed`);
                setError('WebRTC connection failed');
              }
            };

            newPc.onicecandidate = (event) => {
              if (!event.candidate) {
                console.log(`[${getTimestamp()}] ICE gathering complete`);
              }
            };

            // Add transceivers
            newPc.addTransceiver('video', { direction: 'recvonly' });
            newPc.addTransceiver('audio', { direction: 'recvonly' });

            // Create offer
            const offer = await newPc.createOffer();
            await newPc.setLocalDescription(offer);

            // Wait for ICE gathering
            await new Promise<void>((resolve) => {
              if (newPc.iceGatheringState === 'complete') {
                resolve();
              } else {
                newPc.addEventListener('icegatheringstatechange', () => {
                  if (newPc.iceGatheringState === 'complete') {
                    resolve();
                  }
                });
              }
            });

            // Send avatar connect event
            const localDesc = newPc.localDescription;
            if (localDesc) {
              const encodedSdp = btoa(JSON.stringify(localDesc));
              sendEvent({
                type: 'session.avatar.connect',
                client_sdp: encodedSdp,
              });
              console.log(`[${getTimestamp()}] Avatar connection request sent`);
            }
          } else if (!pcRef.current) {
            // Voice-only or raw WebSocket avatar output is ready immediately
            console.log(`[${getTimestamp()}] Voice-only session ready`);
            setIsReady(true);
            setSessionState('listening');
          }
          break;

        case 'session.avatar.connecting':
          if (data.server_sdp && pcRef.current) {
            const decodedSdp = atob(data.server_sdp);
            const remoteDesc = JSON.parse(decodedSdp);
            await pcRef.current.setRemoteDescription(remoteDesc);
            console.log(`[${getTimestamp()}] Avatar WebRTC established`);
            setIsReady(true);
            setSessionState('listening');
          }
          break;

        case 'response.created':
          outputAudioFormatRef.current = requestedOutputFormatsRef.current.shift() ?? sessionOutputAudioFormatRef.current;
          setSessionState('speaking');
          // Reset transcript accumulator for new response
          assistantTranscriptRef.current = '';
          // Track current response for interruption handling
          if (data.response?.id) {
            currentResponseIdRef.current = data.response.id;
            // Reset for new response (for viseme sync)
            isFirstChunkRef.current = true;
            responseStartTimeRef.current = null;
          }
          break;

        case 'input_audio_buffer.speech_started':
          console.log(`[${getTimestamp()}] User speaking (interrupting)...`);
          setSessionState('listening');
          // Microsoft's official pattern for WebSocket barge-in:
          // Stop client-side audio playback immediately
          // Server handles truncation with auto_truncate: true
          stopAudioPlayback();
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log(`[${getTimestamp()}] User stopped speaking`);
          setSessionState('thinking');
          break;

        case 'conversation.item.input_audio_transcription.completed':
          console.log(`[${getTimestamp()}] User said: "${data.transcript}"`);
          if (onTranscript && data.transcript) {
            onTranscript('user', data.transcript, true);
          }
          break;

        case 'response.audio.delta':
          // Play audio for voice-only mode (no avatar)
          // Only play if this is the current response (not interrupted)
          if (transportRef.current === 'websocket' && data.delta && !session?.avatar && data.response_id === currentResponseIdRef.current) {
            playAudioChunk(data.delta);
          }
          break;

        case 'response.audio_transcript.delta':
          if (onTranscript && data.delta) {
            assistantTranscriptRef.current += data.delta;
            onTranscript('assistant', assistantTranscriptRef.current, false);
          }
          break;

        case 'response.done':
          // Emit final assistant transcript if accumulated
          if (onTranscript && assistantTranscriptRef.current) {
            onTranscript('assistant', assistantTranscriptRef.current, true);
            assistantTranscriptRef.current = '';
          }
          setSessionState('listening');
          break;

        case 'response.audio_transcript.done':
          if (data.transcript) {
            console.log(`[${getTimestamp()}] Assistant: "${data.transcript}"`);
          }
          break;

        case 'response.function_call_arguments.done':
          if (toolExecutor) {
            toolExecutor(data.name, data.arguments, data.call_id);
          }
          break;

        case 'rtc.call.error':
        case 'error': {
          const errorCode = data.error?.code || '';
          const errorMessage = data.error?.message || 'Unknown API error';

          // Filter benign errors that occur during normal barge-in
          if (
            errorCode === 'response_cancel_not_active' ||
            errorMessage.toLowerCase().includes('no active response')
          ) {
            console.debug(`[${getTimestamp()}] Benign cancel error (ignored):`, errorMessage);
            break;
          }

          console.error(`[${getTimestamp()}] API Error:`, data.error);
          setError(errorMessage);
          break;
        }
      }
    },
    [onEvent, onTranscript, sendEvent, toolExecutor, playAudioChunk, stopAudioPlayback, session, audioSampleRate]
  );

  // Dispatch current callbacks without capturing stale React state in a long-lived transport.
  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  const setWebRTCAudioStream = useCallback((stream: MediaStream | null): void => {
    remoteAudioSourceRef.current?.disconnect();
    remoteAudioSourceRef.current = null;
    setAudioStream(stream);
    if (!stream) {
      audioAnalyserRef.current = null;
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context) void context.close().catch(() => {});
      return;
    }
    // Audio playback uses the remote stream directly; this branch is only for visualization.
    if (typeof AudioContext !== 'undefined') {
      try {
        const context = audioContextRef.current ?? new AudioContext({ latencyHint: 'interactive' });
        audioContextRef.current = context;
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;
        audioAnalyserRef.current = analyser;
        remoteAudioSourceRef.current = context.createMediaStreamSource(stream);
        remoteAudioSourceRef.current.connect(analyser);
        forceUpdate({});
      } catch (err) {
        console.warn('[VoiceLive] Audio visualization unavailable:', err);
      }
    }
  }, []);

  /**
   * Connect to Voice Live API
   */
  const connect = useCallback(async () => {
    if (voiceRTCRef.current || (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN)) return;
    const attempt = ++connectionAttemptRef.current;
    greetingSentRef.current = false;
    try {
      setError(null);
      setConnectionState('connecting');
      setSessionExpiresAt(null);
      sessionOutputAudioFormatRef.current = session?.outputAudioFormat ?? 'pcm16';
      outputAudioFormatRef.current = sessionOutputAudioFormatRef.current;
      requestedOutputFormatsRef.current = [];
      const { url: wsUrl, isAgentMode, transport } = buildConnectionUrl(connection);
      transportRef.current = transport;
      isAgentModeRef.current = isAgentMode;
      console.log(`[${getTimestamp()}] Connecting ${connection.proxyUrl ? 'via proxy' : 'to Voice Live API'}...`);
      console.log(`[${getTimestamp()}] URL: ${redactConnectionUrl(wsUrl)}`);

      if (transport === 'webrtc') {
        if (session?.avatar || session?.modalities?.includes('avatar')) {
          throw new Error('Voice Live does not support avatar configuration with WebRTC voice side-band control. Use transport: websocket for avatars.');
        }
        if (session?.inputAudioEchoCancellation?.referenceSource === 'client') {
          throw new Error('Client PCM echo-reference input is not supported with WebRTC media tracks. Use browser echoCancellation audio constraints.');
        }
        const model = new URL(wsUrl).searchParams.get('model') ?? connection.model;
        const initialSession: VoiceLiveSessionConfig = {
          ...(model === 'azure-realtime' && session?.voice === undefined
            ? { voice: { type: 'azure-realtime-native', name: 'ava' } as const } : {}),
          ...session,
        };
        const rtc = new VoiceLiveWebRTCTransport({
          url: wsUrl,
          session: isAgentMode ? buildAgentSessionConfig(initialSession) : buildSessionConfig(initialSession),
          autoStartMic,
          audioConstraints,
          ...connection.webRTC,
          onEvent: (event) => {
            if (voiceRTCRef.current !== rtc) return;
            void handleMessageRef.current(new MessageEvent('message', { data: JSON.stringify(event) }))
              .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to handle WebRTC event'));
          },
          onAudioStream: (stream) => {
            if (voiceRTCRef.current === rtc) setWebRTCAudioStream(stream);
          },
          onMicStateChange: (active, muted) => {
            if (voiceRTCRef.current !== rtc) return;
            setRTCMicActive(active);
            setRTCMuted(muted);
          },
          onStateChange: (state, failure) => {
            if (voiceRTCRef.current !== rtc) return;
            setConnectionState(state);
            setIsReady(state === 'connected');
            setSessionState(state === 'connected' ? 'listening' : 'idle');
            if (failure) setError(failure.message);
            if (state === 'error' || state === 'disconnected') {
              setRTCMicActive(false);
              setRTCMuted(false);
              setSessionExpiresAt(null);
              setWebRTCAudioStream(null);
              voiceRTCRef.current = null;
            }
          },
        });
        voiceRTCRef.current = rtc;
        await rtc.connect();
        return;
      }

      if (![8000, 16000, 24000].includes(audioSampleRate)) throw new Error('audioSampleRate must be 8000, 16000, or 24000 Hz.');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[${getTimestamp()}] WebSocket connected`);
        setConnectionState('connected');

        // Initialize AudioContext early on connection with optimal configuration
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext({
            latencyHint: 'interactive',
          });
          console.log(`[${getTimestamp()}] AudioContext created with sample rate: ${audioContextRef.current.sampleRate}Hz`);
          console.log(`[${getTimestamp()}] Base latency: ${(audioContextRef.current.baseLatency * 1000).toFixed(2)}ms`);

          // Create gain node for routing audio to multiple destinations
          audioGainRef.current = audioContextRef.current.createGain();
          audioGainRef.current.gain.value = 1.0;

          // Create analyser for visualization
          audioAnalyserRef.current = audioContextRef.current.createAnalyser();
          audioAnalyserRef.current.fftSize = 256;
          audioAnalyserRef.current.smoothingTimeConstant = 0.8;

          // Trigger component re-render to expose audioContext and audioAnalyser
          forceUpdate({});
        }

        // Create MediaStreamDestination only for voice-only mode (not avatar)
        if (!audioStreamDestinationRef.current && !session?.avatar && audioGainRef.current) {
          audioStreamDestinationRef.current = audioContextRef.current.createMediaStreamDestination();

          // Connect gain to both MediaStreamDestination (for playback) and analyser (for visualization)
          audioGainRef.current.connect(audioStreamDestinationRef.current);
          if (audioAnalyserRef.current) {
            audioGainRef.current.connect(audioAnalyserRef.current);
          }

          setAudioStream(audioStreamDestinationRef.current.stream);
          console.log(`[${getTimestamp()}] Audio visualization stream created`);
        }

        // Don't send session.update yet - wait for session.created from Azure
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error(`[${getTimestamp()}] WebSocket error:`, error);
        setError('WebSocket connection error');
        setConnectionState('error');
      };

      ws.onclose = (event) => {
        console.log(`[${getTimestamp()}] WebSocket closed - Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}, Clean: ${event.wasClean}`);
        if (!event.wasClean) {
          console.error(`[${getTimestamp()}] WebSocket closed unexpectedly!`);
        }
        setConnectionState('disconnected');
        setIsReady(false);
        setSessionExpiresAt(null);
        setSessionState('idle');
        stopMic();
        stopAudioPlayback();
      };
    } catch (err) {
      if (attempt !== connectionAttemptRef.current) return;
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect';
      console.error(`[${getTimestamp()}] Connection error:`, err);
      setError(errorMessage);
      setConnectionState('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connection,
    session,
    handleMessage,
    audioSampleRate,
    autoStartMic,
    audioConstraints,
    setWebRTCAudioStream,
    stopMic,
    stopAudioPlayback,
  ]);

  /**
   * Disconnect from Voice Live API
   */
  const disconnect = useCallback(() => {
    console.log(`[${getTimestamp()}] Disconnecting...`);
    connectionAttemptRef.current++;
    const rtc = voiceRTCRef.current;
    voiceRTCRef.current = null;
    rtc?.disconnect();
    setRTCMicActive(false);
    setRTCMuted(false);
    remoteAudioSourceRef.current?.disconnect();
    remoteAudioSourceRef.current = null;

    // Stop microphone capture
    stopMic();

    // Stop playback worklet
    if (playbackWorkletRef.current) {
      playbackWorkletRef.current.port.postMessage(null);
      playbackWorkletRef.current.disconnect();
      playbackWorkletRef.current = null;
    }
    playbackInitPromiseRef.current = null;
    playbackSourceRateRef.current = null;

    // Cleanup playback blob URL
    if (playbackBlobUrlRef.current) {
      URL.revokeObjectURL(playbackBlobUrlRef.current);
      playbackBlobUrlRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    audioStreamDestinationRef.current = null;
    audioAnalyserRef.current = null;
    audioGainRef.current = null;
    currentResponseIdRef.current = null;
    responseStartTimeRef.current = null;

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Close peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    setVideoStream(null);
    setAudioStream(null);
    setIsReady(false);
    setSessionExpiresAt(null);
    setSessionState('idle');
    setConnectionState('disconnected');
  }, [stopMic]);

  // Auto-connect if requested
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
  }, [autoConnect, connect]);

  // Auto-start microphone when session is ready
  useEffect(() => {
    if (transportRef.current === 'websocket' && isReady && autoStartMic && !captureActive) {
      console.log(`[${getTimestamp()}] Starting microphone...`);
      startMic().catch((err) => {
        console.error(`[${getTimestamp()}] Microphone error:`, err);
        setError(err instanceof Error ? err.message : 'Failed to start microphone');
      });
    }
  }, [isReady, autoStartMic, captureActive, startMic]);

  // Send proactive greeting when session is ready
  useEffect(() => {
    if (!isReady || !session?.greeting || greetingSentRef.current) return;
    // ICE recovery resumes the same session and must not greet a second time.
    greetingSentRef.current = true;

    const { type, text } = session.greeting;
    console.log(`[${getTimestamp()}] Sending proactive greeting (${type})...`);

    if (type === 'llm') {
      // LLM-generated greeting: add system message and trigger response
      sendEvent({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text }],
        },
      });
      sendEvent({
        type: 'response.create',
        event_id: `evt_llmgreeting_${Date.now()}`,
      });
    } else if (type === 'pregenerated') {
      // Pre-generated greeting: use preGeneratedAssistantMessage
      sendEvent({
        type: 'response.create',
        event_id: `evt_greeting_${Date.now()}`,
        response: {
          pre_generated_assistant_message: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text }],
          },
        },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  /**
   * Get current audio playback time in milliseconds
   * Used for synchronizing visemes with audio playback
   */
  const getAudioPlaybackTime = useCallback((): number | null => {
    if (!audioContextRef.current || responseStartTimeRef.current === null) {
      return null;
    }
    const elapsed = audioContextRef.current.currentTime - responseStartTimeRef.current;
    return Math.max(0, elapsed * 1000); // Convert to milliseconds
  }, []);

  return {
    connectionState,
    sessionState,
    sessionExpiresAt,
    videoStream,
    audioStream,
    audioContext: audioContextRef.current,
    audioAnalyser: audioAnalyserRef.current,
    isReady,
    isMicActive: transportRef.current === 'webrtc' ? rtcMicActive : captureActive,
    isMuted: transportRef.current === 'webrtc' ? rtcMuted : captureMuted,
    error,
    connect,
    disconnect,
    startMic,
    getMicrophoneStatus,
    stopMic,
    toggleMute,
    sendEvent,
    updateSession,
    createResponse,
    appendText,
    finishText,
    getAudioPlaybackTime,
  };
}
