import { useRef, useEffect, useState, useCallback } from 'react';
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';
import type { FunctionTool, InterimResponseConfig } from '@iloveagents/foundry-voice-live-react';
import {
  SampleLayout,
  StatusBadge,
  Section,
  ControlGroup,
  ErrorPanel,
  AlertBox,
  TextInput,
  TranscriptPanel,
} from '../components';
import { directOrProxyConnection } from '../lib/connection';
import { sessionStateLabel } from '../lib/sessionState';
import { useTranscripts } from '../lib/useTranscripts';

type FillerMode = 'llm' | 'static';

/** How long the fake backend takes - long enough for the 'tool' trigger to fire */
const TOOL_DELAY_MS = 4000;

const LOOKUP_ORDER_TOOL: FunctionTool = {
  type: 'function',
  name: 'lookup_order',
  description:
    'Look up the shipping status of a customer order by its order number. This is a slow backend call.',
  parameters: {
    type: 'object',
    properties: {
      orderNumber: {
        type: 'string',
        description: 'The order number, e.g. "12345"',
      },
    },
    required: ['orderNumber'],
  },
};

const STATIC_FILLER_TEXTS = [
  'Let me look that up for you...',
  'One moment while I check the system...',
  'Just a second, pulling up your order...',
];

/** Build the interim response config for the selected filler mode */
function buildInterimResponse(mode: FillerMode): InterimResponseConfig {
  if (mode === 'static') {
    return {
      type: 'static_interim_response',
      triggers: ['tool', 'latency'],
      latencyThresholdInMs: 1500,
      texts: STATIC_FILLER_TEXTS,
    };
  }
  return {
    type: 'llm_interim_response',
    triggers: ['tool', 'latency'],
    latencyThresholdInMs: 1500,
    instructions:
      'Create a short, friendly interim message telling the user you are still working on their request. One sentence only.',
  };
}

/**
 * Interim responses ("filler messages while thinking").
 *
 * The service speaks a short bridging message while a tool call runs (`tool`
 * trigger) or when the response takes longer than the threshold (`latency`
 * trigger). Interim responses need a cascaded text model (gpt-4.1 here) with an
 * Azure voice, or Foundry agent mode - native audio models such as gpt-realtime
 * do not support them.
 *
 * The tool executor deliberately waits a few seconds and then RETURNS its result:
 * the hook sends it as `function_call_output` and triggers the follow-up response.
 */
export function InterimResponse(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<FillerMode>('static');
  const [logs, setLogs] = useState<string[]>([]);
  // Interim messages show up in the transcript as assistant turns
  const { transcripts, onTranscript, clear: clearTranscripts } = useTranscripts();

  const addLog = useCallback((message: string): void => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  // Slow tool: await the "backend", then return the result object.
  // Returning a value lets the hook send function_call_output + response.create.
  const toolExecutor = useCallback(
    async (name: string, args: string): Promise<Record<string, unknown>> => {
      addLog(`Tool called: ${name}(${args})`);

      if (name !== 'lookup_order') {
        return { error: `Unknown tool: ${name}` };
      }

      const { orderNumber = 'unknown' } = JSON.parse(args) as { orderNumber?: string };
      addLog(`Simulating a slow backend (${TOOL_DELAY_MS / 1000}s)...`);
      await new Promise((resolve) => setTimeout(resolve, TOOL_DELAY_MS));

      const result = {
        orderNumber,
        status: 'shipped',
        carrier: 'Contoso Express',
        estimatedDelivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toDateString(),
      };
      addLog(`Tool result: ${JSON.stringify(result)}`);
      return result;
    },
    [addLog]
  );

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
    connection: directOrProxyConnection({ model: 'gpt-4.1' }),
    session: sessionConfig()
      .instructions(
        'You are a friendly order-support assistant. When the user asks about an order, call lookup_order with the order number and then summarize the result in one sentence. Keep responses brief.'
      )
      .voice({ name: 'en-US-Ava:DragonHDLatestNeural', type: 'azure-standard' })
      .transcription({ model: 'azure-speech', language: 'en' })
      .tools([LOOKUP_ORDER_TOOL])
      .interimResponse(buildInterimResponse(mode))
      .build(),
    toolExecutor,
    onTranscript,
    onWarning: (warning) => addLog(`Warning: ${warning.message}`),
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
      setLogs([]);
      addLog(`Connecting with ${mode === 'llm' ? 'LLM-generated' : 'static'} interim responses`);
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
      title="Interim Responses"
      description="Filler messages while a slow tool runs or latency is high. Ask about an order - the lookup takes ~4 s and the assistant bridges the wait."
    >
      <ErrorPanel error={error || hookError} />

      <Section>
        <AlertBox variant="warning" title="Model requirement">
          <p>
            Interim responses are only supported with cascaded text models (this page uses{' '}
            <code>gpt-4.1</code>) combined with Azure voices, or in Foundry agent mode. They are{' '}
            <strong>not</strong> supported by native audio models such as <code>gpt-realtime</code>,{' '}
            <code>gpt-realtime-mini</code> or <code>azure-realtime</code>.
          </p>
          <p>
            Measured live (August 2026, 6 s <em>client-side</em> tool): the{' '}
            <code>static_interim_response</code> filler was spoken in every run, while{' '}
            <code>llm_interim_response</code> produced a filler in 1 of 11 runs regardless of{' '}
            <code>model</code>/<code>instructions</code>/<code>latency</code> settings. Prefer
            static texts for client-side tools; LLM-generated fillers suit server-side waits (MCP
            servers, Foundry agent tools).
          </p>
        </AlertBox>
      </Section>

      <Section title="Filler Mode">
        <ControlGroup>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="radio"
              name="filler-mode"
              value="llm"
              checked={mode === 'llm'}
              disabled={isConnected}
              onChange={() => setMode('llm')}
            />
            LLM-generated (<code>llm_interim_response</code>)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="radio"
              name="filler-mode"
              value="static"
              checked={mode === 'static'}
              disabled={isConnected}
              onChange={() => setMode('static')}
            />
            Static texts (<code>static_interim_response</code>)
          </label>
        </ControlGroup>
        <p style={{ fontSize: '14px' }}>
          Triggers: <code>tool</code> + <code>latency</code> (threshold 1500 ms). The mode is part
          of the session config, so change it before connecting (or stop and reconnect).
        </p>
      </Section>

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

      <Section>
        <div className="try-suggestions">
          <span className="try-suggestions__title">Try saying:</span>
          <ul className="try-suggestions__list">
            <li>"Where is my order 12345?"</li>
            <li>"Can you check the status of order number 98765?"</li>
          </ul>
        </div>
      </Section>

      <TranscriptPanel transcripts={transcripts} />

      <Section title="Tool Call Log">
        <div className="code-block code-block--compact">
          {logs.length === 0 ? (
            <div className="code-block__placeholder">
              No tool calls yet. Start the conversation and ask about an order.
            </div>
          ) : (
            logs.map((log, i) => <div key={i}>{log}</div>)
          )}
        </div>
      </Section>

      <audio ref={audioRef} autoPlay hidden />
    </SampleLayout>
  );
}
