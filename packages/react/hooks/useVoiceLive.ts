/**
 * useVoiceLive Hook - Comprehensive Implementation
 *
 * React hook for Microsoft Foundry Voice Live API with full parameter support.
 * Supports all Voice Live features with sensible defaults.
 *
 * @example
 * ```tsx
 * // Simple usage with defaults
 * const { connectionState, videoStream, connect } = useVoiceLive({
 *   connection: {
 *     resourceName: 'my-resource',
 *     apiKey: 'xxx',
 *   },
 * });
 *
 * // Advanced usage with full config
 * const api = useVoiceLive({
 *   connection: {
 *     resourceName: 'my-resource',
 *     apiKey: 'xxx',
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
} from '../types/voiceLive';
import { buildSessionConfig, buildAgentSessionConfig } from '../utils/sessionBuilder';
import { useAudioCapture } from './useAudioCapture';
import { arrayBufferToBase64 } from '../utils/audioHelpers';

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
 * Supports all Voice Live parameters with best-practice defaults
 */
export function useVoiceLive(config: UseVoiceLiveConfig): UseVoiceLiveReturn {
  const {
    connection,
    session,
    autoConnect = false,
    autoStartMic = true,
    audioSampleRate = 24000,
    audioConstraints,
    onEvent,
    toolExecutor,
  } = config;

  const [connectionState, setConnectionState] = useState<UseVoiceLiveReturn['connectionState']>('disconnected');
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [, forceUpdate] = useState({});

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const currentResponseIdRef = useRef<string | null>(null);
  const responseStartTimeRef = useRef<number | null>(null);
  const isFirstChunkRef = useRef<boolean>(true);
  const isAgentModeRef = useRef<boolean>(false);

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
    isCapturing: isMicActive,
    startCapture: startMic,
    stopCapture: stopMic,
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
      wsRef.current.send(JSON.stringify(event));
    } else {
      console.warn('WebSocket not connected, cannot send event:', event.type);
    }
  }, []);

  // Keep sendEventRef up to date
  useEffect(() => {
    sendEventRef.current = sendEvent;
  }, [sendEvent]);

  /**
   * Update session configuration
   */
  const updateSession = useCallback(
    (partialSession: Partial<typeof session>) => {
      const updatedSession = buildSessionConfig({
        ...session,
        ...partialSession,
      });

      sendEvent({
        type: 'session.update',
        session: updatedSession,
      });
    },
    [session, sendEvent]
  );

  /**
   * Stop all audio playback immediately (for interruptions/barge-in)
   * Following Microsoft's WebSocket interruption pattern
   */
  const stopAudioPlayback = useCallback(() => {
    // Stop all scheduled audio sources
    audioQueueRef.current.forEach((source) => {
      try {
        source.stop();
      } catch (e) {
        // Source may have already stopped naturally
      }
    });
    audioQueueRef.current = [];

    // Reset playback scheduling
    nextPlayTimeRef.current = 0;

    console.log(`[${getTimestamp()}] Audio playback stopped (user interruption)`);
  }, []);

  /**
   * Play audio chunk for voice-only mode with proper sequential scheduling
   * Following Microsoft Microsoft Foundry Voice Live API and OpenAI Realtime API patterns
   */
  const playAudioChunk = useCallback(async (base64Audio: string) => {
    try {
      // Initialize AudioContext with optimal configuration for real-time audio
      // latencyHint: "interactive" minimizes latency for real-time applications
      // Reference: W3C Web Audio API - https://www.w3.org/TR/webaudio/
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({
          latencyHint: 'interactive',
          // Let browser choose optimal sample rate (typically 48kHz)
        });
        nextPlayTimeRef.current = 0;
        console.log(`AudioContext created with sample rate: ${audioContextRef.current.sampleRate}Hz`);
        console.log(`Base latency: ${(audioContextRef.current.baseLatency * 1000).toFixed(2)}ms`);

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

      const audioContext = audioContextRef.current;

      // Resume AudioContext if suspended (browser autoplay policy)
      // Await resume to ensure context is in running state before scheduling audio
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log(`AudioContext resumed from suspended state. New state: ${audioContext.state}`);
      }

      // Decode base64 to PCM16 (following Microsoft's pattern)
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert PCM16 to Float32 for Web Audio API
      // PCM16 range: -32768 to 32767 → Float32 range: -1.0 to 1.0
      const pcm16 = new Int16Array(bytes.buffer);
      const float32Source = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        const sample = pcm16[i];
        if (sample !== undefined) {
          float32Source[i] = sample / 32768.0;
        }
      }

      // Resample from 24kHz (Azure) to AudioContext sample rate (typically 48kHz)
      // Using Lanczos-3 interpolation for professional audio quality
      // Reference: Web Audio API Best Practices - https://www.w3.org/TR/webaudio/
      const sourceSampleRate = 24000;
      const targetSampleRate = audioContext.sampleRate;
      const sampleRateRatio = targetSampleRate / sourceSampleRate;
      const outputLength = Math.ceil(float32Source.length * sampleRateRatio);
      const float32 = new Float32Array(outputLength);

      // Lanczos-3 kernel function for high-quality resampling
      const lanczosA = 3;
      const lanczosKernel = (x: number): number => {
        if (Math.abs(x) >= lanczosA) return 0;
        if (x === 0) return 1;
        const pi = Math.PI;
        const px = pi * x;
        const pa = px / lanczosA;
        return (Math.sin(px) * Math.sin(pa)) / (px * pa);
      };

      // Lanczos-3 resampling (professional audio quality)
      for (let i = 0; i < outputLength; i++) {
        const sourceIndex = i / sampleRateRatio;
        const centerIndex = Math.floor(sourceIndex);
        const fraction = sourceIndex - centerIndex;

        let interpolatedSample = 0;

        // Apply Lanczos kernel across 6 samples (3 on each side)
        for (let j = -lanczosA + 1; j <= lanczosA; j++) {
          const sampleIndex = centerIndex + j;
          if (sampleIndex >= 0 && sampleIndex < float32Source.length) {
            const distance = fraction - j;
            const sample = float32Source[sampleIndex];
            if (sample !== undefined) {
              interpolatedSample += sample * lanczosKernel(distance);
            }
          }
        }

        float32[i] = interpolatedSample;
      }

      // Create AudioBuffer at the AudioContext's sample rate
      const audioBuffer = audioContext.createBuffer(1, float32.length, targetSampleRate);
      audioBuffer.getChannelData(0).set(float32);

      // Calculate scheduled play time for sequential playback
      const currentTime = audioContext.currentTime;

      // Schedule audio playback with lookahead for first chunk to prevent glitches
      // 400ms scheduling window allows the audio pipeline to fully initialize
      // Reference: Web Audio API scheduling best practices
      let scheduleTime: number;
      if (isFirstChunkRef.current) {
        // First chunk: schedule 400ms ahead for smooth startup
        // Ensures AudioContext is fully running and pipeline is initialized
        scheduleTime = Math.max(currentTime + 0.4, nextPlayTimeRef.current);
        responseStartTimeRef.current = scheduleTime;
        isFirstChunkRef.current = false;
        console.log(`First chunk scheduled at +${((scheduleTime - currentTime) * 1000).toFixed(0)}ms (context state: ${audioContext.state})`);
      } else {
        // Subsequent chunks: continuous scheduling for gapless playback
        scheduleTime = Math.max(currentTime, nextPlayTimeRef.current);
      }

      // Create and schedule audio source
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Connect audio source to appropriate destination
      // Voice-only mode: route through gain node to enable visualization
      // Fallback: connect directly to audio destination
      if (audioGainRef.current) {
        source.connect(audioGainRef.current);
      } else {
        source.connect(audioContext.destination);
      }

      source.start(scheduleTime);

      // Update next play time to maintain continuous playback without gaps
      nextPlayTimeRef.current = scheduleTime + audioBuffer.duration;

      // Track for cleanup
      audioQueueRef.current.push(source);
    } catch (err) {
      console.error('Error playing audio chunk:', err);
    }
  }, [forceUpdate]);

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

          // Send session.update immediately after session.created
          // Don't start audio capture until session is configured
          const sessionConfig = isAgentModeRef.current
            ? buildAgentSessionConfig(session)
            : buildSessionConfig(session);

          console.log(`[${getTimestamp()}] Configuring session...`);
          sendEvent({
            type: 'session.update',
            session: sessionConfig,
          });
          break;
        }

        case 'session.updated':
          console.log(`[${getTimestamp()}] Session configured`);

          // Set up WebRTC after session update (avatar mode)
          if (data.session?.avatar?.ice_servers) {
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
          } else {
            // Voice-only mode (no avatar) - session is ready immediately
            console.log(`[${getTimestamp()}] Voice-only session ready`);
            setIsReady(true);
          }
          break;

        case 'session.avatar.connecting':
          if (data.server_sdp && pcRef.current) {
            const decodedSdp = atob(data.server_sdp);
            const remoteDesc = JSON.parse(decodedSdp);
            await pcRef.current.setRemoteDescription(remoteDesc);
            console.log(`[${getTimestamp()}] Avatar WebRTC established`);
            setIsReady(true);
          }
          break;

        case 'response.created':
          // Track current response for interruption handling
          if (data.response?.id) {
            currentResponseIdRef.current = data.response.id;
            // Reset for new response (for viseme sync and audio scheduling)
            isFirstChunkRef.current = true;
            responseStartTimeRef.current = null;
            // Reset audio scheduling to play immediately
            nextPlayTimeRef.current = audioContextRef.current?.currentTime || 0;
          }
          break;

        case 'input_audio_buffer.speech_started':
          console.log(`[${getTimestamp()}] User speaking (interrupting)...`);
          // Microsoft's official pattern for WebSocket barge-in:
          // Stop client-side audio playback immediately
          // Server handles truncation with auto_truncate: true
          stopAudioPlayback();
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log(`[${getTimestamp()}] User stopped speaking`);
          break;

        case 'conversation.item.input_audio_transcription.completed':
          console.log(`[${getTimestamp()}] User said: "${data.transcript}"`);
          break;

        case 'response.audio.delta':
          // Play audio for voice-only mode (no avatar)
          // Only play if this is the current response (not interrupted)
          if (data.delta && !videoStream && data.response_id === currentResponseIdRef.current) {
            playAudioChunk(data.delta);
          }
          break;

        case 'response.audio.done':
          // Reset playback scheduling for next response
          // Use current AudioContext time instead of 0 to avoid scheduling issues
          if (data.response_id === currentResponseIdRef.current) {
            nextPlayTimeRef.current = audioContextRef.current?.currentTime || 0;
          }
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

        case 'error':
          console.error(`[${getTimestamp()}] API Error:`, data.error);
          setError(data.error?.message || 'Unknown API error');
          break;
      }
    },
    [onEvent, sendEvent, toolExecutor, playAudioChunk, stopAudioPlayback, videoStream, session]
  );

  /**
   * Connect to Voice Live API
   */
  const connect = useCallback(async () => {
    try {
      setError(null);
      setConnectionState('connecting');

      // Build WebSocket URL
      let wsUrl: string;
      let isAgentMode = false;

      // Proxy mode: use proxy URL if provided
      if (connection.proxyUrl) {
        wsUrl = connection.proxyUrl;
        // Detect agent mode from URL parameters (agentId or projectName presence)
        // Mode is auto-detected by proxy, but we check here for logging
        isAgentMode = wsUrl.includes('agentId=') || wsUrl.includes('projectName=');
        isAgentModeRef.current = isAgentMode;
        console.log(`[${getTimestamp()}] Connecting via proxy...`);
        console.log(`[${getTimestamp()}] URL: ${wsUrl.replace(/token=[^&]+/, 'token=***')}`);
        console.log(`[${getTimestamp()}] Mode: ${isAgentMode ? 'Agent Service (auto-detected)' : 'Standard (Voice/Avatar)'}`);
      } else {
        // Direct connection mode
        const projectIdentifier = connection.projectName || connection.projectId;
        isAgentMode = !!(connection.agentId && projectIdentifier);
        isAgentModeRef.current = isAgentMode;

        if (isAgentMode) {
          // Agent Service mode - per Azure docs: use agent-id and agent-project-name
          wsUrl = `wss://${connection.resourceName}.services.ai.azure.com/voice-live/realtime?api-version=${
            connection.apiVersion || '2025-10-01'
          }&agent-id=${connection.agentId}&agent-project-name=${projectIdentifier}`;

          // Agent Service authentication: ONLY agent-access-token query parameter
          // Note: API key auth is explicitly NOT supported in Agent mode (server returns error)
          // Browser limitation: Can't set Authorization header, so token must go in query param
          if (connection.agentAccessToken) {
            wsUrl += `&agent-access-token=${encodeURIComponent(connection.agentAccessToken)}`;
          } else {
            throw new Error('agentAccessToken is required for Agent Service mode.');
          }
        } else {
          // Standard mode with model
          const model = connection.model || 'gpt-realtime'; // Default to best quality
          wsUrl = `wss://${connection.resourceName}.services.ai.azure.com/voice-live/realtime?api-version=${
            connection.apiVersion || '2025-10-01'
          }&model=${model}`;

          // Standard mode authentication: use api-key
          if (connection.apiKey) {
            wsUrl += `&api-key=${encodeURIComponent(connection.apiKey)}`;
          }
          // Note: Token auth via Authorization header would need different WebSocket setup
        }

        console.log(`[${getTimestamp()}] Connecting to Voice Live API...`);
        console.log(`[${getTimestamp()}] URL: ${wsUrl.replace(/api-key=[^&]+/, 'api-key=***').replace(/agent-access-token=[^&]+/, 'agent-access-token=***')}`);
        if (isAgentMode) {
          console.log(`[${getTimestamp()}] Agent: ${connection.agentId}, Project: ${projectIdentifier}`);
        } else {
          console.log(`[${getTimestamp()}] Model: ${connection.model || 'gpt-realtime'}`);
        }
      }

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
      };
    } catch (err) {
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
  ]);

  /**
   * Disconnect from Voice Live API
   */
  const disconnect = useCallback(() => {
    console.log(`[${getTimestamp()}] Disconnecting...`);

    // Stop microphone capture
    stopMic();

    // Stop any playing audio
    audioQueueRef.current.forEach((source) => {
      try {
        source.stop();
      } catch (e) {
        // Ignore if already stopped
      }
    });
    audioQueueRef.current = [];

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    nextPlayTimeRef.current = 0;

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
    if (isReady && autoStartMic && !isMicActive) {
      console.log(`[${getTimestamp()}] Starting microphone...`);
      startMic().catch((err) => {
        console.error(`[${getTimestamp()}] Microphone error:`, err);
      });
    }
  }, [isReady, autoStartMic, isMicActive, startMic]);

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
    videoStream,
    audioStream,
    audioContext: audioContextRef.current,
    audioAnalyser: audioAnalyserRef.current,
    isReady,
    isMicActive,
    error,
    connect,
    disconnect,
    startMic,
    stopMic,
    sendEvent,
    updateSession,
    getAudioPlaybackTime,
  };
}
