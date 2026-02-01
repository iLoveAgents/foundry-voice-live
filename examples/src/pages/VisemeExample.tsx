import { useState, useRef, useEffect, useCallback } from 'react';
import { useVoiceLive, createVoiceLiveConfig, withViseme } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, Section, ControlGroup, ErrorPanel } from '../components';

interface VisemeData {
  viseme_id: number;
  audio_offset_ms: number;
}

export function VisemeExample(): JSX.Element {
  const [currentViseme, setCurrentViseme] = useState<number | null>(null);
  const [visemeHistory, setVisemeHistory] = useState<Array<{viseme: number, offset: number}>>([]);
  const [error, setError] = useState<string | null>(null);
  const visemeBufferRef = useRef<VisemeData[]>([]);
  const animationFrameRef = useRef<number>();
  const audioRef = useRef<HTMLAudioElement>(null);

  // Enable viseme output
  // IMPORTANT: Visemes only work with Azure STANDARD voices (not HD or OpenAI voices)
  const config = createVoiceLiveConfig({
    connection: {
      resourceName: import.meta.env.VITE_AZURE_AI_FOUNDRY_RESOURCE,
      apiKey: import.meta.env.VITE_AZURE_SPEECH_KEY,
    },
    session: withViseme({
      instructions: 'You are a helpful assistant. Always respond in English. Keep responses brief.',
      voice: {
        name: 'en-US-AvaNeural', // Standard voice (HD voices don't support viseme)
        type: 'azure-standard',
      },
    }),
  });

  const { connect, disconnect, connectionState, getAudioPlaybackTime, audioStream } = useVoiceLive({
    ...config,
    onEvent: useCallback((event: { type: string; viseme_id?: number; audio_offset_ms?: number }) => {
      if (event.type === 'response.animation_viseme.delta' && event.viseme_id !== undefined && event.audio_offset_ms !== undefined) {
        const visemeId = event.viseme_id;
        const audioOffset = event.audio_offset_ms;
        // Buffer viseme events for synchronized playback
        visemeBufferRef.current.push({
          viseme_id: visemeId,
          audio_offset_ms: audioOffset,
        });
        setVisemeHistory(prev => [...prev.slice(-20), { viseme: visemeId, offset: audioOffset }]);
      }
      if (event.type === 'response.created') {
        // Clear buffer for new response
        visemeBufferRef.current = [];
      }
    }, []),
  });

  // Connect audio stream to audio element
  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  // Synchronize viseme display with audio playback
  useEffect(() => {
    const syncVisemes = (): void => {
      const currentTime = getAudioPlaybackTime();

      if (currentTime !== null && visemeBufferRef.current.length > 0) {
        // Find the viseme that should be displayed at the current playback time
        // We want the most recent viseme that has already occurred
        let activeViseme: VisemeData | null = null;

        for (const viseme of visemeBufferRef.current) {
          if (viseme.audio_offset_ms <= currentTime) {
            activeViseme = viseme;
          } else {
            break; // Visemes are in chronological order
          }
        }

        if (activeViseme && activeViseme.viseme_id !== currentViseme) {
          setCurrentViseme(activeViseme.viseme_id);
        }
      }

      animationFrameRef.current = requestAnimationFrame(syncVisemes);
    };

    syncVisemes();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [getAudioPlaybackTime, currentViseme]);

  const handleStart = async (): Promise<void> => {
    try {
      setError(null);
      await connect();
      setVisemeHistory([]);
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

  // Viseme to mouth shape mapping (simplified)
  const getVisemeName = (id: number): string => {
    const visemes: { [key: number]: string } = {
      0: 'Silence',
      1: 'AE/AX/AH',
      2: 'AA',
      3: 'AO',
      4: 'EY/EH/UH',
      5: 'ER',
      6: 'Y/IY/IH/IX',
      7: 'W/UW',
      8: 'OW',
      9: 'AW',
      10: 'OY',
      11: 'AY',
      12: 'H',
      13: 'R',
      14: 'L',
      15: 'S/Z',
      16: 'SH/CH/JH/ZH',
      17: 'TH/DH',
      18: 'F/V',
      19: 'D/T/N',
      20: 'K/G/NG',
      21: 'P/B/M',
    };
    return visemes[id] || 'Unknown';
  };

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="Viseme Data for Custom Avatars"
      description="Demonstrates real-time viseme (mouth shape) data synchronized with audio playback. Only works with Azure Standard voices."
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

      <Section>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Current Viseme</h3>
        <div style={{
          background: '#f5f5f5',
          padding: '40px',
          borderRadius: '8px',
          textAlign: 'center',
          border: '2px solid #ddd',
          minHeight: '200px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}>
          {currentViseme !== null ? (
            <>
              <div style={{ fontSize: '48px', fontWeight: 'bold', color: '#0078d4' }}>
                {currentViseme}
              </div>
              <div style={{ fontSize: '18px', marginTop: '10px', color: '#666' }}>
                {getVisemeName(currentViseme)}
              </div>
            </>
          ) : (
            <div style={{ color: '#999' }}>No viseme data yet...</div>
          )}
        </div>
      </Section>

      <Section>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Viseme History</h3>
        <div style={{
          background: '#1e1e1e',
          color: '#d4d4d4',
          padding: '15px',
          borderRadius: '6px',
          maxHeight: '200px',
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '12px',
        }}>
          {visemeHistory.length === 0 ? (
            <div style={{ color: '#888' }}>No visemes yet... Start talking!</div>
          ) : (
            visemeHistory.map((v, i) => (
              <div key={i}>
                [{v.offset}ms] Viseme {v.viseme} ({getVisemeName(v.viseme)})
              </div>
            ))
          )}
        </div>
      </Section>


      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
