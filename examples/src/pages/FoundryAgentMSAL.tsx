import { useRef, useEffect, useState } from 'react';
import {
  useVoiceLive,
  createVoiceLiveConfig,
  sessionConfig,
} from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  Section,
  ControlGroup,
  ErrorPanel,
  AlertBox,
  TranscriptPanel,
  TextInput,
} from '../components';
import { proxyWsUrl } from '../lib/connection';
import { useEntraToken } from '../lib/useEntraToken';
import { useTranscripts } from '../lib/useTranscripts';

/**
 * Foundry Agent example with MSAL browser-side authentication.
 *
 * Per-user Entra ID auth: the browser acquires a token via MSAL and passes it
 * through the proxy to Azure. Each user signs in with their own identity.
 *
 * Prerequisites:
 * 1. Azure AD app registration with API permission for Azure AI
 * 2. Set VITE_AZURE_CLIENT_ID and VITE_AZURE_TENANT_ID in examples .env
 * 3. Set VITE_FOUNDRY_AGENT_NAME and VITE_FOUNDRY_PROJECT_NAME in examples .env
 * 4. Set FOUNDRY_RESOURCE_NAME in proxy .env (the GA API version is the default)
 */
export function FoundryAgentMSAL(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { signedIn, username, authError, signIn, signOut, getToken } = useEntraToken();
  const { transcripts, onTranscript, clear: clearTranscripts } = useTranscripts();
  const [error, setError] = useState<string | null>(null);

  const msalConfigured =
    import.meta.env.VITE_AZURE_CLIENT_ID &&
    import.meta.env.VITE_AZURE_CLIENT_ID !== '00000000-0000-0000-0000-000000000000';

  const agentName = import.meta.env.VITE_FOUNDRY_AGENT_NAME;
  const projectName = import.meta.env.VITE_FOUNDRY_PROJECT_NAME;
  const agentConfigured = !!(agentName && projectName);

  const config = createVoiceLiveConfig({
    connection: {
      // Proxy base from VITE_BACKEND_PROXY_URL (default ws://localhost:8080). The token is NOT
      // baked into this URL: `getToken` is called on every connect and reconnect, so a session
      // that outlives the token still reconnects with a valid one.
      proxyUrl: proxyWsUrl({ agentName, projectName }),
      getToken: signedIn ? getToken : undefined,
    },
    session: sessionConfig()
      .voice('en-US-AvaMultilingualNeural')
      .semanticVAD({ interruptResponse: true })
      .echoCancellation()
      .noiseReduction()
      // Azure speech transcription is the model compatible with Foundry agent sessions
      .transcription({ model: 'azure-speech' })
      .build(),
    onTranscript,
    logLevel: 'debug',
  });

  const {
    connect,
    disconnect,
    connectionState,
    audioStream,
    sendText,
    error: sessionError,
  } = useVoiceLive(config);

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
      console.log('[Foundry Agent MSAL] Connected - microphone will auto-start when session ready');
    } catch (err) {
      console.error('[Foundry Agent MSAL] Start error:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStop = (): void => {
    disconnect();
    setError(null);
  };

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="Foundry Agent Service - Voice (MSAL)"
      description="Voice conversation with a Foundry Agent using per-user Entra ID authentication. The browser acquires a token via MSAL and passes it through the proxy."
    >
      <ErrorPanel error={error || authError || sessionError} />

      {!msalConfigured && (
        <Section>
          <AlertBox variant="error" title="MSAL Configuration Missing">
            <p>
              Configure these environment variables in your <code>.env</code>:
            </p>
            <ul>
              <li>
                <code>VITE_AZURE_CLIENT_ID</code> - Azure AD application (client) ID
              </li>
              <li>
                <code>VITE_AZURE_TENANT_ID</code> - Azure AD tenant ID
              </li>
            </ul>
            <p>
              See{' '}
              <a
                href="https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app"
                target="_blank"
                rel="noopener noreferrer"
              >
                Azure docs
              </a>{' '}
              for app registration.
            </p>
          </AlertBox>
        </Section>
      )}

      {!agentConfigured && (
        <Section>
          <AlertBox variant="warning" title="Foundry Agent Not Configured">
            <p>
              Configure these environment variables in your <code>.env</code>:
            </p>
            <ul>
              <li>
                <code>VITE_FOUNDRY_AGENT_NAME</code> - Agent name from Azure AI Foundry portal
              </li>
              <li>
                <code>VITE_FOUNDRY_PROJECT_NAME</code> - Azure AI Foundry project name
              </li>
            </ul>
          </AlertBox>
        </Section>
      )}

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

      {agentConfigured && (
        <Section title="Configuration">
          <p>
            <strong>Agent:</strong> {agentName}
          </p>
          <p>
            <strong>Project:</strong> {projectName}
          </p>
          <p>
            <strong>Auth:</strong> MSAL (per-user Entra ID)
          </p>
        </Section>
      )}

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected || !signedIn || !agentConfigured}>
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
