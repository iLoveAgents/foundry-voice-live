import { useRef, useEffect, useState } from 'react';
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, Section, ControlGroup, ErrorPanel } from '../components';

export function AudioVisualizer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animationFrameRef = useRef<number>();
  const [error, setError] = useState<string | null>(null);

  const config = createVoiceLiveConfig({
    connection: {
      resourceName: import.meta.env.VITE_AZURE_AI_FOUNDRY_RESOURCE,
      apiKey: import.meta.env.VITE_AZURE_SPEECH_KEY,
    },
    session: {
      instructions: 'You are a helpful assistant. Keep responses brief.',
    },
  });

  const { connect, disconnect, connectionState, audioStream, audioAnalyser } = useVoiceLive(config);

  // Connect audio stream to audio element for playback
  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  // Audio visualization using pre-configured analyser from the hook
  useEffect(() => {
    if (!audioAnalyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use the pre-configured analyser - no manual setup needed!
    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Draw visualization
    const draw = (): void => {
      animationFrameRef.current = requestAnimationFrame(draw);

      audioAnalyser.getByteTimeDomainData(dataArray);

      // Clear canvas
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw waveform
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0078d4';
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray?.[i] ?? 0) / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [audioAnalyser]);

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
      title="Audio Visualizer"
      description="Real-time audio waveform visualization using Web Audio API. Shows the audio output stream from the assistant."
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
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Audio Waveform</h3>
        <canvas
          ref={canvasRef}
          width={800}
          height={300}
          style={{
            border: '1px solid #ddd',
            borderRadius: '8px',
            background: '#1e1e1e',
            width: '100%',
            maxWidth: '800px',
          }}
        />
      </Section>

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
