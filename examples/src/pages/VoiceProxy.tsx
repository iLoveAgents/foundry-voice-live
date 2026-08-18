import { useRef, useEffect, useState } from 'react';
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, ControlGroup, ErrorPanel, TextInput } from '../components';
import { proxyWsUrl } from '../lib/connection';

export function VoiceProxy(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);

  const config = createVoiceLiveConfig({
    connection: {
      // Proxy mode: API key secured in backend (VITE_BACKEND_PROXY_URL, default ws://localhost:8080)
      // Mode is auto-detected (standard mode - no agentName/projectName)
      proxyUrl: proxyWsUrl({ model: 'gpt-realtime' }),
    },
    session: {
      instructions: 'You are a helpful assistant. Keep responses brief.',
    },
    // Auto-reconnect after network drops / proxy restarts (exponential backoff, 5 attempts)
    reconnect: true,
    onReconnecting: (attempt, delayMs) => console.log(`Reconnecting (attempt ${attempt}) in ${delayMs} ms`),
    onReconnected: () => console.log('Reconnected'),
    logLevel: 'debug',
  });

  // Voice Live hook - mic capture is integrated and auto-starts!
  const { connect, disconnect, connectionState, reconnectAttempt, audioStream, sendText, error: hookError } =
    useVoiceLive(config);

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
  const isActive = isConnected || connectionState === 'reconnecting';

  return (
    <SampleLayout
      title="Voice Chat - Secure Proxy (API Key)"
      description="Voice conversation using a secure proxy server. API keys are safely stored on the backend."
    >
      <ErrorPanel error={error || hookError} />

      <StatusBadge
        status={connectionState === 'reconnecting' ? `reconnecting (attempt ${reconnectAttempt})` : connectionState}
      />

      <ControlGroup>
        <button onClick={handleStart} disabled={isActive}>
          Start Conversation
        </button>
        <button onClick={handleStop} disabled={!isActive}>
          Stop
        </button>
      </ControlGroup>

      {isConnected && <TextInput onSend={sendText} />}

      <p style={{ fontSize: '14px' }}>
        This page enables <code>reconnect: true</code> — restart the proxy while connected and watch the
        status go through <code>reconnecting</code> back to <code>connected</code>.
      </p>

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
