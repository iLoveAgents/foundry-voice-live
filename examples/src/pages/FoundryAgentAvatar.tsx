import { useState } from 'react';
import {
  useVoiceLive,
  VoiceLiveAvatar,
  createVoiceLiveConfig,
  sessionConfig,
} from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  ControlGroup,
  ErrorPanel,
  Section,
  AlertBox,
  AvatarContainer,
  TranscriptPanel,
  TextInput,
} from '../components';
import { proxyWsUrl } from '../lib/connection';
import { useTranscripts } from '../lib/useTranscripts';

/**
 * Foundry Agent Service example with avatar and server-side authentication.
 *
 * The client passes agentName + projectName as URL params.
 * The proxy acquires Entra ID tokens via DefaultAzureCredential
 * (Azure CLI for dev, managed identity / service principal in production).
 *
 * No MSAL, no app registration needed.
 *
 * Prerequisites:
 * - examples .env: VITE_FOUNDRY_AGENT_NAME, VITE_FOUNDRY_PROJECT_NAME
 *   (and VITE_BACKEND_PROXY_URL if the proxy is not on ws://localhost:8080)
 * - proxy .env: FOUNDRY_RESOURCE_NAME (the GA API version is the default)
 * - `az login` for local dev (or managed identity in production)
 */
export function FoundryAgentAvatar(): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { transcripts, onTranscript, clear: clearTranscripts } = useTranscripts();

  const agentName = import.meta.env.VITE_FOUNDRY_AGENT_NAME;
  const projectName = import.meta.env.VITE_FOUNDRY_PROJECT_NAME;
  const agentConfigured = !!(agentName && projectName);

  // Pass agent config as URL params — proxy handles auth via DefaultAzureCredential
  // (proxy base from VITE_BACKEND_PROXY_URL, default ws://localhost:8080)
  const proxyUrl = proxyWsUrl({ agentName, projectName });

  const config = createVoiceLiveConfig({
    connection: {
      proxyUrl,
    },
    session: sessionConfig()
      .voice('en-US-AvaMultilingualNeural')
      .avatar(
        import.meta.env.VITE_AVATAR_CHARACTER || 'lisa',
        import.meta.env.VITE_AVATAR_STYLE || 'casual-sitting',
        { codec: 'h264' },
      )
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
    videoStream,
    audioStream,
    sendText,
    error: sessionError,
  } = useVoiceLive(config);

  const handleStart = async (): Promise<void> => {
    try {
      setError(null);
      clearTranscripts();
      await connect();
      console.log(
        '[Foundry Agent Avatar] Connected - microphone will auto-start when session ready'
      );
    } catch (err) {
      console.error('[Foundry Agent Avatar] Start error:', err);
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
      title="Foundry Agent Service - Avatar"
      description="Voice conversation with avatar and a Foundry Agent. The proxy handles authentication via DefaultAzureCredential — no MSAL or app registration needed."
    >
      <ErrorPanel error={error || sessionError} />

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
                <code>VITE_FOUNDRY_PROJECT_NAME</code> - Azure AI Foundry
                project name
              </li>
            </ul>
            <p>
              The proxy also needs <code>FOUNDRY_RESOURCE_NAME</code>. For local
              dev, run <code>az login</code>. In production, use managed identity
              or a service principal.
            </p>
          </AlertBox>
        </Section>
      )}

      {agentConfigured && (
        <Section title="Configuration">
          <p>
            <strong>Agent:</strong> {agentName}
          </p>
          <p>
            <strong>Project:</strong> {projectName}
          </p>
          <p>
            <strong>Auth:</strong> DefaultAzureCredential (server-side)
          </p>
        </Section>
      )}

      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button
          onClick={handleStart}
          disabled={isConnected || !agentConfigured}
        >
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

      <TextInput onSend={sendText} disabled={!isConnected} />
      <TranscriptPanel transcripts={transcripts} />
    </SampleLayout>
  );
}
