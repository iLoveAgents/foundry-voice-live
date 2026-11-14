import { useRef, useEffect, useState } from 'react';
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';
import type { VoiceLiveProfile } from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  Section,
  ControlGroup,
  ErrorPanel,
  AlertBox,
  ConfigPanel,
  ConfigItem,
  TextInput,
  TranscriptPanel,
} from '../components';
import { directOrProxyConnection } from '../lib/connection';
import { sessionStateLabel } from '../lib/sessionState';
import { useTranscripts } from '../lib/useTranscripts';

/**
 * Bring Your Own Model.
 *
 * Voice Live runs the speech pipeline (VAD, STT, TTS, barge-in) around a model *you* deployed in
 * your Foundry resource — a fine-tune, a PTU deployment, or a catalog model such as Claude or
 * Grok. `profile` picks the integration mode; `model` is the deployment name from the portal.
 *
 * The realtime profile streams audio to a `gpt-realtime*` deployment. The other two are
 * cascaded: Voice Live transcribes, sends text to your model, and speaks the reply with an Azure
 * voice — so those need an Azure voice and `azure-speech` transcription, which the page sets.
 */
export function Byom(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { transcripts, onTranscript, clear: clearTranscripts } = useTranscripts();

  const profile = import.meta.env.VITE_BYOM_PROFILE as VoiceLiveProfile | undefined;
  const model = import.meta.env.VITE_BYOM_MODEL;
  const foundryResourceOverride = import.meta.env.VITE_BYOM_RESOURCE_OVERRIDE;
  const configured = !!(profile && model);
  const isRealtimeProfile = profile === 'byom-azure-openai-realtime';

  const {
    connect,
    disconnect,
    connectionState,
    sessionState,
    audioStream,
    isMuted,
    toggleMute,
    sendText,
    error: hookError,
  } = useVoiceLive({
    // Direct with the dev API key, or through the proxy (which forwards the BYOM params upstream)
    connection: directOrProxyConnection({ model, profile, foundryResourceOverride }),
    session: (isRealtimeProfile
      ? sessionConfig()
          .instructions('You are a helpful assistant. Keep responses brief and friendly.')
          .semanticVAD({ interruptResponse: true })
      : sessionConfig()
          .instructions('You are a helpful assistant. Keep responses brief and friendly.')
          .voice('en-US-AvaMultilingualNeural')
          .transcription({ model: 'azure-speech' })
          .semanticVAD({ interruptResponse: true })
    ).build(),
    onTranscript,
    logLevel: 'debug',
  });

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
      title="Bring Your Own Model"
      description="Voice Live's speech pipeline around a model deployed in your own Foundry resource — Claude, Grok, gpt-5.x, a fine-tune or a PTU deployment."
    >
      <ErrorPanel error={error || hookError} />

      {!configured && (
        <Section>
          <AlertBox variant="warning" title="BYOM not configured">
            <p>
              Set these in <code>examples/.env</code> (see <code>.env.example</code>):
            </p>
            <ul>
              <li>
                <code>VITE_BYOM_PROFILE</code> — <code>byom-azure-openai-realtime</code>,{' '}
                <code>byom-azure-openai-chat-completion</code> or{' '}
                <code>byom-foundry-anthropic-messages</code>
              </li>
              <li>
                <code>VITE_BYOM_MODEL</code> — the deployment name from the Foundry portal
              </li>
            </ul>
            <p>
              Entra ID auth with the chat-completion / Anthropic profiles requires the Foundry
              resource&apos;s managed identity to hold the <em>Foundry User</em> role — see the{' '}
              <a
                href="https://learn.microsoft.com/azure/ai-services/speech-service/how-to-bring-your-own-model"
                target="_blank"
                rel="noopener noreferrer"
              >
                BYOM guide
              </a>
              .
            </p>
          </AlertBox>
        </Section>
      )}

      <ConfigPanel>
        <ConfigItem label="Profile" value={profile ?? '(unset)'} />
        <ConfigItem label="Deployment" value={model ?? '(unset)'} />
        {foundryResourceOverride && (
          <ConfigItem label="Model resource" value={foundryResourceOverride} />
        )}
        <ConfigItem
          label="Pipeline"
          value={
            isRealtimeProfile
              ? 'audio → your realtime deployment → audio'
              : 'audio → azure-speech STT → your model → Azure TTS'
          }
        />
      </ConfigPanel>

      <StatusBadge status={connectionState} />

      {isConnected && (
        <p style={{ margin: '0.5rem 0', fontStyle: 'italic' }}>{sessionStateLabel(sessionState)}</p>
      )}

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected || !configured}>
          Start Conversation
        </button>
        <button onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
        {isConnected && <button onClick={toggleMute}>{isMuted ? 'Unmute' : 'Mute'}</button>}
      </ControlGroup>

      {isConnected && <TextInput onSend={sendText} />}

      <TranscriptPanel transcripts={transcripts} />

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
