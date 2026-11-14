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
import { proxyWsUrl } from '../lib/connection';
import { useEntraToken } from '../lib/useEntraToken';

/**
 * Avatar session with per-user Entra ID auth: the SDK asks `getToken()` for a fresh token on
 * every connect and reconnect, so the proxy sees the actual user rather than its own identity.
 */
export function AvatarProxyMSAL(): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { signedIn, username, authError, signIn, signOut, getToken } = useEntraToken();

  const config = createVoiceLiveConfig({
    connection: {
      proxyUrl: proxyWsUrl({ model: 'gpt-realtime' }),
      getToken: signedIn ? getToken : undefined,
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
      instructions: 'You are a helpful assistant. Keep responses brief.',
    },
    logLevel: 'debug',
  });

  const { connect, disconnect, connectionState, videoStream, audioStream } = useVoiceLive(config);

  const handleStart = async (): Promise<void> => {
    try {
      setError(null);
      await connect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    }
  };

  const handleStop = (): void => {
    disconnect();
    setError(null);
  };

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="Avatar - Secure Proxy (MSAL/Entra ID)"
      description="Avatar using Entra ID authentication with token-based proxy. User authenticates via Microsoft Entra ID, token passed to secure backend."
    >
      <ErrorPanel error={error || authError} />

      <Section title="Authentication">
        {!signedIn ? (
          <div>
            <p className="auth-section__status">Not signed in</p>
            <button onClick={signIn}>Sign In with Microsoft</button>
          </div>
        ) : (
          <div>
            <p className="auth-section__user">
              <strong>Signed in as:</strong> {username}
            </p>
            <p className="auth-section__status">
              A fresh token is acquired for every connection attempt.
            </p>
            <button onClick={signOut}>Sign Out</button>
          </div>
        )}
      </Section>

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected || !signedIn}>
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
