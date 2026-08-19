import { useRef, useEffect, useState } from 'react';
import {
  useVoiceLive,
  sessionConfig,
  AZURE_REALTIME_NATIVE_VOICES,
} from '@iloveagents/foundry-voice-live-react';
import type { AzureRealtimeNativeVoiceName } from '@iloveagents/foundry-voice-live-react';
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
 * Locale / gender hints for the voice picker. The selectable names themselves come
 * from the SDK's `AZURE_REALTIME_NATIVE_VOICES`; voices without a hint show the bare name.
 */
const VOICE_HINTS: Record<string, string> = {
  aarti: 'en-IN, female',
  andrew: 'en-US, male',
  ava: 'en-US, female, default',
  denise: 'fr-FR, female',
  diya: 'hi-IN, female',
  elsa: 'it-IT, female',
  florian: 'de-DE, male',
  francisca: 'pt-BR, female',
  meera: 'hi-IN, female',
  ximena: 'es-ES, female',
  xiaoxiao: 'zh-CN, female',
  yunxi: 'zh-CN, male',
};

function voiceLabel(name: string): string {
  const hint = VOICE_HINTS[name];
  return hint ? `${name} (${hint})` : name;
}

/**
 * Azure Realtime voices.
 *
 * The `azure-realtime` model is Microsoft's native speech-to-speech model. It only
 * accepts `azure-realtime-native` voices (`sessionConfig().azureRealtimeVoice(name)`)
 * and skips the separate TTS hop, which saves roughly 100 ms of latency compared to
 * Azure voices on other models.
 */
export function AzureRealtime(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState<AzureRealtimeNativeVoiceName>('ava');
  // Accumulates partial and final transcripts
  const { transcripts, onTranscript, clear: clearTranscripts } = useTranscripts();

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
    // Direct with the dev API key, or through the proxy when no key is configured
    connection: directOrProxyConnection({ model: 'azure-realtime' }),
    session: sessionConfig()
      .instructions('You are a helpful assistant. Keep responses brief and friendly.')
      .azureRealtimeVoice(voice)
      .semanticVAD({ interruptResponse: true })
      .build(),
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
      const message = err instanceof Error ? err.message : 'Failed to start';
      setError(message);
      console.error('Start error:', err);
    }
  };

  const handleStop = (): void => {
    disconnect();
    setError(null);
  };

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="Azure Realtime Voices"
      description="azure-realtime model with native voices — about 100 ms lower latency than Azure TTS voices on other models. Pick a voice, then start the conversation."
    >
      <ErrorPanel error={error || hookError} />

      <Section>
        <AlertBox variant="info" title="Region availability">
          <p>
            <code>azure-realtime</code> is not deployed in every Voice Live region (for example it
            is available in <code>eastus2</code>, <code>swedencentral</code>, <code>westus2</code>{' '}
            and <code>uksouth</code>, but not in <code>eastus</code> or <code>westeurope</code>). If
            the session fails to start, check the{' '}
            <a
              href="https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=voice-live"
              target="_blank"
              rel="noopener noreferrer"
            >
              region table
            </a>{' '}
            for your Foundry resource. The model requires api-version{' '}
            <code>2026-01-01-preview</code> or later (the SDK default is the GA version).
          </p>
        </AlertBox>
      </Section>

      <Section title="Voice">
        <label style={{ fontSize: '14px' }}>
          Native voice{' '}
          <select
            value={voice}
            disabled={isConnected}
            onChange={(e) => setVoice(e.target.value as AzureRealtimeNativeVoiceName)}
            style={{ padding: '6px 10px', fontSize: '14px', marginLeft: '0.5rem' }}
          >
            {AZURE_REALTIME_NATIVE_VOICES.map((name) => (
              <option key={name} value={name}>
                {voiceLabel(name)}
              </option>
            ))}
          </select>
        </label>
        <p style={{ fontSize: '14px', marginTop: '0.5rem' }}>
          The voice is part of the session config - change it before connecting (or stop and
          reconnect).
        </p>
      </Section>

      <ConfigPanel>
        <ConfigItem label="Model" value="azure-realtime" />
        <ConfigItem label="Voice" value={`{ type: 'azure-realtime-native', name: '${voice}' }`} />
      </ConfigPanel>

      <StatusBadge status={connectionState} />

      {isConnected && (
        <p style={{ margin: '0.5rem 0', fontStyle: 'italic' }}>{sessionStateLabel(sessionState)}</p>
      )}

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected}>
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
