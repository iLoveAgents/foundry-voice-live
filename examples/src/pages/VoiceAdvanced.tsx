import { useRef, useEffect, useState } from 'react';
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, ControlGroup, ErrorPanel } from '../components';

export function VoiceAdvanced(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Advanced configuration using the sessionConfig builder
  const { connect, disconnect, connectionState, audioStream } = useVoiceLive({
    connection: {
      resourceName: import.meta.env.VITE_FOUNDRY_RESOURCE_NAME,
      apiKey: import.meta.env.VITE_FOUNDRY_API_KEY,
    },
    session: sessionConfig({ temperature: 0.8 })
      .instructions('You are a helpful assistant. Keep responses brief and friendly.')
      .hdVoice('en-US-Ava:DragonHDLatestNeural', { temperature: 0.9, rate: '1.1' })
      .semanticVAD({
        removeFillerWords: true,
        interruptResponse: true,
        autoTruncate: true,
      })
      .sampleRate(24000)
      .echoCancellation()
      .noiseReduction()
      .build(),
  });

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
