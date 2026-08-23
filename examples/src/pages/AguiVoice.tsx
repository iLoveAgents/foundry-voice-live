import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import {
  useVoiceLiveAgent,
  useVoiceLiveAgentBinding,
} from '@iloveagents/foundry-voice-live-agui/react';
import type { VoiceLiveAgent } from '@iloveagents/foundry-voice-live-agui/react';
import {
  SampleLayout,
  StatusBadge,
  Section,
  ControlGroup,
  ErrorPanel,
  TranscriptPanel,
  TextInput,
} from '../components';
import { directOrProxyConnection } from '../lib/connection';
import type { TranscriptEntry } from '../lib/useTranscripts';

/**
 * Voice → AG-UI bridge, rendered by our own UI (no CopilotKit needed).
 *
 * `useVoiceLiveAgent` builds a standard AG-UI `AbstractAgent`; `useVoiceLiveAgentBinding` runs a
 * Voice Live session and streams every server event into it as AG-UI events. This page then renders
 * the agent's own state — `agent.messages`, `agent.state.voice`, and the raw event stream — so you
 * can watch a spoken turn become a legal AG-UI run. The same agent drops into any AG-UI UI.
 */
export function AguiVoice(): JSX.Element {
  const [transport, setTransport] = useState<'websocket' | 'webrtc'>('websocket');
  const agent = useVoiceLiveAgent({ threadId: 'agui-demo', transport });

  const config = useMemo(
    () =>
      createVoiceLiveConfig({
        // The bridge is transport-agnostic: `onEvent` fires the same Voice Live server events over a
        // WebSocket or a WebRTC data channel, so `transport: 'webrtc'` is the only change needed.
        connection: directOrProxyConnection({ transport }),
        session: {
          instructions:
            'You are a friendly voice assistant. Answer in one or two short sentences so replies are quick to speak.',
          voice: { name: 'en-US-AvaMultilingualNeural', type: 'azure-standard' },
        },
      }),
    [transport]
  );

  const voice = useVoiceLiveAgentBinding(agent, config);
  const view = useAgentView(agent);

  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audioRef.current && voice.audioStream) {
      audioRef.current.srcObject = voice.audioStream;
      audioRef.current.play().catch(() => {});
    }
  }, [voice.audioStream]);

  const connected = voice.connectionState === 'connected';
  const vs = (view.state.voice ?? {}) as VoiceStateShape;

  const transcripts: TranscriptEntry[] = view.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      text: messageText(m),
      isFinal: true,
    }));

  const handleType = (text: string): void => {
    // Drive the agent's typed-turn path: it forwards to the wire and streams the answer back.
    const id = newId('typed');
    agent.addMessage({ id, role: 'user', content: text });
    void agent.runAgent();
  };

  return (
    <SampleLayout
      title="AG-UI Voice"
      description="Bridge a live Voice Live session to the AG-UI protocol and render it with plain React — messages, state, and the raw AG-UI event stream, no agent UI framework required."
    >
      <ErrorPanel error={voice.error} />

      <div
        className="agui-status-row"
        style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <StatusBadge status={voice.connectionState} />
        <SessionStateChip state={vs.sessionState ?? 'idle'} />
        <span style={{ fontSize: '0.85rem', opacity: 0.75 }}>
          mic {vs.isMicActive ? (vs.isMuted ? 'muted' : 'on') : 'off'} · transport {voice.transport}
        </span>
      </div>

      <Section>
        <ControlGroup>
          <button onClick={() => void voice.connect()} disabled={connected}>
            Start Conversation
          </button>
          <button onClick={() => voice.disconnect()} disabled={!connected}>
            Stop
          </button>
          <button onClick={() => voice.toggleMute()} disabled={!connected}>
            {voice.isMuted ? 'Unmute' : 'Mute'}
          </button>
        </ControlGroup>
        <div
          style={{
            marginTop: '0.75rem',
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            fontSize: '0.9rem',
          }}
        >
          <span style={{ opacity: 0.75 }}>Transport:</span>
          {(['websocket', 'webrtc'] as const).map((t) => (
            <label
              key={t}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                cursor: connected ? 'not-allowed' : 'pointer',
                opacity: connected ? 0.5 : 1,
              }}
            >
              <input
                type="radio"
                name="transport"
                checked={transport === t}
                disabled={connected}
                onChange={() => setTransport(t)}
              />
              {t === 'websocket' ? 'WebSocket' : 'WebRTC (preview)'}
            </label>
          ))}
          {connected ? <span style={{ opacity: 0.6 }}>· disconnect to switch</span> : null}
        </div>
      </Section>

      <TranscriptPanel transcripts={transcripts} title="Conversation (from agent.messages)" />

      <TextInput
        onSend={handleType}
        disabled={!connected}
        title="Type a turn"
        placeholder={connected ? 'Type instead of talking…' : 'Connect first, then type…'}
      />

      <Section title="Offline demo — no Azure needed">
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', opacity: 0.8 }}>
          Feed a canned Voice Live turn through the real bridge (mapper → agent) to see it become an
          AG-UI run without connecting.
        </p>
        <ControlGroup>
          <button onClick={() => simulateTurn(agent)}>Simulate a spoken turn</button>
        </ControlGroup>
      </Section>

      <Section title="AG-UI event stream">
        <div className="code-block" style={{ maxHeight: 260, overflowY: 'auto' }}>
          {view.raw.length === 0 ? (
            <div className="code-block__placeholder">
              No events yet. Start a conversation, type a turn, or simulate one.
            </div>
          ) : (
            view.raw.map((e) => (
              <div key={e.n}>
                <span style={{ opacity: 0.5 }}>{String(e.n).padStart(3, '0')}</span> {e.type}
                {e.detail ? <span style={{ opacity: 0.6 }}> · {e.detail}</span> : null}
              </div>
            ))
          )}
        </div>
      </Section>

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}

/** The shape the mapper stores under `agent.state.voice` (a subset we render). */
interface VoiceStateShape {
  sessionState?: 'idle' | 'listening' | 'thinking' | 'speaking';
  isMicActive?: boolean;
  isMuted?: boolean;
  isReady?: boolean;
}

interface RawEvent {
  n: number;
  type: string;
  detail: string;
}

interface AgentView {
  messages: VoiceLiveAgent['messages'];
  state: VoiceLiveAgent['state'];
  raw: RawEvent[];
}

/** Mirror the agent's AG-UI state into React: re-render on message/state change; tail the event stream. */
function useAgentView(agent: VoiceLiveAgent): AgentView {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const rawRef = useRef<RawEvent[]>([]);
  const nRef = useRef(0);

  useEffect(() => {
    const sub = agent.subscribe({
      onMessagesChanged: () => force(),
      onStateChanged: () => force(),
      onRunFinalized: () => force(),
      onRunFailed: () => force(),
    });
    const stream = agent.events$.subscribe((e) => {
      const type = (e as { type?: string }).type ?? 'UNKNOWN';
      rawRef.current = [
        ...rawRef.current.slice(-300),
        { n: ++nRef.current, type, detail: eventDetail(e) },
      ];
      force();
    });
    return () => {
      sub.unsubscribe();
      stream.unsubscribe();
    };
  }, [agent]);

  return { messages: agent.messages, state: agent.state, raw: rawRef.current };
}

/** A short human hint for the raw-stream panel (the delta text, the message/tool id). */
function eventDetail(e: unknown): string {
  const ev = e as { delta?: string; messageId?: string; toolCallName?: string };
  if (typeof ev.delta === 'string') return JSON.stringify(ev.delta);
  if (ev.toolCallName) return ev.toolCallName;
  if (ev.messageId) return ev.messageId;
  return '';
}

function messageText(m: { content?: unknown }): string {
  return typeof m.content === 'string' ? m.content : '';
}

function SessionStateChip({ state }: { state: string }): JSX.Element {
  const color =
    state === 'speaking'
      ? '#4CAF50'
      : state === 'listening'
        ? '#2196F3'
        : state === 'thinking'
          ? '#FF9800'
          : '#9E9E9E';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        lineHeight: 1,
        fontSize: '0.8rem',
        fontWeight: 600,
        padding: '0.3rem 0.65rem',
        borderRadius: '999px',
        background: color,
        color: 'white',
      }}
    >
      {state}
    </span>
  );
}

let idSeq = 0;
function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Feed a canned Voice Live turn through the real bridge — the exact code a live session drives, so
 * the offline demo is a faithful proof, not a mock. A user transcription plus a multi-delta
 * assistant answer, so the transcript streams and the run opens and closes cleanly.
 */
function simulateTurn(agent: VoiceLiveAgent): void {
  const rid = newId('resp');
  const uid = newId('user');
  const aid = newId('asst');
  const deltas = [
    'I can ',
    'answer questions, ',
    'call tools, ',
    'and stream every ',
    'reply as AG-UI events.',
  ];
  const events: Array<Record<string, unknown>> = [
    { type: 'input_audio_buffer.speech_started', audio_start_ms: 0, item_id: uid },
    {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: uid,
      content_index: 0,
      transcript: 'What can you do?',
    },
    { type: 'response.created', response: { id: rid } },
    ...deltas.map((delta) => ({
      type: 'response.audio_transcript.delta',
      response_id: rid,
      item_id: aid,
      output_index: 0,
      content_index: 0,
      delta,
    })),
    {
      type: 'response.audio_transcript.done',
      response_id: rid,
      item_id: aid,
      output_index: 0,
      content_index: 0,
      transcript: deltas.join(''),
    },
    { type: 'response.done', response: { id: rid, status: 'completed', output: [] } },
  ];
  for (const e of events) {
    const { runOpened } = agent.ingestServerEvent(e as never);
    if (runOpened) void agent.pump();
  }
}
