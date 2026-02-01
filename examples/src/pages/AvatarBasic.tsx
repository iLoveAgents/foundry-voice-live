import { useState } from 'react';
import {
  useVoiceLive,
  VoiceLiveAvatar,
  createVoiceLiveConfig,
  withAvatar,
} from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  Section,
  ControlGroup,
  ErrorPanel,
  AvatarContainer,
} from '../components';

export function AvatarBasic(): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const config = createVoiceLiveConfig({
    connection: {
      resourceName: import.meta.env.VITE_AZURE_AI_FOUNDRY_RESOURCE,
      apiKey: import.meta.env.VITE_AZURE_SPEECH_KEY,
    },
    session: withAvatar(
      'lisa',
      'casual-sitting',
      { codec: 'h264' },
      {
        instructions: 'You are a helpful assistant. Keep responses brief.',
        voice: {
          name: 'en-US-Ava:DragonHDLatestNeural',
          type: 'azure-standard',
        },
      }
    ),
  });

  const { connect, disconnect, connectionState, videoStream, audioStream } =
    useVoiceLive(config);

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
      title="Basic Avatar"
      description="Simple avatar with video stream rendering using the VoiceLiveAvatar component. Character: lisa, style: casual-sitting."
    >
      <ErrorPanel error={error} />

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected}>
          Start Avatar
        </button>
        <button onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
      </ControlGroup>

      <Section>
        <AvatarContainer>
          <VoiceLiveAvatar
            videoStream={videoStream}
            audioStream={audioStream}
            transparentBackground={false}
            loadingMessage="Avatar will appear here when connected"
          />
        </AvatarContainer>
      </Section>
    </SampleLayout>
  );
}
