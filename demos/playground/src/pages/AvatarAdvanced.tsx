import { useState } from 'react';
import { useVoiceLive, VoiceLiveAvatar, createVoiceLiveConfig, withTransparentBackground } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, Section, ControlGroup, ErrorPanel } from '../components';

export function AvatarAdvanced(): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const config = createVoiceLiveConfig({
    connection: {
      resourceName: import.meta.env.VITE_AZURE_AI_FOUNDRY_RESOURCE,
      apiKey: import.meta.env.VITE_AZURE_SPEECH_KEY,
    },
    session: withTransparentBackground({
      avatar: {
        character: 'lisa',
        style: 'casual-sitting',
        video: {
          codec: 'h264',
          resolution: { width: 1920, height: 1080 },
          bitrate: 2000000,
        },
      },
      voice: {
        name: 'en-US-Ava:DragonHDLatestNeural',
        type: 'azure-standard',
        temperature: 0.9,
        rate: '0.95',
      },
      turnDetection: {
        type: 'azure_semantic_vad',
        interruptResponse: true,
        autoTruncate: true,
        removeFillerWords: true,
        createResponse: true,
      },
      inputAudioNoiseReduction: {
        type: 'azure_deep_noise_suppression',
      },
      inputAudioEchoCancellation: {
        type: 'server_echo_cancellation',
      },
    })
  });

  // Voice Live hook - mic capture is integrated and auto-starts!
  const { connect, disconnect, connectionState, videoStream, audioStream } = useVoiceLive(config);

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

  return (
    <SampleLayout
      title="Advanced Avatar"
      description="High-resolution avatar with transparent background removal (chroma key), semantic VAD, barge-in, and advanced audio processing."
    >
      <ErrorPanel error={error} />

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button onClick={handleStart} disabled={connectionState === 'connected'}>
          Start Avatar
        </button>
        <button onClick={handleStop} disabled={connectionState !== 'connected'}>
          Stop
        </button>
      </ControlGroup>

      <Section>
        <div style={{
          width: '100%',
          maxWidth: '800px',
          height: '450px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', // Gradient shows transparency
          borderRadius: '8px',
          overflow: 'hidden',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <VoiceLiveAvatar
            videoStream={videoStream}
            audioStream={audioStream}
            transparentBackground
            loadingMessage="Avatar will appear here when connected"
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </Section>
    </SampleLayout>
  );
}
