import { useRef, useEffect, useState } from 'react';
import {
  useVoiceLive,
  createVoiceLiveConfig,
} from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  Section,
  ControlGroup,
  ErrorPanel,
} from '../components';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';

export function VoiceProxyMSAL(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const { instance, accounts } = useMsal();

  const acquireToken = async (): Promise<void> => {
    if (accounts.length === 0) {
      try {
        setAuthError(null);
        await instance.loginPopup({
          scopes: ['https://ai.azure.com/.default'],
        });
      } catch (err) {
        console.error('Sign-in error:', err);
        setAuthError(
          `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return;
    }

    try {
      setAuthError(null);
      const response = await instance.acquireTokenSilent({
        scopes: ['https://ai.azure.com/.default'],
        account: accounts[0],
      });
      setAccessToken(response.accessToken);
      setWsUrl(
        `ws://localhost:8080/ws?model=gpt-realtime&token=${encodeURIComponent(response.accessToken)}`
      );
      console.log('Access token acquired successfully');
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        try {
          const response = await instance.acquireTokenPopup({
            scopes: ['https://ai.azure.com/.default'],
            account: accounts[0],
          });
          setAccessToken(response.accessToken);
          setWsUrl(
            `ws://localhost:8080/ws?model=gpt-realtime&token=${encodeURIComponent(response.accessToken)}`
          );
          console.log('Access token acquired via popup');
        } catch (popupError) {
          console.error('Token acquisition failed:', popupError);
          setAuthError(
            `Authentication failed: ${popupError instanceof Error ? popupError.message : String(popupError)}`
          );
        }
      } else {
        console.error('Token acquisition error:', err);
        setAuthError(
          `Token error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  };

  useEffect(() => {
    if (accounts.length > 0 && !accessToken) {
      acquireToken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const config = createVoiceLiveConfig({
    connection: {
      proxyUrl: wsUrl || undefined,
    },
    session: {
      instructions: 'You are a helpful assistant. Keep responses brief.',
    },
  });

  const { connect, disconnect, connectionState, audioStream } =
    useVoiceLive(config);

  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  const handleStart = async (): Promise<void> => {
    if (!wsUrl) {
      setError('Waiting for authentication token...');
      return;
    }

    console.log('Starting...');
    try {
      setError(null);
      await connect();
      console.log('Connected - mic will auto-start when session ready');
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

  const handleSignOut = (): void => {
    instance.logoutPopup();
    setAccessToken(null);
    setWsUrl(null);
    setAuthError(null);
  };

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="Voice Chat - Secure Proxy (MSAL)"
      description="Voice conversation using Microsoft Authentication Library (MSAL) with Entra ID authentication."
    >
      <ErrorPanel error={error || authError} />

      <Section title="Authentication">
        {accounts.length === 0 ? (
          <div>
            <p className="auth-section__status">
              Not signed in. Please authenticate to continue.
            </p>
            <button onClick={acquireToken}>Sign In with Microsoft</button>
          </div>
        ) : (
          <div>
            <p className="auth-section__user">
              <strong>Signed in as:</strong> {accounts[0]?.username}
            </p>
            <p className="auth-section__status">
              <strong>Token Status:</strong>{' '}
              {accessToken ? '✓ Active' : '✗ Not acquired'}
            </p>
            <button onClick={handleSignOut}>Sign Out</button>
          </div>
        )}
      </Section>

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected || !wsUrl}>
          Start Conversation
        </button>
        <button onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
      </ControlGroup>

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
