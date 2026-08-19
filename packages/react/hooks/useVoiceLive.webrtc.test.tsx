/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * useVoiceLive — WebRTC transport behaviour (fake RTCPeerConnection / WebSocket / AudioContext)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceLive } from './useVoiceLive';
import {
  FakeWebSocket,
  FakePeerConnection,
  FakeAudioContext,
  installBrowserFakes,
  makeFakeMicStream,
} from './testFakes';
import type { UseVoiceLiveConfig } from '../types/voiceLive';

let restore: () => void;
let mic: ReturnType<typeof makeFakeMicStream>;

beforeEach(() => {
  mic = makeFakeMicStream();
  restore = installBrowserFakes({ getUserMedia: async () => mic.stream });
});

afterEach(() => {
  restore();
});

const baseConfig: UseVoiceLiveConfig = {
  connection: { resourceName: 'my-res', apiKey: 'secret', transport: 'webrtc' },
  session: { instructions: 'Be nice.', voice: { name: 'en-US-AvaNeural', type: 'azure-standard' } },
  autoStartMic: false,
  logLevel: 'none',
};

async function connectWebRtc(config: UseVoiceLiveConfig) {
  const hook = renderHook(() => useVoiceLive(config));
  await act(async () => {
    await hook.result.current.connect();
  });
  // Always use the most recent fakes (a test may connect more than once)
  const pc = FakePeerConnection.instances[FakePeerConnection.instances.length - 1]!;
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  await act(async () => {
    ws.open();
  });
  return { hook, pc, ws, dc: pc.dataChannels[0]! };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useVoiceLive (webrtc)', () => {
  it('negotiates over the /calls control channel and sends rtc.call.sdp.create with the session', async () => {
    const { hook, pc, ws } = await connectWebRtc(baseConfig);

    expect(hook.result.current.transport).toBe('webrtc');
    expect(ws.url).toContain('wss://my-res.services.ai.azure.com/voice-live/realtime/calls?');
    expect(ws.url).toContain('api-version=2026-01-01-preview');
    expect(pc.dataChannels[0]?.label).toBe('voice-live-events');
    expect(pc.transceivers[0]).toMatchObject({ kindOrTrack: 'audio', init: { direction: 'sendrecv' } });

    // First message on the control channel is the SDP offer with the session config
    expect(ws.sent[0].type).toBe('rtc.call.sdp.create');
    expect(ws.sent[0].sdp_offer).toBe('v=0 offer');
    expect(ws.sent[0].session.instructions).toBe('Be nice.');
    expect(ws.sent[0].session.voice).toEqual({ name: 'en-US-AvaNeural', type: 'azure-standard' });

    // session.created must NOT trigger a session.update in webrtc mode
    await act(async () => {
      ws.receive({ type: 'session.created', session: { id: 's' } });
    });
    expect(ws.sent.filter((e) => e.type === 'session.update')).toHaveLength(0);

    // Answer → remote description; readiness follows the peer connection state
    await act(async () => {
      ws.receive({ type: 'rtc.call.sdp.created', sdp_answer: 'v=0 answer' });
    });
    await flush();
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    expect(hook.result.current.isReady).toBe(false);

    await act(async () => {
      pc.setConnectionState('connected');
    });
    // Media alone is not enough — the events data channel must be open too
    expect(hook.result.current.isReady).toBe(false);
    await act(async () => {
      pc.dataChannels[0]!.open();
    });
    expect(hook.result.current.isReady).toBe(true);
    expect(hook.result.current.sessionState).toBe('listening');
    hook.unmount();
  });

  it('exposes the remote track as audioStream and feeds the analyser', async () => {
    const { hook, pc } = await connectWebRtc(baseConfig);
    const stream = { id: 'remote', getAudioTracks: () => [] };
    await act(async () => {
      pc.emitRemoteTrack(stream);
    });
    expect(hook.result.current.audioStream).toBe(stream);
    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.mediaStreamSources[0]?.stream).toBe(stream);
    hook.unmount();
  });

  it('routes data-channel and control-channel events through the same handlers', async () => {
    const onEvent = vi.fn();
    const onTranscript = vi.fn();
    const toolExecutor = vi.fn(async () => ({ ok: true }));
    const { hook, pc, ws, dc } = await connectWebRtc({ ...baseConfig, onEvent, onTranscript, toolExecutor });
    await act(async () => {
      pc.setConnectionState('connected');
      pc.dataChannels[0]!.open();
    });

    await act(async () => {
      dc.receive({ type: 'response.created', response: { id: 'r1' } });
    });
    expect(hook.result.current.sessionState).toBe('speaking');
    await act(async () => {
      dc.receive({ type: 'input_audio_buffer.speech_started' });
    });
    expect(hook.result.current.sessionState).toBe('listening');
    await act(async () => {
      dc.receive({
        type: 'response.audio_transcript.delta',
        response_id: 'r1',
        item_id: 'i',
        output_index: 0,
        content_index: 0,
        delta: 'Hey',
      });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('assistant', 'Hey', false);

    // Tool calls arrive on the control WebSocket; results go back over it
    await act(async () => {
      ws.receive({
        type: 'response.function_call_arguments.done',
        response_id: 'r1',
        item_id: 'i2',
        output_index: 0,
        call_id: 'call_1',
        name: 'get_time',
        arguments: '{}',
      });
    });
    await flush();
    expect(toolExecutor).toHaveBeenCalledWith('get_time', '{}', 'call_1');
    expect(ws.lastSent('conversation.item.create').item).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: '{"ok":true}',
    });
    expect(onEvent).toHaveBeenCalledTimes(4);
    hook.unmount();
  });

  it('starts, mutes and stops the microphone via the audio transceiver', async () => {
    const { hook, pc } = await connectWebRtc(baseConfig);
    await act(async () => {
      pc.setConnectionState('connected');
      pc.dataChannels[0]!.open();
    });

    await act(async () => {
      await hook.result.current.startMic();
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    expect(pc.transceivers[0]!.sender.replaceTrack).toHaveBeenCalledWith(mic.track);
    expect(hook.result.current.isMicActive).toBe(true);
    expect(mic.track.enabled).toBe(true);

    await act(async () => {
      hook.result.current.toggleMute();
    });
    expect(hook.result.current.isMuted).toBe(true);
    expect(mic.track.enabled).toBe(false);

    await act(async () => {
      hook.result.current.stopMic();
    });
    expect(mic.track.stop).toHaveBeenCalled();
    expect(pc.transceivers[0]!.sender.replaceTrack).toHaveBeenLastCalledWith(null);
    expect(hook.result.current.isMicActive).toBe(false);
    hook.unmount();
  });

  it('releases the old microphone when a reconnect switches transport kind', async () => {
    const hook = renderHook(({ config }) => useVoiceLive(config), {
      initialProps: { config: { ...baseConfig, reconnect: true } },
    });
    await act(async () => {
      await hook.result.current.connect();
    });
    const pc = FakePeerConnection.instances[FakePeerConnection.instances.length - 1]!;
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    await act(async () => {
      ws.open();
    });
    await act(async () => {
      pc.setConnectionState('connected');
      pc.dataChannels[0]!.open();
    });
    await act(async () => {
      await hook.result.current.startMic();
    });
    expect(hook.result.current.isMicActive).toBe(true);

    // the app switches to the WebSocket transport, then the session drops and reconnects
    hook.rerender({
      config: {
        ...baseConfig,
        reconnect: true,
        connection: { ...baseConfig.connection, transport: 'websocket' as const },
      },
    });
    await act(async () => {
      ws.drop(1006);
      await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(1));
    });

    // the WebRTC microphone must not keep recording into a session that no longer uses it
    expect(mic.track.stop).toHaveBeenCalled();
    hook.unmount();
  });

  it('keeps the microphone controls on the live session when the transport prop changes', async () => {
    const hook = renderHook(({ config }) => useVoiceLive(config), { initialProps: { config: baseConfig } });
    await act(async () => {
      await hook.result.current.connect();
    });
    const pc = FakePeerConnection.instances[FakePeerConnection.instances.length - 1]!;
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    await act(async () => {
      ws.open();
    });
    await act(async () => {
      pc.setConnectionState('connected');
      pc.dataChannels[0]!.open();
    });
    await act(async () => {
      await hook.result.current.startMic();
    });
    expect(hook.result.current.isMicActive).toBe(true);

    // Switching the prop only takes effect on the next connect — the running WebRTC microphone
    // must stay controllable until then, not silently hand over to the WebSocket capture path.
    hook.rerender({
      config: { ...baseConfig, connection: { ...baseConfig.connection, transport: 'websocket' as const } },
    });
    expect(hook.result.current.isMicActive).toBe(true);
    await act(async () => {
      hook.result.current.toggleMute();
    });
    expect(hook.result.current.isMuted).toBe(true);
    expect(mic.track.enabled).toBe(false);
    hook.unmount();
  });

  it('auto-starts the microphone once the peer connection is connected', async () => {
    const { hook, pc } = await connectWebRtc({ ...baseConfig, autoStartMic: true });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    await act(async () => {
      pc.setConnectionState('connected');
      pc.dataChannels[0]!.open();
    });
    await flush();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isMicActive).toBe(true);
    hook.unmount();
  });

  it('surfaces rtc.call.error and connection failures as errors', async () => {
    const { hook, ws } = await connectWebRtc(baseConfig);
    await act(async () => {
      ws.receive({
        type: 'rtc.call.error',
        operation: 'rtc.call.sdp.create',
        error: { type: 'invalid_request_error', code: 'missing_sdp', message: 'SDP offer is required' },
      });
    });
    expect(hook.result.current.connectionState).toBe('error');
    expect(hook.result.current.error).toContain('missing_sdp');
    hook.unmount();

    const second = await connectWebRtc(baseConfig);
    await act(async () => {
      second.pc.setConnectionState('failed');
    });
    expect(second.hook.result.current.connectionState).toBe('error');
    expect(second.hook.result.current.error).toMatch(/UDP may be blocked/);
    second.hook.unmount();
  });

  it('rejects avatar sessions on the WebRTC transport', async () => {
    const hook = renderHook(() =>
      useVoiceLive({ ...baseConfig, session: { avatar: { character: 'lisa', style: 'casual-sitting' } } })
    );
    await act(async () => {
      await hook.result.current.connect();
    });
    expect(hook.result.current.connectionState).toBe('error');
    expect(hook.result.current.error).toMatch(/Avatar is not supported/);
    expect(FakeWebSocket.instances).toHaveLength(0);
    hook.unmount();
  });

  it('appends transport=webrtc for proxy URLs', async () => {
    const { hook, ws } = await connectWebRtc({
      ...baseConfig,
      connection: { proxyUrl: 'ws://localhost:8080/ws?model=gpt-realtime', transport: 'webrtc' },
    });
    expect(ws.url).toBe('ws://localhost:8080/ws?model=gpt-realtime&transport=webrtc');
    hook.unmount();
  });

  it('disconnect tears down peer connection, data channel, socket and mic', async () => {
    const { hook, pc, ws, dc } = await connectWebRtc(baseConfig);
    await act(async () => {
      pc.setConnectionState('connected');
      pc.dataChannels[0]!.open();
      await hook.result.current.startMic();
    });
    await act(async () => {
      hook.result.current.disconnect();
    });
    expect(pc.closed).toBe(true);
    expect(dc.closed).toBe(true);
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    expect(mic.track.stop).toHaveBeenCalled();
    expect(hook.result.current.connectionState).toBe('disconnected');
    expect(hook.result.current.isReady).toBe(false);
    expect(hook.result.current.getAudioPlaybackTime()).toBeNull();
    hook.unmount();
  });

  it('websocket transport still sends session.update on session.created (regression)', async () => {
    const hook = renderHook(() =>
      useVoiceLive({ ...baseConfig, connection: { resourceName: 'r', apiKey: 'k' } })
    );
    await act(async () => {
      await hook.result.current.connect();
    });
    const ws = FakeWebSocket.instances[0]!;
    await act(async () => {
      ws.open();
      ws.receive({ type: 'session.created', session: {} });
    });
    expect(ws.lastSent('session.update')).toBeDefined();
    expect(FakePeerConnection.instances).toHaveLength(0);
    hook.unmount();
  });
});
