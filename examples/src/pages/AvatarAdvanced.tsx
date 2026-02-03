import { useState } from 'react';
import {
  useVoiceLive,
  VoiceLiveAvatar,
  sessionConfig,
} from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  Section,
  ControlGroup,
  ErrorPanel,
  AvatarContainer,
} from '../components';

export function AvatarAdvanced(): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const { connect, disconnect, connectionState, videoStream, audioStream } = useVoiceLive({
    connection: {
      resourceName: import.meta.env.VITE_FOUNDRY_RESOURCE_NAME,
      apiKey: import.meta.env.VITE_FOUNDRY_API_KEY,
    },
    session: sessionConfig()
      .instructions('You are a helpful assistant.')
      .hdVoice('en-US-Ava:DragonHDLatestNeural', { temperature: 0.9, rate: '0.95' })
      .avatar('lisa', 'casual-sitting', {
        codec: 'h264',
        resolution: { width: 1920, height: 1080 },
        bitrate: 2000000,
      })
      .transparentBackground()
      .semanticVAD({
        removeFillerWords: true,
        interruptResponse: true,
        autoTruncate: true,
      })
      .echoCancellation()
      .noiseReduction()
      .build(),
  });

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
        <AvatarContainer variant="gradient">
          <VoiceLiveAvatar
            videoStream={videoStream}
            audioStream={audioStream}
            transparentBackground
            loadingMessage="Avatar will appear here when connected"
          />
        </AvatarContainer>
      </Section>
    </SampleLayout>
  );
}
