import { act, cleanup, renderHook, type RenderHookResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceLive } from './useVoiceLive';
import type { UseVoiceLiveConfig, UseVoiceLiveReturn } from '../types/voiceLive';

const capture = vi.hoisted(() => ({
  startCapture: vi.fn().mockResolvedValue(undefined),
  stopCapture: vi.fn(),
  toggleMute: vi.fn(),
}));
vi.mock('./useAudioCapture', () => ({
  useAudioCapture: () => ({ ...capture, isCapturing: false, isMuted: false }),
}));

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => Promise<void>) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { MockWebSocket.instances.push(this); }
  send(value: string): void { this.sent.push(JSON.parse(value)); }
  close(): void { this.readyState = 3; }
  async receive(value: unknown): Promise<void> {
    await this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent);
  }
}

async function connect(config: Partial<UseVoiceLiveConfig> = {}): Promise<RenderHookResult<UseVoiceLiveReturn, unknown> & { socket: MockWebSocket }> {
  const hook = renderHook(() => useVoiceLive({
    connection: { proxyUrl: 'ws://localhost/ws' }, autoStartMic: false, ...config,
  }));
  await act(async () => { await hook.result.current.connect(); });
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
  return { ...hook, socket };
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useVoiceLive protocol integration', () => {
  it('uses a native default voice when the service selects azure-realtime', async () => {
    const { socket } = await connect();
    await act(async () => { await socket.receive({ type: 'session.created', session: { model: 'azure-realtime' } }); });
    expect(socket.sent[0]?.session).toEqual(expect.objectContaining({
      voice: { type: 'azure-realtime-native', name: 'ava' },
    }));
  });
  it('exposes server expiration and clears it on disconnect', async () => {
    const { result, socket } = await connect();
    await act(async () => { await socket.receive({ type: 'session.created', session: { expires_at: 1234567890 } }); });
    expect(result.current.sessionExpiresAt).toBe(1234567890);
    await act(async () => { await socket.receive({ type: 'session.updated', session: {} }); });
    expect(result.current.sessionExpiresAt).toBe(1234567890);
    act(() => result.current.disconnect());
    expect(result.current.sessionExpiresAt).toBeNull();
  });

  it('updates only requested session fields without restoring startup defaults', async () => {
    const { result, socket } = await connect({ session: { instructions: 'Initial prompt', temperature: 0.9 } });
    act(() => result.current.updateSession({ inputAudioNoiseReduction: null }));
    expect(socket.sent).toEqual([{ type: 'session.update', session: { input_audio_noise_reduction: null } }]);
  });

  it('advertises the microphone override as the input sampling rate', async () => {
    const { socket } = await connect({ audioSampleRate: 16000 });
    await act(async () => { await socket.receive({ type: 'session.created', session: {} }); });
    expect(socket.sent[0]?.session).toEqual(expect.objectContaining({ input_audio_sampling_rate: 16000 }));
  });

  it('keeps agent restrictions when applying session patches', async () => {
    const { result, socket } = await connect({ connection: { proxyUrl: 'ws://localhost/ws?agentName=agent' } });
    act(() => result.current.updateSession({ instructions: 'ignored', temperature: 0.9, voice: 'alloy' }));
    expect(socket.sent[0]?.session).toEqual({ voice: { type: 'openai', name: 'alloy' } });
  });

  it('streams text with the documented id and content_index fields', async () => {
    const { result, socket } = await connect();
    act(() => {
      result.current.appendText('item_1', 'Hello ', 0);
      result.current.appendText('item_1', 'world');
      result.current.finishText('item_1', 0);
      result.current.createResponse({ maxResponseOutputTokens: 64 });
    });
    expect(socket.sent).toEqual([
      { type: 'input_text.delta', id: 'item_1', delta: 'Hello ', content_index: 0 },
      { type: 'input_text.delta', id: 'item_1', delta: 'world' },
      { type: 'input_text.done', id: 'item_1', content_index: 0 },
      { type: 'response.create', response: { max_response_output_tokens: 64 } },
    ]);
  });

  it('sends a pregenerated greeting using the documented wire format', async () => {
    const { socket } = await connect({ session: { greeting: { type: 'pregenerated', text: 'Welcome!' } } });
    await act(async () => { await socket.receive({ type: 'session.updated', session: {} }); });
    expect(socket.sent).toContainEqual(expect.objectContaining({
      type: 'response.create', response: { pre_generated_assistant_message: {
        type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Welcome!' }],
      } },
    }));
  });

  it('does not negotiate WebRTC for websocket avatar output', async () => {
    const peer = vi.fn();
    vi.stubGlobal('RTCPeerConnection', peer);
    const { result, socket } = await connect({ session: { avatar: { character: 'lisa', outputProtocol: 'websocket' } } });
    await act(async () => { await socket.receive({ type: 'session.updated', session: {
      avatar: { output_protocol: 'websocket', ice_servers: [] },
    } }); });
    expect(peer).not.toHaveBeenCalled();
    expect(result.current.isReady).toBe(true);
  });

  it('requires a custom capture stream for client echo reference', async () => {
    const { result } = await connect({ session: { inputAudioEchoCancellation: {
      type: 'server_echo_cancellation', referenceSource: 'client', channels: 2,
    } } });
    await expect(result.current.startMic()).rejects.toThrow('interleaved stereo');
    expect(capture.startCapture).not.toHaveBeenCalled();
  });

  it('prevents duplicate connections while a socket is already open', async () => {
    const { result } = await connect();
    await act(async () => { await result.current.connect(); });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it.each([
    ['pcm16', 24000, [0, 0, 1, 0], [0, 1]],
    ['pcm16_16000hz', 16000, [0, 0, 1, 0], [0, 1]],
    ['pcm16_8000hz', 8000, [0, 0, 1, 0], [0, 1]],
    ['g711_ulaw', 8000, [0xff, 0x7f, 0x80, 0x00], [0, 0, 32124, -32124]],
    ['g711_alaw', 8000, [0xd5, 0x55, 0xaa, 0x2a], [8, -8, 32256, -32256]],
  ] as const)('plays %s using its output rate independently of microphone input', async (format, rate, encoded, decoded) => {
    const postMessage = vi.fn();
    const worklet = vi.fn().mockImplementation(function () { return { port: { postMessage }, connect: vi.fn(), disconnect: vi.fn() }; });
    vi.stubGlobal('AudioWorkletNode', worklet);
    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function () { return {
      sampleRate: 48000, currentTime: 0, baseLatency: 0.01, state: 'running',
      audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
      createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
      createAnalyser: () => ({}),
      createMediaStreamDestination: () => ({ stream: {} }),
      close: vi.fn(),
    }; }));
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn().mockReturnValue('blob:test');
      static revokeObjectURL = vi.fn();
    });
    const { socket } = await connect({ audioSampleRate: 16000, session: { outputAudioFormat: format } });
    await act(async () => {
      socket.onopen?.();
      await socket.receive({ type: 'response.created', response: { id: 'response_1' } });
      await socket.receive({ type: 'response.audio.delta', response_id: 'response_1', delta: btoa(String.fromCharCode(...encoded)) });
    });
    expect(worklet).toHaveBeenCalledWith(expect.anything(), 'audio-playback-processor', {
      processorOptions: { sourceSampleRate: rate },
    });
    expect(Array.from(new Int16Array(postMessage.mock.calls[0]![0]))).toEqual(decoded);

    // A server-acknowledged format change must update both decoding and resampling.
    if (format === 'pcm16') {
      await act(async () => {
        await socket.receive({ type: 'session.updated', session: { output_audio_format: 'g711_ulaw' } });
        await socket.receive({ type: 'response.created', response: { id: 'response_2' } });
        await socket.receive({ type: 'response.audio.delta', response_id: 'response_2', delta: btoa(String.fromCharCode(0x80)) });
      });
      expect(postMessage.mock.calls[1]![0]).toEqual({ sourceSampleRate: 8000 });
      expect(Array.from(new Int16Array(postMessage.mock.calls[2]![0]))).toEqual([32124]);
    }
  });
});
