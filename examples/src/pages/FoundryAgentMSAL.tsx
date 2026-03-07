import { useRef, useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
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
} from '../components';

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
 * 4. Set FOUNDRY_RESOURCE_NAME in proxy .env
 * 5. Set API_VERSION=2026-01-01-preview in proxy .env
 */
export default function FoundryAgentMSAL(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { instance, accounts } = useMsal();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendProxyUrl =
    import.meta.env.VITE_BACKEND_PROXY_URL || 'ws://localhost:8080';

  const msalConfigured =
    import.meta.env.VITE_AZURE_CLIENT_ID &&
    import.meta.env.VITE_AZURE_CLIENT_ID !== '00000000-0000-0000-0000-000000000000';

  const agentName = import.meta.env.VITE_FOUNDRY_AGENT_NAME;
  const projectName = import.meta.env.VITE_FOUNDRY_PROJECT_NAME;
  const agentConfigured = !!(agentName && projectName);

  // Acquire access token via MSAL
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
      console.log('[Foundry Agent MSAL] Access token acquired');
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        try {
          const response = await instance.acquireTokenPopup({
            scopes: ['https://ai.azure.com/.default'],
            account: accounts[0],
          });
          setAccessToken(response.accessToken);
          console.log('[Foundry Agent MSAL] Access token acquired via popup');
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

  // Auto-acquire token when accounts change
  useEffect(() => {
    if (accounts.length > 0 && !accessToken) {
      acquireToken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // Build proxy URL with MSAL token
  const proxyUrl =
    accessToken && agentName && projectName
      ? `${backendProxyUrl}/ws?agentName=${encodeURIComponent(agentName)}&projectName=${encodeURIComponent(projectName)}&token=${encodeURIComponent(accessToken)}`
      : null;

  const config = proxyUrl
    ? createVoiceLiveConfig({
        connection: {
          proxyUrl,
        },
        session: sessionConfig()
          .voice('en-US-AvaMultilingualNeural')
          .semanticVAD({ interruptResponse: true })
          .echoCancellation()
          .noiseReduction()
          .transcription()
          .build(),
        onEvent: (event) => {
          if (
            event.type === 'conversation.item.input_audio_transcription.completed'
          ) {
            console.log(`[Foundry Agent MSAL] You: "${event.transcript}"`);
          } else if (event.type === 'response.audio_transcript.done') {
            console.log(`[Foundry Agent MSAL] Agent: "${event.transcript}"`);
          } else if (event.type === 'error') {
            console.error('[Foundry Agent MSAL] Error:', event);
            const errorObj = event.error as
              | { message?: string; code?: string }
              | undefined;
            setError(
              `Azure Error: ${errorObj?.message || errorObj?.code || 'Unknown error'}`
            );
          }
        },
      })
    : null;

  const { connect, disconnect, connectionState, audioStream } = useVoiceLive(
    config || { connection: { proxyUrl: '' } }
  );

  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  const handleStart = async (): Promise<void> => {
    if (!accessToken) {
      setError('Please sign in first');
      return;
    }
    try {
      setError(null);
      await connect();
      console.log(
        '[Foundry Agent MSAL] Connected - microphone will auto-start when session ready'
      );
    } catch (err) {
      console.error('[Foundry Agent MSAL] Start error:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStop = (): void => {
    disconnect();
    setError(null);
  };

  const handleSignOut = (): void => {
    instance.logoutPopup();
    setAccessToken(null);
    setAuthError(null);
  };

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="Foundry Agent (MSAL)"
      description="Voice conversation with a Foundry Agent using per-user Entra ID authentication. The browser acquires a token via MSAL and passes it through the proxy."
    >
      <ErrorPanel error={error || authError} />

      {!msalConfigured && (
        <Section>
          <AlertBox variant="error" title="MSAL Configuration Missing">
            <p>
              Configure these environment variables in your <code>.env</code>:
            </p>
            <ul>
              <li>
                <code>VITE_AZURE_CLIENT_ID</code> - Azure AD application (client)
                ID
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
                <code>VITE_FOUNDRY_AGENT_NAME</code> - Agent name from Azure AI
                Foundry portal
              </li>
              <li>
                <code>VITE_FOUNDRY_PROJECT_NAME</code> - Azure AI Foundry project
                name
              </li>
            </ul>
          </AlertBox>
        </Section>
      )}

      <Section title="Authentication">
        {accounts.length === 0 ? (
          <div>
            <p className="auth-section__status">Not signed in</p>
            <button onClick={acquireToken}>Sign In with Microsoft</button>
          </div>
        ) : (
          <div>
            <p className="auth-section__user">
              <strong>Signed in as:</strong> {accounts[0]?.username}
            </p>
            <p className="auth-section__status">
              <strong>Token:</strong>{' '}
              {accessToken ? 'Acquired' : 'Not available'}
            </p>
            <button onClick={handleSignOut}>Sign Out</button>
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
        <button onClick={handleStart} disabled={isConnected || !accessToken}>
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
