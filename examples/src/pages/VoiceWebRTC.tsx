import { useRef, useEffect, useState } from 'react';
import {
  useVoiceLive,
  sessionConfig,
  DEFAULT_WEBRTC_API_VERSION,
  MIN_WEBRTC_API_VERSION,
} from '@iloveagents/foundry-voice-live-react';
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
 * Voice over WebRTC (preview).
 *
 * With `transport: 'webrtc'` the hook opens a WebSocket control channel to
 * `/voice-live/realtime/calls`, negotiates an RTCPeerConnection
 * (`rtc.call.sdp.create` → `rtc.call.sdp.created`) and then streams microphone
 * and assistant audio over RTP instead of base64 PCM16 events.
 *
 * - `audioStream` is the remote RTP track — attach it to an <audio> element as usual.
 * - VAD, transcript and response lifecycle events arrive on the `voice-live-events`
 *   data channel; session control and tool calls stay on the control channel.
 *   `onEvent` / `onTranscript` receive both, so page code is transport-agnostic.
 */
export function VoiceWebRTC(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const [error, setError] = useState<string | null>(null);
  // Accumulates partial and final transcripts (works the same over the data channel)
  const { transcripts, onTranscript, clear: clearTranscripts } = useTranscripts();

  const {
    connect,
    disconnect,
    connectionState,
    sessionState,
    transport,
    audioStream,
    audioAnalyser,
    sessionExpiresAt,
    isMuted,
    toggleMute,
    sendText,
    error: hookError,
  } = useVoiceLive({
    // Direct with the dev API key, or through the proxy when no key is configured.
    // Preview transport: RTP audio + WebSocket control channel (the SDK appends
    // `transport=webrtc` to the proxy URL); apiVersion defaults to DEFAULT_WEBRTC_API_VERSION.
    connection: directOrProxyConnection({ model: 'gpt-realtime', transport: 'webrtc' }),
    session: sessionConfig()
      .instructions('You are a helpful assistant. Keep responses brief and friendly.')
      .voice({ name: 'en-US-AvaMultilingualNeural', type: 'azure-standard' })
      .semanticVAD({ interruptResponse: true })
      .transcription({ model: 'whisper-1' })
      // The assistant speaks first — audio arrives over RTP, the transcript over the data channel
      .greeting({ type: 'pregenerated', text: 'Hi! You are connected over WebRTC. How can I help?' })
      .build(),
    onTranscript,
    logLevel: 'debug',
  });

  // audioStream is the remote RTP track in WebRTC mode - same wiring as WebSocket mode
  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  // Small waveform: the hook feeds the analyser from the remote track as well
  useEffect(() => {
    if (!audioAnalyser || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = (): void => {
      animationFrameRef.current = requestAnimationFrame(draw);
      audioAnalyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0078d4';
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] ?? 128) / 128.0;
        const y = (v * canvas.height) / 2;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [audioAnalyser]);

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
      title="Voice over WebRTC (Preview)"
      description="Low-latency RTP audio with a WebSocket control channel and data-channel events. Same hook, same page code — only transport: 'webrtc' changes."
    >
      <ErrorPanel error={error || hookError} />

      <Section>
        <AlertBox variant="info" title="Preview limitations">
          <ul>
            <li>
              Voice only — the avatar is not supported over WebRTC (use{' '}
              <code>transport: 'websocket'</code> for avatar sessions).
            </li>
            <li>
              Requires api-version <code>{MIN_WEBRTC_API_VERSION}</code> or later; the
              WebRTC transport defaults to <code>{DEFAULT_WEBRTC_API_VERSION}</code>.
            </li>
            <li>
              Needs outbound UDP for the RTP media path. On UDP-restricted networks pass{' '}
              <code>rtcConfiguration</code> (TURN servers) or fall back to{' '}
              <code>transport: 'websocket'</code>.
            </li>
            <li>
              No viseme or word-timestamp events, and <code>getAudioPlaybackTime()</code>{' '}
              always returns <code>null</code> — the browser's RTP pipeline plays the audio.
            </li>
            <li>
              Tool/function-call events arrive on the WebSocket control channel; VAD,
              transcript and response lifecycle events arrive on the{' '}
              <code>voice-live-events</code> data channel. <code>onEvent</code> sees both.
            </li>
          </ul>
        </AlertBox>
      </Section>

      <ConfigPanel title="Transport">
        <ConfigItem label="Transport" value={transport} />
        <ConfigItem label="Model" value="gpt-realtime (default)" />
        <ConfigItem label="API version" value={DEFAULT_WEBRTC_API_VERSION} />
        <ConfigItem
          label="Session expires"
          value={sessionExpiresAt ? new Date(sessionExpiresAt).toLocaleTimeString() : '—'}
        />
      </ConfigPanel>

      <StatusBadge status={connectionState} />

      {isConnected && (
        <p style={{ margin: '0.5rem 0', fontStyle: 'italic' }}>
          {sessionStateLabel(sessionState)}
        </p>
      )}

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected}>
          Start Conversation
        </button>
        <button onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
        {isConnected && (
          <button onClick={toggleMute}>{isMuted ? 'Unmute' : 'Mute'}</button>
        )}
      </ControlGroup>

      {isConnected && (
        <TextInput onSend={sendText} placeholder="Send a text message over the control channel…" />
      )}

      <Section title="Remote Audio (RTP)">
        <canvas ref={canvasRef} width={800} height={120} className="canvas-display" />
      </Section>

      <TranscriptPanel transcripts={transcripts} />

      {/* audioStream is the remote RTP track - the page still owns playback */}
      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
