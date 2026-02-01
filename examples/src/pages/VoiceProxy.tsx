import { useRef, useEffect, useState } from 'react';
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, ControlGroup, ErrorPanel } from '../components';

export function VoiceProxy(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);

  const config = createVoiceLiveConfig({
    connection: {
      // Proxy mode: API key secured in backend
      // Mode is auto-detected (standard mode - no agentId/projectName)
      proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime',
    },
    session: {
      instructions: 'You are a helpful assistant. Keep responses brief.',
    },
  });

  // Voice Live hook - mic capture is integrated and auto-starts!
  const { connect, disconnect, connectionState, audioStream } = useVoiceLive(config);

  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  const handleStart = async (): Promise<void> => {
    console.log('Starting...');
    try {
      setError(null);
      await connect();
      console.log('Connected - mic will auto-start when session ready');
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
      title="Voice Chat - Secure Proxy (API Key)"
      description="Voice conversation using a secure proxy server. API keys are safely stored on the backend."
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
