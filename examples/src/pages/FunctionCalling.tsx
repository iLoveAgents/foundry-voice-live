import { useRef, useEffect, useState, useCallback } from 'react';
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import type { FunctionTool } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, Section, ControlGroup, ErrorPanel } from '../components';
import { directOrProxyConnection } from '../lib/connection';

// Tool definitions (JSON schema parameters)
const TOOLS: FunctionTool[] = [
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get the current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name or location',
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature unit',
        },
      },
      required: ['location'],
    },
  },
  {
    type: 'function',
    name: 'get_time',
    description: 'Get the current time',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

export function FunctionCalling(): JSX.Element {
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addLog = useCallback((message: string): void => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  // Tool executor: RETURN the result and the hook sends it as
  // function_call_output and triggers the next response automatically.
  // (Return undefined to send it yourself later via sendToolResult().)
  const toolExecutor = useCallback(
    async (toolName: string, args: string): Promise<Record<string, unknown>> => {
      addLog(`🔧 Tool called: ${toolName}`);
      addLog(`📥 Args: ${args}`);

      let result: Record<string, unknown>;

      try {
        const parsedArgs = JSON.parse(args);

        // Execute tool
        if (toolName === 'get_weather') {
          result = {
            location: parsedArgs.location,
            temperature: Math.floor(Math.random() * 30) + 10,
            unit: parsedArgs.unit || 'celsius',
            condition: ['Sunny', 'Cloudy', 'Rainy', 'Windy'][Math.floor(Math.random() * 4)],
          };
        } else if (toolName === 'get_time') {
          result = {
            time: new Date().toLocaleTimeString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
        } else {
          result = { error: 'Unknown tool' };
        }
      } catch (err) {
        addLog(`❌ Error: ${err}`);
        result = { error: err instanceof Error ? err.message : String(err) };
      }

      addLog(`✅ Result: ${JSON.stringify(result)}`);
      return result;
    },
    [addLog]
  );

  const config = createVoiceLiveConfig({
    // Direct with the dev API key when configured, otherwise through the proxy (keyless)
    connection: directOrProxyConnection(),
    session: {
      instructions:
        'You are a helpful assistant. When the user asks about weather or time, use the available tools. Keep responses brief.',
      voice: {
        name: 'en-US-AvaMultilingualNeural',
        type: 'azure-standard',
      },
      tools: TOOLS,
      toolChoice: 'auto',
    },
    toolExecutor,
    logLevel: 'debug',
  });

  const { connect, disconnect, connectionState, audioStream } = useVoiceLive(config);

  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  const handleStart = async (): Promise<void> => {
    addLog('Starting...');
    try {
      setError(null);
      await connect();
      addLog('Connected - mic will auto-start');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start';
      setError(message);
      addLog(`Error: ${err}`);
    }
  };

  const handleStop = (): void => {
    disconnect();
    setError(null);
    addLog('Stopped');
  };

  return (
    <SampleLayout
      title="Function Calling"
      description="Tool/function definition system with custom tools. Ask about weather or time to see functions in action."
    >
      <ErrorPanel error={error} />

      <StatusBadge status={connectionState} />

      <Section>
        <ControlGroup>
          <button onClick={handleStart} disabled={connectionState === 'connected'}>
            Start Conversation
          </button>
          <button onClick={handleStop} disabled={connectionState !== 'connected'}>
            Stop
          </button>
        </ControlGroup>
      </Section>

      <Section title="Available Tools">
        <div className="tool-info">
          <span className="tool-info__name">get_weather</span>
          <span className="tool-info__description">
            Get weather for a location. Parameters: location (required), unit (optional:
            celsius/fahrenheit)
          </span>
        </div>
        <div className="tool-info">
          <span className="tool-info__name">get_time</span>
          <span className="tool-info__description">
            Get current time and timezone. No parameters required.
          </span>
        </div>
      </Section>

      <Section>
        <div className="try-suggestions">
          <span className="try-suggestions__title">Try saying:</span>
          <ul className="try-suggestions__list">
            <li>"What's the weather in London?"</li>
            <li>"What time is it?"</li>
            <li>"Tell me the weather in Tokyo in fahrenheit"</li>
          </ul>
        </div>
      </Section>

      <Section title="Tool Call Logs">
        <div className="code-block">
          {logs.length === 0 ? (
            <div className="code-block__placeholder">
              No tool calls yet. Start the conversation and ask about weather or time!
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
