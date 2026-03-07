import { useRef, useEffect, useState } from 'react';
import {
  useVoiceLive,
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
} from '../components';

/**
 * Foundry Agent example with server-side authentication.
 *
 * The client passes agentName + projectName as URL params.
 * The proxy acquires Entra ID tokens via DefaultAzureCredential
 * (Azure CLI for dev, managed identity / service principal in production).
 *
 * No MSAL, no app registration needed.
 *
 * Prerequisites:
 * - examples .env: VITE_FOUNDRY_AGENT_NAME, VITE_FOUNDRY_PROJECT_NAME
 * - proxy .env: FOUNDRY_RESOURCE_NAME, API_VERSION=2026-01-01-preview
 * - `az login` for local dev (or managed identity in production)
 */
export default function FoundryAgent(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);

  const backendProxyUrl =
    import.meta.env.VITE_BACKEND_PROXY_URL || 'ws://localhost:8080';

  const agentName = import.meta.env.VITE_FOUNDRY_AGENT_NAME;
  const projectName = import.meta.env.VITE_FOUNDRY_PROJECT_NAME;
  const agentConfigured = !!(agentName && projectName);

  // Pass agent config as URL params — proxy handles auth via DefaultAzureCredential
  const proxyUrl = agentConfigured
    ? `${backendProxyUrl}/ws?agentName=${encodeURIComponent(agentName)}&projectName=${encodeURIComponent(projectName)}`
    : `${backendProxyUrl}/ws`;

  const config = createVoiceLiveConfig({
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
        console.log(`[Foundry Agent] You: "${event.transcript}"`);
      } else if (event.type === 'response.audio_transcript.done') {
        console.log(`[Foundry Agent] Agent: "${event.transcript}"`);
      } else if (event.type === 'error') {
        console.error('[Foundry Agent] Error:', event);
        const errorObj = event.error as
          | { message?: string; code?: string }
          | undefined;
        setError(
          `Azure Error: ${errorObj?.message || errorObj?.code || 'Unknown error'}`
        );
      }
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
    try {
      setError(null);
      await connect();
      console.log(
        '[Foundry Agent] Connected - microphone will auto-start when session ready'
      );
    } catch (err) {
      console.error('[Foundry Agent] Start error:', err);
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
      title="Foundry Agent Service - Voice"
      description="Voice conversation with a Foundry Agent. The proxy handles authentication via DefaultAzureCredential — no MSAL or app registration needed."
    >
      <ErrorPanel error={error} />

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
              The proxy also needs <code>FOUNDRY_RESOURCE_NAME</code> and{' '}
              <code>API_VERSION=2026-01-01-preview</code>. For local dev, run{' '}
              <code>az login</code>. In production, use managed identity or a
              service principal.
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
