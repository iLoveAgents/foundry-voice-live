import { useRef, useEffect, useState, useCallback } from 'react';
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, ControlGroup, ErrorPanel } from '../components';

interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  isFinal: boolean;
}

export function VoiceAdvanced(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  // Transcript callback - accumulates partial and final transcripts
  const handleTranscript = useCallback(
    (role: 'user' | 'assistant', text: string, isFinal: boolean) => {
      setTranscripts((prev) => {
        // Update last entry if same role and not final
        const last = prev[prev.length - 1];
        if (last && last.role === role && !last.isFinal) {
          return [...prev.slice(0, -1), { role, text, isFinal }];
        }
        return [...prev, { role, text, isFinal }];
      });
    },
    []
  );

  // Advanced configuration using the sessionConfig builder
  const {
    connect,
    disconnect,
    connectionState,
    sessionState,
    audioStream,
    isMuted,
    toggleMute,
  } = useVoiceLive({
    connection: {
      resourceName: import.meta.env.VITE_FOUNDRY_RESOURCE_NAME,
      apiKey: import.meta.env.VITE_FOUNDRY_API_KEY,
    },
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
      .greeting({ type: 'llm', text: 'Greet the user warmly in English and ask how you can help today.' })
      .build(),
    onTranscript: handleTranscript,
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
      setTranscripts([]);
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

  // Map session state to a display label
  const sessionStateLabel: Record<string, string> = {
    idle: 'Idle',
    listening: 'Listening...',
    thinking: 'Thinking...',
    speaking: 'Speaking...',
  };

  return (
    <SampleLayout
      title="Advanced Voice Chat"
      description="Advanced VAD configuration with echo cancellation, noise suppression, filler word removal, barge-in support, mute toggle, session state, proactive greeting, and live transcripts."
    >
      <ErrorPanel error={error} />

      <StatusBadge status={connectionState} />

      {isConnected && (
        <p style={{ margin: '0.5rem 0', fontStyle: 'italic' }}>
          {sessionStateLabel[sessionState] || sessionState}
        </p>
      )}

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected}>
          Start Conversation
        </button>
        <button onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
        {isConnected && (
          <button onClick={toggleMute}>
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
        )}
      </ControlGroup>

      {transcripts.length > 0 && (
        <div style={{ marginTop: '1rem', maxHeight: '300px', overflowY: 'auto' }}>
          <h3>Transcript</h3>
          {transcripts.map((entry, i) => (
            <p
              key={i}
              style={{
                color: entry.role === 'user' ? '#2196F3' : '#4CAF50',
                opacity: entry.isFinal ? 1 : 0.6,
                margin: '0.25rem 0',
              }}
            >
              <strong>{entry.role === 'user' ? 'You' : 'Assistant'}:</strong> {entry.text}
            </p>
          ))}
        </div>
      )}

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
