// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UseVoiceLiveConfig, UseVoiceLiveReturn } from '@iloveagents/foundry-voice-live-react';
import { VoiceLiveAgent } from '../agent';
import type { VoiceSessionBridge } from '../agent/VoiceLiveAgent';
import { useVoiceLiveAgentBinding } from './useVoiceLiveAgentBinding';

const mock = vi.hoisted(() => ({
  config: null as UseVoiceLiveConfig | null,
  voice: {} as UseVoiceLiveReturn,
}));
vi.mock('@iloveagents/foundry-voice-live-react', async (original) => ({
  ...(await original<object>()),
  useVoiceLive: (config: UseVoiceLiveConfig) => {
    mock.config = config;
    return mock.voice;
  },
}));

beforeEach(() => {
  mock.voice = {
    connectionState: 'connected',
    isReady: false,
    transport: 'webrtc',
    isMicActive: false,
    isMuted: false,
    sendEvent: vi.fn(),
    cancelResponse: vi.fn(),
    sendToolResult: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as UseVoiceLiveReturn;
});

const config: UseVoiceLiveConfig = { connection: { proxyUrl: 'ws://localhost/ws' } };
const created = () => mock.config?.onEvent?.({ type: 'session.created', session: { id: 's' } });

describe('useVoiceLiveAgentBinding integration', () => {
  it('gates typed turns on readiness, reflects WebRTC state, and detaches on unmount', () => {
    const agent = new VoiceLiveAgent();
    const attach = vi.spyOn(agent, 'attachBridge');
    const detach = vi.spyOn(agent, 'detachBridge');
    const hook = renderHook(() => useVoiceLiveAgentBinding(agent, config));
    const bridge = attach.mock.calls[0]![0] as VoiceSessionBridge;
    expect(bridge.canSend?.()).toBe(false);
    mock.voice = { ...mock.voice, isReady: true };
    hook.rerender();
    expect(bridge.canSend?.()).toBe(true);
    expect(agent.state.voice).toMatchObject({ transport: 'webrtc', isReady: true });
    hook.unmount();
    expect(bridge.canSend?.()).toBe(false);
    expect(detach).toHaveBeenCalledOnce();
    expect(agent.state.voice).toMatchObject({ connectionState: 'disconnected', isReady: false });
  });

  it('forwards an automatic tool result exactly once', async () => {
    const agent = new VoiceLiveAgent();
    const ingest = vi.spyOn(agent, 'ingestHostEvent');
    const hook = renderHook(() =>
      useVoiceLiveAgentBinding(agent, { ...config, toolExecutor: async () => ({ time: '12:00' }) })
    );
    act(created);
    await act(async () => {
      expect(await mock.config!.toolExecutor!('get_time', '{}', 'call-1')).toEqual({
        time: '12:00',
      });
    });
    expect(ingest.mock.calls.filter(([e]) => e.type === 'tool_result')).toEqual([
      [{ type: 'tool_result', callId: 'call-1', output: { time: '12:00' } }],
    ]);
    hook.unmount();
  });

  it.each(['disconnect', 'new-session', 'unmount'] as const)(
    'ignores tool output after %s',
    async (end) => {
      let resolve!: (value: { time: string }) => void;
      const agent = new VoiceLiveAgent();
      const ingest = vi.spyOn(agent, 'ingestHostEvent');
      const hook = renderHook(() =>
        useVoiceLiveAgentBinding(agent, {
          ...config,
          toolExecutor: () =>
            new Promise((r) => {
              resolve = r;
            }),
        })
      );
      act(created);
      const pending = mock.config!.toolExecutor!('get_time', '{}', 'old-call');
      act(() => {
        if (end === 'disconnect') hook.result.current.disconnect();
        else if (end === 'new-session') created();
        else hook.unmount();
      });
      resolve({ time: 'stale' });
      await pending;
      expect(ingest.mock.calls.filter(([e]) => e.type === 'tool_result')).toEqual([]);
      if (end !== 'unmount') hook.unmount();
    }
  );

  it('updates reconnect state even when a consumer callback throws', () => {
    const agent = new VoiceLiveAgent();
    const hook = renderHook(() =>
      useVoiceLiveAgentBinding(agent, {
        ...config,
        onReconnecting: () => {
          throw new Error('consumer');
        },
      })
    );
    act(created);
    expect(() => mock.config!.onReconnecting!(1, 500)).toThrow('consumer');
    expect(agent.state.voice).toMatchObject({ connectionState: 'reconnecting' });
    hook.unmount();
  });
});
