import { useRef, useEffect, useState } from 'react';
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  ControlGroup,
  ErrorPanel,
  TranscriptPanel,
  TextInput,
} from '../components';
import { sessionStateLabel } from '../lib/sessionState';
import { useTranscripts } from '../lib/useTranscripts';
import { directOrProxyConnection } from '../lib/connection';

export function VoiceAdvanced(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Accumulates partial and final transcripts
  const { transcripts, onTranscript, clear: clearTranscripts } = useTranscripts();

  // Advanced configuration using the sessionConfig builder
  const {
    connect,
    disconnect,
    connectionState,
    sessionState,
    audioStream,
    isMuted,
    toggleMute,
    sendText,
  } = useVoiceLive({
    // Direct with the dev API key when configured, otherwise through the proxy (keyless)
    connection: directOrProxyConnection(),
    session: sessionConfig({ temperature: 0.8 })
      .instructions('You are a helpful assistant. Keep responses brief and friendly.')
      .hdVoice('en-US-Ava:DragonHDLatestNeural', { temperature: 0.9 })
      .semanticVAD({
        removeFillerWords: true,
        interruptResponse: true,
        autoTruncate: true,
      })
      .sampleRate(24000)
      .echoCancellation()
      .noiseReduction()
      .greeting({
        type: 'llm',
        text: 'Greet the user warmly in English and ask how you can help today.',
      })
      .build(),
    onTranscript,
    logLevel: 'debug',
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
      clearTranscripts();
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
      description="Advanced VAD configuration with echo cancellation, noise suppression, filler word removal, barge-in support, mute toggle, session state, proactive greeting, and live transcripts."
    >
      <ErrorPanel error={error} />

      <StatusBadge status={connectionState} />

      {isConnected && (
        <p style={{ margin: '0.5rem 0', fontStyle: 'italic' }}>{sessionStateLabel(sessionState)}</p>
      )}

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected}>
          Start Conversation
        </button>
        <button onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
        {isConnected && <button onClick={toggleMute}>{isMuted ? 'Unmute' : 'Mute'}</button>}
      </ControlGroup>

      <TextInput onSend={sendText} disabled={!isConnected} />
      <TranscriptPanel transcripts={transcripts} />

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
