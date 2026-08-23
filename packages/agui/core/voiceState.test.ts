import { describe, it, expect } from 'vitest';
import { applyPatch, type Operation } from 'fast-json-patch';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import { VoiceLiveAguiMapper } from './mapper';
import { sequentialIds } from './ids';
import { initialVoiceState } from './voiceState';
import type { VoiceLiveServerEvent } from './types';

type E = BaseEvent & Record<string, unknown>;

describe('voice state (STATE_SNAPSHOT + STATE_DELTA)', () => {
  it('reconstructs the exact state by replaying the patch stream', () => {
    const m = new VoiceLiveAguiMapper({ threadId: 't', generateId: sequentialIds('g') });
    const out: BaseEvent[] = [];
    const push = (e: VoiceLiveServerEvent) => out.push(...m.handleServerEvent(e).events);
    const host = (e: Parameters<VoiceLiveAguiMapper['handleHostEvent']>[0]) =>
      out.push(...m.handleHostEvent(e).events);

    push({ type: 'session.created', session: { id: 's', model: 'gpt-4.1', expires_at: 2000 } });
    host({ type: 'ready' });
    host({ type: 'mic', active: true, muted: false });
    push({ type: 'response.created', response: { id: 'r' } });
    push({
      type: 'response.done',
      response: {
        id: 'r',
        status: 'completed',
        output: [],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    });
    host({ type: 'mic', active: true, muted: true });

    // Replay: start from the snapshot, apply every delta in order
    let state: unknown = { voice: initialVoiceState() };
    let sawSnapshot = false;
    for (const ev of out as E[]) {
      if (ev.type === EventType.STATE_SNAPSHOT) {
        state = ev.snapshot;
        sawSnapshot = true;
      } else if (ev.type === EventType.STATE_DELTA) {
        state = applyPatch(structuredClone(state), ev.delta as Operation[]).newDocument;
      }
    }
    expect(sawSnapshot).toBe(true);
    // The replayed state must equal the mapper's own snapshot
    expect(state).toEqual({ voice: m.snapshot.state });
    const voice = (state as { voice: Record<string, unknown> }).voice;
    expect(voice.model).toBe('gpt-4.1');
    expect(voice.isReady).toBe(true);
    expect(voice.isMuted).toBe(true);
    expect(voice.sessionExpiresAt).toBe(2000 * 1000);
    expect(voice.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });
});
