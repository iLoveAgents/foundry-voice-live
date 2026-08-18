/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
/**
 * useAudioCapture — microphone → AudioWorklet → 100 ms PCM16 chunks (fake Web Audio)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioCapture } from './useAudioCapture';
import { FakeAudioContext, FakeAudioWorkletNode, installBrowserFakes, makeFakeMicStream } from './testFakes';

let restore: () => void;
let mic: ReturnType<typeof makeFakeMicStream>;

beforeEach(() => {
  mic = makeFakeMicStream();
  restore = installBrowserFakes({ getUserMedia: async () => mic.stream });
});

afterEach(() => {
  restore();
});

/** Push `samples` Int16 samples through the worklet port as one message */
function emit(node: FakeAudioWorkletNode, samples: number, value = 1) {
  const data = new Int16Array(samples).fill(value);
  node.port.onmessage?.({ data: data.buffer });
}

describe('useAudioCapture', () => {
  it('coalesces concurrent starts so a second stream cannot leak', async () => {
    const getUserMedia = vi.fn(async () => mic.stream);
    restore();
    restore = installBrowserFakes({ getUserMedia });
    const { result } = renderHook(() => useAudioCapture({ onAudioData: vi.fn() }));

    // two callers in the window before `isCapturing` flips (a re-rendered auto-start effect and a
    // consumer calling startMic()): the second must join the first, not acquire its own stream
    await act(async () => {
      await Promise.all([result.current.startCapture(), result.current.startCapture()]);
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(result.current.isCapturing).toBe(true);

    act(() => {
      result.current.stopCapture();
    });
    expect(mic.track.stop).toHaveBeenCalledTimes(1);
  });

  it('starts capture with the SDK mic defaults, wires the worklet graph and stops cleanly', async () => {
    const onAudioData = vi.fn();
    const { result } = renderHook(() => useAudioCapture({ sampleRate: 16000, onAudioData }));
    expect(result.current.isCapturing).toBe(false);

    await act(async () => {
      await result.current.startCapture();
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16000,
      },
    });
    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.audioWorklet.addModule).toHaveBeenCalledWith('blob:fake');
    const node = FakeAudioWorkletNode.instances[0]!;
    expect(node.name).toBe('audio-capture-processor');
    expect(ctx.mediaStreamSources[0]!.connect).toHaveBeenCalledWith(node);
    expect(node.connect).toHaveBeenCalledWith(ctx.destination);
    expect(result.current.isCapturing).toBe(true);
    expect(result.current.stream).toBe(mic.stream);
    expect(result.current.audioContext).toBe(ctx);

    act(() => {
      result.current.stopCapture();
    });
    expect(mic.track.stop).toHaveBeenCalled();
    expect(node.disconnect).toHaveBeenCalled();
    expect(ctx.closed).toBe(true);
    expect(result.current.isCapturing).toBe(false);
    expect(result.current.stream).toBeNull();
  });

  it('batches worklet output into exactly 2400-sample chunks and keeps the remainder', async () => {
    const onAudioData = vi.fn();
    const { result } = renderHook(() => useAudioCapture({ onAudioData }));
    await act(async () => {
      await result.current.startCapture();
    });
    const node = FakeAudioWorkletNode.instances[0]!;

    emit(node, 1000);
    emit(node, 1000);
    expect(onAudioData).not.toHaveBeenCalled(); // 2000 < 2400
    emit(node, 1000); // 3000 → one 2400 chunk, 600 left
    expect(onAudioData).toHaveBeenCalledTimes(1);
    expect((onAudioData.mock.calls[0]![0] as ArrayBuffer).byteLength).toBe(2400 * 2);
    emit(node, 4200); // 4800 → two more chunks
    expect(onAudioData).toHaveBeenCalledTimes(3);
  });

  it('mute drops incoming audio without stopping the stream; pause/resume suspend the context', async () => {
    const onAudioData = vi.fn();
    const { result } = renderHook(() => useAudioCapture({ onAudioData }));
    await act(async () => {
      await result.current.startCapture();
    });
    const node = FakeAudioWorkletNode.instances[0]!;

    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.isMuted).toBe(true);
    emit(node, 2400);
    expect(onAudioData).not.toHaveBeenCalled();
    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.isMuted).toBe(false);
    emit(node, 2400);
    expect(onAudioData).toHaveBeenCalledTimes(1);

    const ctx = FakeAudioContext.instances[0]!;
    await act(async () => {
      result.current.pauseCapture();
    });
    expect(ctx.state).toBe('suspended');
    await act(async () => {
      result.current.resumeCapture();
    });
    expect(ctx.state).toBe('running');
  });

  it('surfaces getUserMedia failures as error and rethrows', async () => {
    restore();
    restore = installBrowserFakes({
      getUserMedia: async () => {
        throw new Error('Permission denied');
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useAudioCapture());
    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.startCapture();
      } catch (err) {
        thrown = err;
      }
    });
    expect(thrown).toEqual(new Error('Permission denied'));
    expect(result.current.error).toBe('Permission denied');
    expect(result.current.isCapturing).toBe(false);
    errorSpy.mockRestore();
  });

  it('honours autoStart and a custom worklet path', async () => {
    const { result } = renderHook(() =>
      useAudioCapture({ autoStart: true, workletPath: '/custom-processor.js', onAudioData: vi.fn() })
    );
    await vi.waitFor(() => expect(result.current.isCapturing).toBe(true));
    expect(FakeAudioContext.instances[0]!.audioWorklet.addModule).toHaveBeenCalledWith('/custom-processor.js');
  });

  it('abandons a start whose getUserMedia resolves after stopCapture()', async () => {
    restore();
    let release: (s: MediaStream) => void = () => undefined;
    const late = makeFakeMicStream();
    restore = installBrowserFakes({
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          release = resolve;
        }),
    });
    const { result } = renderHook(() => useAudioCapture({ onAudioData: vi.fn() }));
    const started = result.current.startCapture();
    act(() => {
      result.current.stopCapture();
    });
    await act(async () => {
      release(late.stream as unknown as MediaStream);
      await started;
    });
    // the late stream is released, and no capture is reported (which would stop the auto-retry)
    expect(late.track.stop).toHaveBeenCalled();
    expect(result.current.isCapturing).toBe(false);
    expect(result.current.stream).toBeNull();
  });

  it('abandons a start whose worklet module resolves after stopCapture()', async () => {
    let resolveModule: () => void = () => undefined;
    FakeAudioContext.addModuleImpl = () =>
      new Promise<void>((resolve) => {
        resolveModule = resolve;
      });
    const { result } = renderHook(() => useAudioCapture({ onAudioData: vi.fn() }));
    const started = result.current.startCapture();
    await vi.waitFor(() => expect(FakeAudioContext.instances).toHaveLength(1));
    const ctx = FakeAudioContext.instances[0]!;
    await vi.waitFor(() => expect(ctx.audioWorklet.addModule).toHaveBeenCalled());

    act(() => {
      result.current.stopCapture();
    });
    await act(async () => {
      resolveModule();
      await started;
    });

    // No nodes are wired into the closing context, and capture is not falsely reported active
    expect(result.current.isCapturing).toBe(false);
    expect(result.current.stream).toBeNull();
    expect(ctx.closed).toBe(true);
    expect(FakeAudioWorkletNode.instances).toHaveLength(0);
  });
});
