import { useRef, useEffect, useState } from 'react';
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, ControlGroup, ErrorPanel } from '../components';

export function VoiceAdvanced(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Advanced configuration with all major options
  const config = createVoiceLiveConfig({
    connection: {
      resourceName: import.meta.env.VITE_FOUNDRY_RESOURCE_NAME,
      apiKey: import.meta.env.VITE_FOUNDRY_API_KEY,
    },
    session: {
      instructions: 'You are a helpful assistant. Keep responses brief and friendly.',
      temperature: 0.8,

      // Voice configuration
      voice: {
        name: 'en-US-Ava:DragonHDLatestNeural',
        type: 'azure-standard',
        temperature: 0.9,
        rate: '1.1',
      },

      // Advanced turn detection with Azure Semantic VAD
      turnDetection: {
        type: 'azure_semantic_vad',
        threshold: 0.5,
        prefixPaddingMs: 300,
        silenceDurationMs: 500,
        removeFillerWords: true, // Remove "um", "uh", etc.
        interruptResponse: true,  // Enable barge-in
        autoTruncate: true,       // Auto-truncate on interrupt
        createResponse: true,
      },

      // Input audio enhancements
      inputAudioSamplingRate: 24000,
      inputAudioEchoCancellation: {
        type: 'server_echo_cancellation',
      },
      inputAudioNoiseReduction: {
        type: 'azure_deep_noise_suppression',
      },
    },
  });

  const { connect, disconnect, connectionState, audioStream } = useVoiceLive(config);

  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  const handleStart = async (): Promise<void> => {
    try {
      setError(null);
      await connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start';
      setError(message);
      console.error('Start error:', err);
    }
  };

  const handleStop = (): void => {
    disconnect();
    setError(null);
  };

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="Advanced Voice Chat"
      description="Advanced VAD configuration with echo cancellation, noise suppression, filler word removal, and barge-in support."
    >
      <ErrorPanel error={error} />

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected}>
          Start Conversation
        </button>
        <button onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
      </ControlGroup>

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
