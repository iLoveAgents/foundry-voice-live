import { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { useVoiceLive, VoiceLiveAvatar, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, Section, ControlGroup, ErrorPanel } from '../components';

export default function AgentServiceAvatar(): JSX.Element {
  const { instance, accounts } = useMsal();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const backendProxyUrl = import.meta.env.VITE_BACKEND_PROXY_URL || 'ws://localhost:8080';

  // Check if MSAL is configured
  const msalConfigured =
    import.meta.env.VITE_AZURE_CLIENT_ID &&
    import.meta.env.VITE_AZURE_CLIENT_ID !== '00000000-0000-0000-0000-000000000000';

  // Check if Agent Service is configured
  const agentConfigured = import.meta.env.VITE_AGENT_ID && import.meta.env.VITE_PROJECT_NAME;

  // Acquire access token for Agent Service - Azure AI scope for agent-based conversations
  const acquireToken = async (): Promise<void> => {
    if (accounts.length === 0) {
      try {
        setAuthError(null);
        await instance.loginPopup({
          scopes: ['https://ai.azure.com/.default'], // Azure AI Agent Service scope
        });
      } catch (error) {
        console.error('Sign-in error:', error);
        setAuthError(`Sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
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
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        try {
          const response = await instance.acquireTokenPopup({
            scopes: ['https://ai.azure.com/.default'],
            account: accounts[0],
          });
          setAccessToken(response.accessToken);
          console.log('Access token acquired via popup with Azure AI scope');
        } catch (popupError) {
          console.error('Token acquisition failed:', popupError);
          setAuthError(`Authentication failed: ${popupError instanceof Error ? popupError.message : String(popupError)}`);
        }
      } else {
        console.error('Token acquisition error:', error);
        setAuthError(`Token error: ${error instanceof Error ? error.message : String(error)}`);
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
  // Agent mode is auto-detected by proxy when agentId/projectName are present in URL
  const agentId = import.meta.env.VITE_AGENT_ID;
  const projectName = import.meta.env.VITE_PROJECT_NAME;

  const proxyUrl = accessToken && agentId && projectName
    ? `${backendProxyUrl}/ws?agentId=${encodeURIComponent(agentId)}&projectName=${encodeURIComponent(projectName)}&token=${encodeURIComponent(accessToken)}`
    : null;

  // Debug logging
  useEffect(() => {
    if (proxyUrl) {
      console.log('[AgentAvatar] Proxy URL constructed:', proxyUrl.replace(/token=[^&]+/, 'token=***'));
      console.log('[AgentAvatar] Agent ID:', agentId);
      console.log('[AgentAvatar] Project Name:', projectName);
    }
  }, [proxyUrl, agentId, projectName]);

  // Configure Voice Live with proxy and avatar
  const config = proxyUrl ? createVoiceLiveConfig({
    connection: {
      proxyUrl,
    },
    session: {
      modalities: ['text', 'audio'],
      voice: {
        name: 'en-US-AvaMultilingualNeural',
        type: 'azure-standard',
        rate: '0.9'  // Slightly slower for more natural speech
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
        threshold: 0.6,  // Higher threshold = less sensitive
        prefixPaddingMs: 300,
        speechDurationMs: 100,  // Minimum speech duration
        silenceDurationMs: 700,  // Longer silence before turn ends
        removeFillerWords: true,
        interruptResponse: true,
        createResponse: true
      }
    },
    onEvent: (event) => {
      // Log transcriptions and agent responses
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        console.log(`[Agent] You: "${event.transcript}"`);
      } else if (event.type === 'response.audio_transcript.done') {
        console.log(`[Agent] Agent: "${event.transcript}"`);
      } else if (event.type === 'error') {
        console.error('[Agent] Error:', event);
        setError(`Azure Error: ${event.error?.message || event.error?.code || 'Unknown error'}`);
      }
    }
  }) : null;

  // Voice Live hook with integrated microphone and interruption handling
  const { connect, disconnect, connectionState, videoStream, audioStream } = useVoiceLive(config || {
    connection: { proxyUrl: '' }
  });

  const handleStart = async (): Promise<void> => {
    if (!accessToken) {
      setError('Please sign in first');
      return;
    }

    try {
      setError(null);
      await connect();
      console.log('[Agent] Connected - microphone will auto-start when session ready');
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
      title="Agent Service with Avatar"
      description="Azure AI Agent Service with avatar. Uses Entra ID authentication with Azure AI scope (https://ai.azure.com/.default) and backend proxy for secure token handling."
    >
      <ErrorPanel error={error || authError} />

      {/* MSAL Configuration Warning */}
      {!msalConfigured && (
        <Section>
          <div style={{ padding: '1rem', background: '#ffebee', color: '#c62828', borderRadius: '4px' }}>
            <h3 style={{ marginTop: 0, fontSize: '16px', fontWeight: 600 }}>MSAL Configuration Missing</h3>
            <p style={{ marginBottom: '8px' }}>Configure these environment variables in your <code>.env</code>:</p>
            <ul style={{ marginBottom: '8px', paddingLeft: '20px' }}>
              <li><code>VITE_AZURE_CLIENT_ID</code> - Azure AD application (client) ID</li>
              <li><code>VITE_AZURE_TENANT_ID</code> - Azure AD tenant ID</li>
            </ul>
            <p style={{ marginBottom: 0, fontSize: '14px' }}>
              See <a href="https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app" target="_blank" rel="noopener noreferrer">Azure docs</a> for app registration.
            </p>
          </div>
        </Section>
      )}

      {/* Agent Service Configuration Warning */}
      {!agentConfigured && (
        <Section>
          <div style={{ padding: '1rem', background: '#fff3e0', color: '#e65100', borderRadius: '4px' }}>
            <h3 style={{ marginTop: 0, fontSize: '16px', fontWeight: 600 }}>Agent Service Configuration Missing</h3>
            <p style={{ marginBottom: '8px' }}>Configure these environment variables in your <code>.env</code>:</p>
            <ul style={{ marginBottom: '8px', paddingLeft: '20px' }}>
              <li><code>VITE_AGENT_ID</code> - Azure AI Foundry Agent ID</li>
              <li><code>VITE_PROJECT_NAME</code> - Azure AI Foundry Project Name</li>
            </ul>
            <p style={{ marginBottom: 0, fontSize: '14px' }}>
              These are required for Agent mode and passed to the proxy URL.
            </p>
          </div>
        </Section>
      )}

      {/* Authentication Section */}
      <Section>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Authentication</h3>
        {accounts.length === 0 ? (
          <div>
            <p style={{ marginBottom: '8px', color: '#666' }}>Not signed in</p>
            <button onClick={acquireToken}>Sign In with Microsoft</button>
          </div>
        ) : (
          <div>
            <p style={{ marginBottom: '4px' }}>
              <strong>Signed in as:</strong> {accounts[0]?.username}
            </p>
            <p style={{ marginBottom: '8px' }}>
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
        <div style={{
          width: '100%',
          maxWidth: '600px',
          margin: '0 auto',
          backgroundColor: '#f5f5f5',
          borderRadius: '8px',
          padding: '20px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '400px',
          border: '1px solid #ddd'
        }}>
          <VoiceLiveAvatar
            videoStream={videoStream}
            audioStream={audioStream}
            transparentBackground={false}
            loadingMessage="Avatar will appear here when connected"
            style={{ width: '100%', borderRadius: '8px' }}
          />
        </div>
      </Section>
    </SampleLayout>
  );
}
