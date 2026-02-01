import { useRef, useEffect, useState, useCallback } from 'react';
import { useVoiceLive, createVoiceLiveConfig } from '@iloveagents/foundry-voice-live-react';
import { SampleLayout, StatusBadge, Section, ControlGroup, ErrorPanel } from '../components';

export function FunctionCalling(): JSX.Element {
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addLog = (message: string): void => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  // Define tools
  const tools = [
    {
      type: 'function' as const,
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
      type: 'function' as const,
      name: 'get_time',
      description: 'Get the current time',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  ];

  // Tool executor
  const toolExecutor = useCallback((toolName: string, args: string, callId: string) => {
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

      addLog(`✅ Result: ${JSON.stringify(result)}`);

      // Send result back to API
      sendEventRef.current({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result),
        },
      });

      // Trigger response generation
      sendEventRef.current({
        type: 'response.create',
      });
    } catch (err) {
      addLog(`❌ Error: ${err}`);
    }
  }, []);

  const sendEventRef = useRef<(event: Record<string, unknown>) => void>(() => {});

  const config = createVoiceLiveConfig({
    connection: {
      resourceName: import.meta.env.VITE_AZURE_AI_FOUNDRY_RESOURCE,
      apiKey: import.meta.env.VITE_AZURE_SPEECH_KEY,
    },
    session: {
      instructions: 'You are a helpful assistant. When the user asks about weather or time, use the available tools. Keep responses brief.',
      voice: {
        name: 'en-US-AvaMultilingualNeural',
        type: 'azure-standard',
      },
      tools,
      toolChoice: 'auto',
    },
  });

  const { connect, disconnect, connectionState, sendEvent, audioStream } = useVoiceLive({
    ...config,
    toolExecutor,
  });

  sendEventRef.current = sendEvent;

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

      <Section>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Available Tools</h3>
        <div style={{ marginBottom: '12px' }}>
          <strong style={{ display: 'block', marginBottom: '4px' }}>get_weather</strong>
          <span style={{ fontSize: '13px', color: '#666' }}>
            Get weather for a location. Parameters: location (required), unit (optional: celsius/fahrenheit)
          </span>
        </div>
        <div>
          <strong style={{ display: 'block', marginBottom: '4px' }}>get_time</strong>
          <span style={{ fontSize: '13px', color: '#666' }}>
            Get current time and timezone. No parameters required.
          </span>
        </div>
      </Section>

      <Section>
        <div style={{
          backgroundColor: '#f8f9fa',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px'
        }}>
          <strong style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Try saying:</strong>
          <ul style={{ marginLeft: '20px', fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
            <li>"What's the weather in London?"</li>
            <li>"What time is it?"</li>
            <li>"Tell me the weather in Tokyo in fahrenheit"</li>
          </ul>
        </div>
      </Section>

      <Section title="Tool Call Logs">
        <div style={{
          background: '#1e1e1e',
          color: '#d4d4d4',
          padding: '20px',
          borderRadius: '8px',
          maxHeight: '400px',
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '13px',
          lineHeight: '1.6',
          border: '1px solid #333'
        }}>
          {logs.length === 0 ? (
            <div style={{ color: '#888' }}>No tool calls yet. Start the conversation and ask about weather or time!</div>
          ) : (
            logs.map((log, i) => <div key={i} style={{ marginBottom: '4px' }}>{log}</div>)
          )}
        </div>
      </Section>

      <audio ref={audioRef} autoPlay style={{ display: 'none' }} />
    </SampleLayout>
  );
}
