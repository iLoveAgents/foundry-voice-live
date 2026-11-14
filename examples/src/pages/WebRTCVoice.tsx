import { useEffect, useRef, useState } from 'react';

import { useVoiceLive } from '@iloveagents/foundry-voice-live-react';
import type { MicrophoneStatus } from '@iloveagents/foundry-voice-live-react';

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
import { modelProxyUrl } from '../utils/proxyUrl';
import './WebRTCVoice.css';

/** Direct WebRTC audio with authenticated signaling through the backend proxy. */
export function WebRTCVoice(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [text, setText] = useState('What time is it?');
  const [userTranscript, setUserTranscript] = useState('');
  const [assistantTranscript, setAssistantTranscript] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [micStatus, setMicStatus] = useState<MicrophoneStatus | null>(null);
  const [silentSeconds, setSilentSeconds] = useState(0);
  const [speechStatus, setSpeechStatus] = useState('Waiting for speech');

  const {
    connect,
    disconnect,
    connectionState,
    sessionState,
    isReady,
    error,
    audioStream,
    startMic,
    stopMic,
    isMicActive,
    isMuted,
    toggleMute,
    sendEvent,
    createResponse,
    getMicrophoneStatus,
  } = useVoiceLive({
    connection: {
      proxyUrl: modelProxyUrl('azure-realtime'),
      transport: 'webrtc',
    },
    autoStartMic: false,
    audioConstraints: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
    session: {
      voice: { type: 'azure-realtime-native', name: 'ava' },
      instructions: 'Respond concisely. Always use get_time when asked for the current time.',
      inputAudioTranscription: { model: 'mai-transcribe-2' },
      parallelToolCalls: false,
      tools: [
        {
          type: 'function',
          name: 'get_time',
          description: 'Read the current time and timezone from the browser.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
      ],
    },
    onEvent: (event) => {
      if (event.type === 'input_audio_buffer.speech_started')
        setSpeechStatus('Azure is detecting speech');
      if (event.type === 'input_audio_buffer.speech_stopped')
        setSpeechStatus('Speech ended — awaiting response');
      if (event.type === 'conversation.item.input_audio_transcription.completed')
        setSpeechStatus('Speech transcribed');
      if (event.type === 'conversation.item.input_audio_transcription.failed')
        setSpeechStatus('Speech transcription failed');
    },
    onTranscript: (role, transcript) => {
      if (role === 'user') setUserTranscript(transcript);
      else setAssistantTranscript(transcript);
    },
    toolExecutor: (name) => {
      if (name !== 'get_time') return;
      setToolCalls((previous) => previous + 1);
      return {
        time: new Date().toISOString(),
        localTime: new Date().toLocaleString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    },
  });

  useEffect(() => {
    let disposed = false;
    const refresh = (): void => {
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((items) => {
          if (!disposed)
            setDevices(items.filter((item) => item.kind === 'audioinput' && item.deviceId));
        })
        .catch(() => {
          /* Capture reports permission errors when the user starts the microphone. */
        });
    };
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return (): void => {
      disposed = true;
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
    };
  }, [isMicActive]);

  useEffect(() => {
    if (!isMicActive) {
      setMicStatus(null);
      setSilentSeconds(0);
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastEnergy: number | null = null;
    const poll = async (): Promise<void> => {
      try {
        const status = await getMicrophoneStatus();
        if (disposed) return;
        setMicStatus(status);
        const hasSignal =
          (status?.audioLevel ?? 0) > 0.001 ||
          (status?.totalAudioEnergy !== null &&
            status?.totalAudioEnergy !== undefined &&
            lastEnergy !== null &&
            status.totalAudioEnergy > lastEnergy);
        const measurable = status?.audioLevel !== null && status?.audioLevel !== undefined;
        setSilentSeconds((previous) =>
          !isMuted && measurable && !hasSignal ? previous + 0.25 : 0
        );
        lastEnergy = status?.totalAudioEnergy ?? null;
      } catch {
        /* Some browsers do not expose sender statistics. */
      }
      if (!disposed)
        timer = setTimeout(() => {
          void poll();
        }, 250);
    };
    void poll();
    return (): void => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [isMicActive, isMuted, getMicrophoneStatus]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = audioStream;
    if (audioStream) {
      void audio.play().catch((playbackError: unknown) => {
        setLocalError(
          playbackError instanceof Error
            ? playbackError.message
            : 'Unable to play audio. Use the audio controls to start playback.'
        );
      });
    }
    return (): void => {
      audio.srcObject = null;
    };
  }, [audioStream]);

  const handleConnect = async (): Promise<void> => {
    setLocalError(null);
    setUserTranscript('');
    setAssistantTranscript('');
    setToolCalls(0);
    setSpeechStatus('Waiting for speech');
    try {
      await connect();
    } catch (connectionError) {
      setLocalError(
        connectionError instanceof Error ? connectionError.message : 'Unable to connect.'
      );
    }
  };

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

  const handleSendText = (): void => {
    const message = text.trim();
    if (!isReady || !message) return;
    sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: message }],
      },
    });
    setUserTranscript(message);
    setText('');
    createResponse();
  };

  const responseActive = sessionState === 'thinking' || sessionState === 'speaking';

  return (
    <SampleLayout
      title="Voice over WebRTC"
      description="Speak or type to an Azure Realtime voice. Audio streams over WebRTC while the backend proxy keeps resource credentials secure."
    >
      <AlertBox variant="info">
        Connect first, then send a text message or enable the microphone. Microsoft currently offers
        Voice Live WebRTC in preview with global routing. See the{' '}
        <a
          href="https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-webrtc"
          target="_blank"
          rel="noreferrer"
        >
          WebRTC documentation
        </a>{' '}
        for current availability.
      </AlertBox>

      <ErrorPanel error={error || localError} />
      <StatusBadge status={connectionState} />

      <ControlGroup>
        <button
          onClick={handleConnect}
          disabled={connectionState === 'connecting' || connectionState === 'connected'}
        >
          Connect
        </button>
        <button onClick={disconnect} disabled={connectionState === 'disconnected'}>
          Disconnect
        </button>
        <button onClick={handleStartMic} disabled={!isReady || isMicActive}>
          Enable microphone
        </button>
        <button onClick={stopMic} disabled={!isMicActive}>
          Stop microphone
        </button>
        <button onClick={toggleMute} disabled={!isMicActive}>
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
      </ControlGroup>

      <Section title="Microphone">
        <div className="webrtc-field">
          <label htmlFor="webrtc-microphone">Input device</label>
          <select
            id="webrtc-microphone"
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            disabled={isMicActive}
          >
            <option value="">System default microphone</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${devices.indexOf(device) + 1}`}
              </option>
            ))}
          </select>
          <p className="webrtc-help">
            Stop the microphone to change devices. Device names appear after microphone access is
            allowed.
          </p>
        </div>
        <label htmlFor="webrtc-level">Microphone input level</label>
        <meter
          id="webrtc-level"
          className="webrtc-level"
          min={0}
          max={1}
          value={Math.min(1, Math.sqrt(micStatus?.audioLevel ?? 0))}
        />
        <p className="webrtc-help">
          {!isMicActive
            ? 'Microphone off'
            : isMuted
              ? 'Microphone muted'
              : micStatus?.sourceMuted
                ? 'Browser or operating system is blocking microphone audio'
                : micStatus?.deviceLabel || 'Microphone active'}
          {' · '}
          {speechStatus}
        </p>
        {silentSeconds >= 6 && (
          <AlertBox variant="warning">
            No microphone signal detected. Speak and watch the input meter. If it stays empty, stop
            the microphone and select your physical microphone, or check the browser and system
            microphone settings.
          </AlertBox>
        )}
        {micStatus && (
          <details>
            <summary>Microphone diagnostics</summary>
            <p>
              Track: {micStatus.readyState} · Source muted: {String(micStatus.sourceMuted)} · Audio
              packets sent: {micStatus.packetsSent ?? 'unavailable'} · Audio level:{' '}
              {micStatus.audioLevel?.toFixed(4) ?? 'unavailable'}
            </p>
          </details>
        )}
      </Section>

      <ConfigPanel title="Connection">
        <ConfigItem label="Audio" value="WebRTC media tracks (RTP)" />
        <ConfigItem label="Model / voice" value="azure-realtime / ava" />
        <ConfigItem label="Activity" value={sessionState} />
        <ConfigItem label="Completed time lookups" value={String(toolCalls)} />
      </ConfigPanel>

      <Section title="Send a text message">
        <p>
          Ask for the time to exercise function calling while receiving a spoken WebRTC response.
        </p>
        <div className="webrtc-field">
          <label htmlFor="webrtc-message">Message</label>
          <textarea
            id="webrtc-message"
            rows={3}
            placeholder="Type a message…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={!isReady}
          />
        </div>
        <ControlGroup>
          <button onClick={handleSendText} disabled={!isReady || !text.trim() || responseActive}>
            Send message
          </button>
        </ControlGroup>
      </Section>

      <Section title="Transcript and playback">
        <p>
          <strong>You:</strong> {userTranscript || 'Waiting for your message.'}
        </p>
        <p>
          <strong>Assistant:</strong> {assistantTranscript || 'Waiting for a response.'}
        </p>
        <audio ref={audioRef} autoPlay controls aria-label="Assistant voice playback" />
      </Section>
    </SampleLayout>
  );
}
