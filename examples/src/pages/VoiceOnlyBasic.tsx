import { useRef, useEffect, useState } from 'react';
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, ControlGroup, ErrorPanel } from '../components';

/**
 * VoiceOnlyBasic - Simple voice chat example
 *
 * Demonstrates basic voice-only conversation with Microsoft Foundry Voice Live API.
 * Microphone automatically starts when the session is ready (autoStartMic: true by default).
 * No need to manually manage audio capture!
 */
export function VoiceOnlyBasic(): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  // Create Voice Live configuration
  const config = createVoiceLiveConfig({
    connection: {
      resourceName: import.meta.env.VITE_AZURE_AI_FOUNDRY_RESOURCE,
      apiKey: import.meta.env.VITE_AZURE_SPEECH_KEY,
    }
  });

  // Voice Live hook - mic capture is integrated and auto-starts!
  const { connect, disconnect, connectionState, audioStream } = useVoiceLive(config);

  // Ref for audio playback
  const audioRef = useRef<HTMLAudioElement>(null);

  // Set up audio playback when stream becomes available
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
      title="Basic Voice Chat"
      description="Simple voice conversation with auto-start microphone and minimal configuration."
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

      {/* Hidden audio element for playing assistant responses */}
      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
