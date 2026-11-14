import { useEffect, useRef, useState } from 'react';

import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';

import { modelProxyUrl } from '../utils/proxyUrl';
import {
  AlertBox,
  ConfigItem,
  ConfigPanel,
  ControlGroup,
  ErrorPanel,
  SampleLayout,
  Section,
  StatusBadge,
} from '../components';

/** GA API capabilities using server-side credentials and the Azure Realtime model. */
export function CurrentCapabilities(): JSX.Element {
  const [chunk, setChunk] = useState('What time is it?');
  const [streamedText, setStreamedText] = useState('');
  const [assistantText, setAssistantText] = useState('');
  const [userTranscript, setUserTranscript] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const streamedItemId = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const {
    connect,
    disconnect,
    connectionState,
    isReady,
    error,
    startMic,
    stopMic,
    isMicActive,
    appendText,
    finishText,
    createResponse,
    sendEvent,
    sessionExpiresAt,
    audioStream,
  } = useVoiceLive({
    connection: {
      proxyUrl: modelProxyUrl('azure-realtime'),
      apiVersion: '2026-07-15',
    },
    autoStartMic: false,
    session: {
      voice: { type: 'azure-realtime-native', name: 'ava' },
      instructions: 'Be concise. Use get_time when asked for the current time.',
      inputAudioTranscription: { model: 'mai-transcribe-2' },
      parallelToolCalls: false,
      tools: [
        {
          type: 'function',
          name: 'get_time',
          description: 'Get the current time and timezone from the browser.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    },
    onTranscript: (role, text) => {
      if (role === 'assistant') setAssistantText(text);
      else setUserTranscript(text);
    },
    toolExecutor: (name) => {
      if (name !== 'get_time') return;
      return {
        time: new Date().toISOString(),
        localTime: new Date().toLocaleString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = audioStream;
    if (audioStream) {
      void audio.play().catch((playbackError: unknown) => {
        setLocalError(
          playbackError instanceof Error ? playbackError.message : 'Unable to play audio.'
        );
      });
    }
    return (): void => {
      audio.srcObject = null;
    };
  }, [audioStream]);

  useEffect(() => {
    if (connectionState === 'disconnected' || connectionState === 'error') {
      streamedItemId.current = null;
      setStreamedText('');
    }
  }, [connectionState]);

  const handleStartMic = async (): Promise<void> => {
    setLocalError(null);
    try {
      await startMic();
    } catch (captureError) {
      setLocalError(
        captureError instanceof Error ? captureError.message : 'Unable to start the microphone.'
      );
    }
  };

  const handleAppend = (): void => {
    if (!isReady || !chunk) return;
    if (!streamedItemId.current) {
      streamedItemId.current = `item_${crypto.randomUUID()}`;
      sendEvent({
        type: 'conversation.item.create',
        item: {
          id: streamedItemId.current,
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '' }],
        },
      });
    }
    appendText(streamedItemId.current, chunk);
    setStreamedText((previous) => previous + chunk);
    setChunk('');
  };

  const handleFinish = (): void => {
    if (!isReady || !streamedItemId.current) return;
    finishText(streamedItemId.current);
    createResponse();
    streamedItemId.current = null;
    setStreamedText('');
  };

  const handleDisconnect = (): void => {
    disconnect();
    setLocalError(null);
    streamedItemId.current = null;
    setStreamedText('');
  };

  return (
    <SampleLayout
      title="Azure Realtime and Streaming Text"
      description="Try a native Azure voice, MAI transcription, tool calling, and incremental text input through the secure proxy."
    >
      <AlertBox variant="info">
        Start the proxy with your Foundry resource and server-side credentials. Check{' '}
        <a
          href="https://learn.microsoft.com/azure/ai-services/speech-service/regions?tabs=voice-live#regions"
          target="_blank"
          rel="noreferrer"
        >
          model availability in your region
        </a>{' '}
        before connecting. Microphone capture starts only when you choose Enable microphone.
      </AlertBox>

      <ErrorPanel error={error || localError} />
      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button
          onClick={connect}
          disabled={connectionState === 'connected' || connectionState === 'connecting'}
        >
          Connect
        </button>
        <button onClick={handleDisconnect} disabled={connectionState === 'disconnected'}>
          Disconnect
        </button>
        <button
          onClick={handleStartMic}
          disabled={!isReady || isMicActive || streamedText.length > 0}
        >
          Enable microphone
        </button>
        <button onClick={stopMic} disabled={!isMicActive}>
          Stop microphone
        </button>
      </ControlGroup>

      <ConfigPanel title="Session">
        <ConfigItem label="Model / voice" value="azure-realtime / ava" />
        <ConfigItem label="Transcription" value="mai-transcribe-2" />
        <ConfigItem label="Tool calls" value="Sequential (parallelToolCalls: false)" />
        <ConfigItem
          label="Session expires"
          value={
            sessionExpiresAt
              ? new Date(sessionExpiresAt).toLocaleString()
              : 'Not reported by the service yet'
          }
        />
      </ConfigPanel>

      <Section title="Stream a text message">
        <p>
          Append one or more chunks, then finish the message to request a spoken reply. Include
          spaces between chunks where needed.
        </p>
        <label htmlFor="text-chunk">Next text chunk</label>
        <textarea
          id="text-chunk"
          rows={3}
          value={chunk}
          onChange={(event) => setChunk(event.target.value)}
          disabled={!isReady || isMicActive}
        />
        <ControlGroup>
          <button onClick={handleAppend} disabled={!isReady || isMicActive || !chunk}>
            Append chunk
          </button>
          <button onClick={handleFinish} disabled={!isReady || !streamedText}>
            Finish and respond
          </button>
        </ControlGroup>
        {streamedText && (
          <p>
            <strong>Pending message:</strong> {streamedText}
          </p>
        )}
      </Section>

      <Section title="Transcript">
        <p>
          <strong>You:</strong>{' '}
          {userTranscript || 'Enable the microphone to try MAI transcription.'}
        </p>
        <p>
          <strong>Assistant:</strong> {assistantText || 'Waiting for a response.'}
        </p>
      </Section>
      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
