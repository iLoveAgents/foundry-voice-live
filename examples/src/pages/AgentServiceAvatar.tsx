import { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
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
  AlertBox,
  AvatarContainer,
} from '../components';

export default function AgentServiceAvatar(): JSX.Element {
  const { instance, accounts } = useMsal();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendProxyUrl =
    import.meta.env.VITE_BACKEND_PROXY_URL || 'ws://localhost:8080';

  // Check if MSAL is configured
  const msalConfigured =
    import.meta.env.VITE_AZURE_CLIENT_ID &&
    import.meta.env.VITE_AZURE_CLIENT_ID !== '00000000-0000-0000-0000-000000000000';

  // Check if Agent Service is configured
  const agentConfigured =
    import.meta.env.VITE_FOUNDRY_AGENT_ID && import.meta.env.VITE_FOUNDRY_PROJECT_NAME;

  // Acquire access token for Agent Service
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
      console.log('Access token acquired successfully with Azure AI scope');
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        try {
          const response = await instance.acquireTokenPopup({
            scopes: ['https://ai.azure.com/.default'],
            account: accounts[0],
          });
          setAccessToken(response.accessToken);
          console.log('Access token acquired via popup with Azure AI scope');
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

  // Auto-acquire token on mount and when accounts change
  useEffect(() => {
    if (accounts.length > 0 && !accessToken) {
      acquireToken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // Build proxy URL with token and agent parameters
  const agentId = import.meta.env.VITE_FOUNDRY_AGENT_ID;
  const projectName = import.meta.env.VITE_FOUNDRY_PROJECT_NAME;

  const proxyUrl =
    accessToken && agentId && projectName
      ? `${backendProxyUrl}/ws?agentId=${encodeURIComponent(agentId)}&projectName=${encodeURIComponent(projectName)}&token=${encodeURIComponent(accessToken)}`
      : null;

  // Debug logging
  useEffect(() => {
    if (proxyUrl) {
      console.log(
        '[AgentAvatar] Proxy URL constructed:',
        proxyUrl.replace(/token=[^&]+/, 'token=***')
      );
      console.log('[AgentAvatar] Agent ID:', agentId);
      console.log('[AgentAvatar] Project Name:', projectName);
    }
  }, [proxyUrl, agentId, projectName]);

  // Configure Voice Live with proxy and avatar
  const config = proxyUrl
    ? createVoiceLiveConfig({
        connection: {
          proxyUrl,
        },
        session: {
          modalities: ['text', 'audio'],
          voice: {
            name: 'en-US-AvaMultilingualNeural',
            type: 'azure-standard',
            rate: '0.9',
          },
          avatar: {
            character: import.meta.env.VITE_AVATAR_CHARACTER || 'lisa',
            style: import.meta.env.VITE_AVATAR_STYLE || 'casual-sitting',
          },
          inputAudioFormat: 'pcm16',
          outputAudioFormat: 'pcm16',
          inputAudioTranscription: { model: 'whisper-1' },
          turnDetection: {
            type: 'azure_semantic_vad',
            threshold: 0.6,
            prefixPaddingMs: 300,
            speechDurationMs: 100,
            silenceDurationMs: 700,
            removeFillerWords: true,
            interruptResponse: true,
            createResponse: true,
          },
        },
        onEvent: (event) => {
          if (
            event.type === 'conversation.item.input_audio_transcription.completed'
          ) {
            console.log(`[Agent] You: "${event.transcript}"`);
          } else if (event.type === 'response.audio_transcript.done') {
            console.log(`[Agent] Agent: "${event.transcript}"`);
          } else if (event.type === 'error') {
            console.error('[Agent] Error:', event);
            const errorObj = event.error as { message?: string; code?: string } | undefined;
            setError(
              `Azure Error: ${errorObj?.message || errorObj?.code || 'Unknown error'}`
            );
          }
        },
      })
    : null;

  // Voice Live hook
  const { connect, disconnect, connectionState, videoStream, audioStream } =
    useVoiceLive(config || { connection: { proxyUrl: '' } });

  const handleStart = async (): Promise<void> => {
    if (!accessToken) {
      setError('Please sign in first');
      return;
    }

    try {
      setError(null);
      await connect();
      console.log(
        '[Agent] Connected - microphone will auto-start when session ready'
      );
    } catch (err) {
      console.error('[Agent] Start error:', err);
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
      title="Agent Service (classic) with Avatar"
      description="Azure AI Agent Service with avatar. Uses Entra ID authentication with Azure AI scope (https://ai.azure.com/.default) and backend proxy for secure token handling."
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
          <AlertBox variant="warning" title="Agent Service Configuration Missing">
            <p>
              Configure these environment variables in your <code>.env</code>:
            </p>
            <ul>
              <li>
                <code>VITE_FOUNDRY_AGENT_ID</code> - Azure AI Foundry Agent ID
              </li>
              <li>
                <code>VITE_FOUNDRY_PROJECT_NAME</code> - Azure AI Foundry Project Name
              </li>
            </ul>
            <p>These are required for Agent mode and passed to the proxy URL.</p>
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
              <strong>Token:</strong> {accessToken ? '✓ Acquired' : '✗ Not available'}
            </p>
            <button onClick={handleSignOut}>Sign Out</button>
          </div>
        )}
      </Section>

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected || !accessToken}>
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
