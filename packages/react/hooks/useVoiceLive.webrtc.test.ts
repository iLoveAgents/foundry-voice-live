import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceLive } from './useVoiceLive';
import type { VoiceLiveWebRTCTransport } from '../utils/webRTCTransport';
import type { UseVoiceLiveConfig } from '../types/voiceLive';

type Options = ConstructorParameters<typeof VoiceLiveWebRTCTransport>[0];
interface MockTransport {
  options: Options;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  sendEvent: ReturnType<typeof vi.fn>;
  startMic: ReturnType<typeof vi.fn>;
  stopMic: ReturnType<typeof vi.fn>;
  toggleMute: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  transports: [] as MockTransport[],
  startCapture: vi.fn(), stopCapture: vi.fn(), toggleMute: vi.fn(),
}));
vi.mock('./useAudioCapture', () => ({
  useAudioCapture: () => ({
    startCapture: mocks.startCapture, stopCapture: mocks.stopCapture,
    toggleMute: mocks.toggleMute, isCapturing: false, isMuted: false,
  }),
}));
vi.mock('../utils/webRTCTransport', () => ({
  VoiceLiveWebRTCTransport: vi.fn().mockImplementation(function (options: Options) {
    const transport: MockTransport = {
      options,
      connect: vi.fn(async () => { options.onStateChange('connecting'); }),
      disconnect: vi.fn(() => { options.onStateChange('disconnected'); }),
      sendEvent: vi.fn(),
      startMic: vi.fn(async () => { options.onMicStateChange(true, false); }),
      stopMic: vi.fn(() => { options.onMicStateChange(false, false); }),
      toggleMute: vi.fn(() => { options.onMicStateChange(true, true); }),
    };
    mocks.transports.push(transport);
    return transport;
  }),
}));

beforeEach(() => {
  mocks.transports = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

function renderVoice(overrides: Partial<UseVoiceLiveConfig> = {}): ReturnType<typeof renderHook<ReturnType<typeof useVoiceLive>, unknown>> {
  return renderHook(() => useVoiceLive({
    connection: { proxyUrl: 'ws://localhost/ws?model=azure-realtime', transport: 'webrtc' },
    autoStartMic: false, ...overrides,
  }));
}

describe('WebRTC hook integration', () => {
  it('uses updated microphone constraints after a device change without reconnecting', async () => {
    const { result, rerender } = renderHook(({ deviceId }) => useVoiceLive({
      connection: { proxyUrl: 'ws://localhost/ws?model=azure-realtime', transport: 'webrtc' },
      autoStartMic: false,
      audioConstraints: { deviceId: { exact: deviceId } },
    }), { initialProps: { deviceId: 'default' } });
    await act(async () => { await result.current.connect(); });
    rerender({ deviceId: 'physical-microphone' });
    await act(async () => { await result.current.startMic(); });
    expect(mocks.transports).toHaveLength(1);
    expect(mocks.transports[0]!.startMic).toHaveBeenCalledWith({ deviceId: { exact: 'physical-microphone' } });
  });

  it('configures the signaling transport and waits for media/data readiness', async () => {
    const { result } = renderVoice();
    await act(async () => { await result.current.connect(); });
    const rtc = mocks.transports[0]!;
    expect(new URL(rtc.options.url).searchParams.get('transport')).toBe('webrtc');
    expect(rtc.options.session.voice).toEqual({ type: 'azure-realtime-native', name: 'ava' });
    expect(rtc.options.autoStartMic).toBe(false);
    await act(async () => {
      rtc.options.onEvent({ type: 'session.created', session: { expires_at: 123 } });
      rtc.options.onEvent({ type: 'session.updated', session: {} });
    });
    expect(result.current.isReady).toBe(false);
    expect(result.current.connectionState).toBe('connecting');
    expect(result.current.sessionExpiresAt).toBe(123);
    expect(rtc.sendEvent).not.toHaveBeenCalled();
    act(() => rtc.options.onStateChange('connected'));
    expect(result.current.isReady).toBe(true);
    expect(result.current.connectionState).toBe('connected');
    expect(mocks.startCapture).not.toHaveBeenCalled();
  });

  it('exposes RTP audio and controls native microphone tracks', async () => {
    const { result } = renderVoice();
    await act(async () => { await result.current.connect(); });
    const rtc = mocks.transports[0]!;
    const stream = {} as MediaStream;
    act(() => { rtc.options.onStateChange('connected'); rtc.options.onAudioStream(stream); });
    expect(result.current.audioStream).toBe(stream);
    await act(async () => { await result.current.startMic(); });
    expect(result.current.isMicActive).toBe(true);
    act(() => result.current.toggleMute());
    expect(result.current.isMuted).toBe(true);
    act(() => result.current.stopMic());
    expect(result.current.isMicActive).toBe(false);
    expect(mocks.startCapture).not.toHaveBeenCalled();
    act(() => result.current.disconnect());
    expect(rtc.disconnect).toHaveBeenCalledOnce();
    expect(result.current.audioStream).toBeNull();
    expect(result.current.isReady).toBe(false);
  });

  it('sends controls and exposes transcript/tool events through the existing API', async () => {
    const onTranscript = vi.fn();
    const toolExecutor = vi.fn();
    const { result } = renderVoice({ onTranscript, toolExecutor });
    await act(async () => { await result.current.connect(); });
    const rtc = mocks.transports[0]!;
    act(() => {
      rtc.options.onStateChange('connected');
      result.current.updateSession({ instructions: 'Updated' });
      result.current.createResponse();
      result.current.appendText('item-1', 'hello');
      result.current.finishText('item-1');
    });
    expect(rtc.sendEvent.mock.calls.map(([event]) => event.type)).toEqual([
      'session.update', 'response.create', 'input_text.delta', 'input_text.done',
    ]);
    await act(async () => {
      rtc.options.onEvent({ type: 'response.audio_transcript.delta', delta: 'Hello' });
      rtc.options.onEvent({ type: 'response.function_call_arguments.done', name: 'lookup', arguments: '{}', call_id: 'call-1' });
    });
    expect(onTranscript).toHaveBeenCalledWith('assistant', 'Hello', false);
    expect(toolExecutor).toHaveBeenCalledWith('lookup', '{}', 'call-1');
  });

  it('recovers after a failed connection and ignores stale callbacks', async () => {
    const { result } = renderVoice();
    await act(async () => { await result.current.connect(); });
    const previous = mocks.transports[0]!;
    act(() => previous.options.onStateChange('error', new Error('ICE failed')));
    expect(result.current.error).toBe('ICE failed');
    expect(result.current.connectionState).toBe('error');
    await act(async () => { await result.current.connect(); });
    act(() => {
      mocks.transports[1]!.options.onStateChange('connected');
      previous.options.onStateChange('disconnected');
    });
    expect(result.current.isReady).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('rejects service-unsupported avatar combinations before opening transport', async () => {
    const { result } = renderVoice({ session: { avatar: { character: 'lisa' } } });
    await act(async () => { await result.current.connect(); });
    expect(result.current.error).toContain('does not support avatar');
    expect(mocks.transports).toHaveLength(0);
  });

  it('greets once per session, including after transient ICE recovery', async () => {
    const { result } = renderVoice({ session: { greeting: { type: 'llm', text: 'Say hello' } } });
    await act(async () => { await result.current.connect(); });
    const rtc = mocks.transports[0]!;
    act(() => rtc.options.onStateChange('connected'));
    expect(rtc.sendEvent).toHaveBeenCalledTimes(2);
    act(() => rtc.options.onStateChange('connecting'));
    act(() => rtc.options.onStateChange('connected'));
    expect(rtc.sendEvent).toHaveBeenCalledTimes(2);
    act(() => result.current.disconnect());
    await act(async () => { await result.current.connect(); });
    const next = mocks.transports[1]!;
    act(() => next.options.onStateChange('connected'));
    expect(next.sendEvent).toHaveBeenCalledTimes(2);
  });
});
