import { useRef, useEffect, useState } from 'react';
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  Section,
  ControlGroup,
  ErrorPanel,
  TranscriptPanel,
  TextInput,
} from '../components';
import { proxyWsUrl } from '../lib/connection';
import { useEntraToken } from '../lib/useEntraToken';
import { useTranscripts } from '../lib/useTranscripts';

/**
 * Per-user authentication: the browser signs the user in with MSAL and the SDK asks for a token
 * on every connect via `connection.getToken`, so each user reaches Foundry as themselves.
 */
export function VoiceProxyMSAL(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { signedIn, username, authError, signIn, signOut, getToken } = useEntraToken();
  const { transcripts, onTranscript, clear: clearTranscripts } = useTranscripts();

  const config = createVoiceLiveConfig({
    connection: {
      proxyUrl: proxyWsUrl({ model: 'gpt-realtime' }),
      // Not a `token=` in the URL: the SDK calls this on every connect *and reconnect*, so the
      // session never runs on a token that expired while the page was open
      getToken: signedIn ? getToken : undefined,
    },
    session: {
      instructions: 'You are a helpful assistant. Keep responses brief.',
    },
    onTranscript,
    logLevel: 'debug',
  });

  const { connect, disconnect, connectionState, audioStream, sendText } = useVoiceLive(config);

  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  const handleStart = async (): Promise<void> => {
    try {
      setError(null);
      clearTranscripts();
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
      title="Voice Chat - Secure Proxy (MSAL)"
      description="Voice conversation using Microsoft Authentication Library (MSAL) with Entra ID authentication."
    >
      <ErrorPanel error={error || authError} />

      <Section title="Authentication">
        {!signedIn ? (
          <div>
            <p className="auth-section__status">Not signed in. Please authenticate to continue.</p>
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
          Start Conversation
        </button>
        <button onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
      </ControlGroup>

      <TextInput onSend={sendText} disabled={!isConnected} />
      <TranscriptPanel transcripts={transcripts} />

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
