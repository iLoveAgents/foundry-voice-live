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
import { directOrProxyConnection } from '../lib/connection';

export function AvatarBasic(): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const { connect, disconnect, connectionState, videoStream, audioStream } = useVoiceLive({
    // Direct with the dev API key when configured, otherwise through the proxy (keyless)
    connection: directOrProxyConnection(),
    session: sessionConfig()
      .instructions('You are a helpful assistant. Keep responses brief.')
      .hdVoice('en-US-Ava:DragonHDLatestNeural')
      .avatar('lisa', 'casual-sitting', { codec: 'h264' })
      .build(),
    logLevel: 'debug',
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
