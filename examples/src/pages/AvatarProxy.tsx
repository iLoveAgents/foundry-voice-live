import { useState } from 'react';
import {
  useVoiceLive,
  VoiceLiveAvatar,
  createVoiceLiveConfig,
} from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  Section,
  ControlGroup,
  ErrorPanel,
  AvatarContainer,
} from '../components';

export function AvatarProxy(): JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const config = createVoiceLiveConfig({
    connection: {
      // Proxy mode: API key secured in backend
      // Mode is auto-detected (standard mode - no agentId/projectName)
      proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime',
    },
    session: {
      voice: {
        name: 'en-US-Ava:DragonHDLatestNeural',
        type: 'azure-standard',
      },
      avatar: {
        character: import.meta.env.VITE_AVATAR_CHARACTER || 'lisa',
        style: import.meta.env.VITE_AVATAR_STYLE || 'casual-sitting',
      },
    },
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
      title="Avatar - Secure Proxy (API Key)"
      description="Avatar using secure proxy server pattern. API keys and credentials are protected in the backend."
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
