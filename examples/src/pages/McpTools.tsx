import { useRef, useEffect, useState, useCallback } from 'react';
import { useVoiceLive, sessionConfig } from '@iloveagents/foundry-voice-live-react';
import type {
  McpApprovalRequest,
  UseVoiceLiveReturn,
  VoiceLiveServerEvent,
} from '@iloveagents/foundry-voice-live-react';
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

const MCP_SERVER_LABEL = 'mslearn';
const DEFAULT_MCP_SERVER_URL = 'https://learn.microsoft.com/api/mcp';

/**
 * Server-side MCP tools with an approval flow.
 *
 * Voice Live connects to the remote MCP server itself: it discovers the tools
 * (`mcp_list_tools.*`), lets the model call them and executes the calls
 * (`response.mcp_call*`). Nothing runs in the browser.
 *
 * With `requireApproval: 'always'` every call first arrives as an
 * `mcp_approval_request` item - the hook surfaces it via `onMcpApprovalRequest`
 * and the page answers with `approveMcpCall(id, true | false)`.
 */
export function McpTools(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(DEFAULT_MCP_SERVER_URL);
  const [requireApproval, setRequireApproval] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [discoveredTools, setDiscoveredTools] = useState<string[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<McpApprovalRequest[]>([]);
  // Accumulates partial and final transcripts
  const { transcripts, onTranscript, clear: clearTranscripts } = useTranscripts();

  // Response bookkeeping so we can nudge the model after a server-side tool call
  const sendEventRef = useRef<UseVoiceLiveReturn['sendEvent']>(() => false);
  /**
   * `createResponse()` instead of a raw `response.create`: the hook serializes turns
   * (`ResponseGate`), so a follow-up here can never overlap a turn the user submitted meanwhile —
   * the service rejects overlapping responses.
   */
  const createResponseRef = useRef<UseVoiceLiveReturn['createResponse']>(() => {});
  const responseActiveRef = useRef(false);
  const mcpCallsInProgressRef = useRef(0);
  const followUpNeededRef = useRef(false);

  const addLog = useCallback((message: string): void => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  // Approval requests are queued and answered from the UI (see respondToApproval)
  const handleApprovalRequest = useCallback(
    (request: McpApprovalRequest): void => {
      addLog(`Approval requested: ${request.serverLabel}/${request.name} ${request.arguments}`);
      setPendingApprovals((prev) => [...prev, request]);
    },
    [addLog]
  );

  // Log the MCP lifecycle. `event.type` narrows the typed union.
  const handleEvent = useCallback(
    (event: VoiceLiveServerEvent): void => {
      switch (event.type) {
        case 'response.created':
          responseActiveRef.current = true;
          break;

        case 'response.done': {
          responseActiveRef.current = false;
          if (followUpNeededRef.current) {
            followUpNeededRef.current = false;
            // If the response that ran the tool ended without a spoken message,
            // ask the model to continue so it can present the result.
            const spoke = (event.response.output ?? []).some((item) => item.type === 'message');
            if (!spoke) {
              addLog('Tool result received - requesting the spoken answer');
              createResponseRef.current();
            }
          }
          break;
        }

        case 'conversation.item.created': {
          const item = event.item;
          if (item.type === 'mcp_list_tools') {
            // The item is created before discovery finishes; the tool list is fetched with
            // conversation.item.retrieve once mcp_list_tools.completed arrives (see below).
            const tools = (item.tools as Array<{ name?: string }> | undefined) ?? [];
            if (tools.length > 0) {
              setDiscoveredTools(tools.map((tool) => tool.name ?? '?'));
            }
          } else if (item.type === 'mcp_call') {
            addLog(`MCP call: ${item.server_label ?? '?'}/${item.name ?? '?'}`);
          }
          break;
        }

        case 'mcp_list_tools.in_progress':
          addLog('Discovering MCP tools...');
          break;
        case 'mcp_list_tools.completed':
          addLog('MCP tool discovery completed');
          // Fetch the populated mcp_list_tools item to show the discovered tools
          sendEventRef.current({ type: 'conversation.item.retrieve', item_id: event.item_id as string });
          break;

        case 'conversation.item.retrieved': {
          const item = event.item as
            | { type?: string; server_label?: string; tools?: Array<{ name?: string }> }
            | undefined;
          if (item?.type === 'mcp_list_tools') {
            const names = (item.tools ?? []).map((tool) => tool.name ?? '?');
            setDiscoveredTools(names);
            addLog(`Discovered ${names.length} tool(s) on ${item.server_label ?? '?'}: ${names.join(', ')}`);
          }
          break;
        }
        case 'mcp_list_tools.failed':
          addLog('MCP tool discovery FAILED - check the server URL');
          break;

        case 'response.mcp_call_arguments.done':
          addLog(`MCP call arguments: ${String(event.arguments ?? '')}`);
          break;

        case 'response.mcp_call.in_progress':
          mcpCallsInProgressRef.current += 1;
          addLog(`MCP call in progress (${String(event.item_id ?? '')})`);
          break;

        case 'response.mcp_call.completed':
        case 'response.mcp_call.failed': {
          mcpCallsInProgressRef.current = Math.max(0, mcpCallsInProgressRef.current - 1);
          addLog(
            event.type === 'response.mcp_call.completed' ? 'MCP call completed' : 'MCP call FAILED'
          );
          if (mcpCallsInProgressRef.current === 0) {
            // The service executed the tool - make sure the model speaks the result.
            if (responseActiveRef.current) {
              followUpNeededRef.current = true; // decided at response.done
            } else {
              createResponseRef.current();
            }
          }
          break;
        }

        default:
          break;
      }
    },
    [addLog]
  );

  const {
    connect,
    disconnect,
    connectionState,
    sessionState,
    audioStream,
    sendEvent,
    createResponse,
    approveMcpCall,
    isMuted,
    toggleMute,
    sendText,
    error: hookError,
  } = useVoiceLive({
    // Direct with the dev API key, or through the proxy when no key is configured
    connection: directOrProxyConnection(),
    session: sessionConfig()
      .instructions(
        'You are a helpful assistant with access to Microsoft Learn documentation through MCP tools. Use them to answer questions about Azure and Microsoft products, then summarize the answer in one or two spoken sentences.'
      )
      .hdVoice('en-US-Ava:DragonHDLatestNeural')
      .transcription({ model: 'whisper-1' })
      .mcpServer({
        serverLabel: MCP_SERVER_LABEL,
        serverUrl,
        requireApproval: requireApproval ? 'always' : 'never',
      })
      .build(),
    onTranscript,
    onMcpApprovalRequest: handleApprovalRequest,
    onEvent: handleEvent,
    logLevel: 'debug',
  });

  useEffect(() => {
    sendEventRef.current = sendEvent;
    createResponseRef.current = createResponse;
  }, [sendEvent, createResponse]);

  useEffect(() => {
    if (audioRef.current && audioStream) {
      audioRef.current.srcObject = audioStream;
      audioRef.current.play().catch(console.error);
    }
  }, [audioStream]);

  const respondToApproval = (request: McpApprovalRequest, approve: boolean): void => {
    approveMcpCall(request.approvalRequestId, approve);
    addLog(`${approve ? 'Approved' : 'Denied'} ${request.serverLabel}/${request.name}`);
    setPendingApprovals((prev) =>
      prev.filter((pending) => pending.approvalRequestId !== request.approvalRequestId)
    );
  };

  const handleStart = async (): Promise<void> => {
    try {
      setError(null);
      clearTranscripts();
      setLogs([]);
      setDiscoveredTools([]);
      setPendingApprovals([]);
      responseActiveRef.current = false;
      mcpCallsInProgressRef.current = 0;
      followUpNeededRef.current = false;
      addLog(`Connecting with MCP server ${MCP_SERVER_LABEL} → ${serverUrl}`);
      await connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start';
      setError(message);
      console.error('Start error:', err);
    }
  };

  const handleStop = (): void => {
    disconnect();
    setPendingApprovals([]);
    setError(null);
  };

  const isConnected = connectionState === 'connected';

  return (
    <SampleLayout
      title="MCP Server Tools"
      description="Server-side MCP tools with an approval flow. Voice Live discovers and executes the tools of a remote MCP server; each call can require your approval first."
    >
      <ErrorPanel error={error || hookError} />

      <Section>
        <AlertBox variant="info" title="How it works">
          <p>
            The MCP server is part of the session config (<code>sessionConfig().mcpServer()</code>
            ). Voice Live discovers its tools at session start and executes calls on the server —
            nothing runs in the browser. With <code>requireApproval: 'always'</code> every call
            pauses until you approve or deny it below.
          </p>
        </AlertBox>
      </Section>

      <Section title="MCP Server">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '520px' }}>
          <label style={{ fontSize: '14px' }}>
            Server URL (label <code>{MCP_SERVER_LABEL}</code>)
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={isConnected}
              spellCheck={false}
              style={{
                display: 'block',
                width: '100%',
                marginTop: '0.25rem',
                padding: '8px 10px',
                fontSize: '14px',
                border: '1px solid #ccc',
                borderRadius: '6px',
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={requireApproval}
              disabled={isConnected}
              onChange={(e) => setRequireApproval(e.target.checked)}
            />
            Require approval for every tool call (<code>requireApproval: 'always'</code>)
          </label>
        </div>
      </Section>

      <StatusBadge status={connectionState} />

      {isConnected && (
        <p style={{ margin: '0.5rem 0', fontStyle: 'italic' }}>
          {sessionStateLabel(sessionState)}
        </p>
      )}

      <ControlGroup>
        <button onClick={handleStart} disabled={isConnected || !serverUrl.trim()}>
          Start Conversation
        </button>
        <button onClick={handleStop} disabled={!isConnected}>
          Stop
        </button>
        {isConnected && (
          <button onClick={toggleMute}>{isMuted ? 'Unmute' : 'Mute'}</button>
        )}
      </ControlGroup>

      {isConnected && <TextInput onSend={sendText} />}

      {pendingApprovals.length > 0 && (
        <Section title="Pending Approvals">
          {pendingApprovals.map((request) => (
            <AlertBox
              key={request.approvalRequestId}
              variant="warning"
              title={`${request.serverLabel}/${request.name}`}
            >
              <p>
                <code>{request.arguments || '{}'}</code>
              </p>
              <ControlGroup>
                <button onClick={() => respondToApproval(request, true)}>Approve</button>
                <button onClick={() => respondToApproval(request, false)}>Deny</button>
              </ControlGroup>
            </AlertBox>
          ))}
        </Section>
      )}

      <Section>
        <div className="try-suggestions">
          <span className="try-suggestions__title">Try saying:</span>
          <ul className="try-suggestions__list">
            <li>"Search Microsoft Learn for the Voice Live API and tell me what it is."</li>
            <li>"How do I enable echo cancellation in Voice Live?"</li>
          </ul>
        </div>
      </Section>

      <Section title="Discovered Tools">
        {discoveredTools.length === 0 ? (
          <p style={{ fontSize: '14px' }}>
            No tools discovered yet - they are listed after the session starts.
          </p>
        ) : (
          discoveredTools.map((name) => (
            <div key={name} className="tool-info">
              <span className="tool-info__name">{name}</span>
            </div>
          ))
        )}
      </Section>

      <TranscriptPanel transcripts={transcripts} />

      <Section title="MCP Event Log">
        <div className="code-block code-block--compact">
          {logs.length === 0 ? (
            <div className="code-block__placeholder">
              No MCP events yet. Start the conversation and ask a documentation question.
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
