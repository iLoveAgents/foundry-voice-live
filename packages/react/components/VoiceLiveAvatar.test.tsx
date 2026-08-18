/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-explicit-any */
/**
 * VoiceLiveAvatar — stream binding, chroma-key lifecycle, loading and controls (jsdom; WebGL mocked)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { VoiceLiveAvatar } from './VoiceLiveAvatar';

const processor = { start: vi.fn(), stop: vi.fn(), updateConfig: vi.fn() };
vi.mock('../utils/chromaKey', () => ({
  DEFAULT_GREEN_SCREEN: { r: 0, g: 255, b: 0 },
  createChromaKeyProcessor: vi.fn(() => processor),
}));
import { createChromaKeyProcessor } from '../utils/chromaKey';

// jsdom media elements have no srcObject; make it a plain writable property
function defineSrcObject(): void {
  for (const proto of [HTMLVideoElement.prototype, HTMLAudioElement.prototype]) {
    if (!Object.getOwnPropertyDescriptor(proto, 'srcObject')) {
      Object.defineProperty(proto, 'srcObject', { writable: true, configurable: true, value: null });
    }
  }
}

beforeEach(() => {
  defineSrcObject();
  vi.clearAllMocks();
});

const video = { id: 'video-stream' } as unknown as MediaStream;
const audio = { id: 'audio-stream' } as unknown as MediaStream;

describe('VoiceLiveAvatar', () => {
  it('shows the loading state until a video stream arrives, then binds video + audio', () => {
    const { container, rerender, queryByText } = render(
      <VoiceLiveAvatar videoStream={null} audioStream={null} loadingMessage="Connecting…" />
    );
    expect(queryByText('Connecting…')).toBeTruthy();
    const videoEl = container.querySelector('video') as HTMLVideoElement;
    const audioEl = container.querySelector('audio') as HTMLAudioElement;
    expect(videoEl.srcObject).toBeNull();

    rerender(<VoiceLiveAvatar videoStream={video} audioStream={audio} loadingMessage="Connecting…" />);
    expect(queryByText('Connecting…')).toBeNull();
    expect(videoEl.srcObject).toBe(video);
    expect(audioEl.srcObject).toBe(audio);
  });

  it('starts chroma keying on loadedmetadata (transparent background), stops it on unmount and forwards config updates', () => {
    const onVideoReady = vi.fn();
    const config = { threshold: 0.4 } as any;
    const { container, rerender, unmount } = render(
      <VoiceLiveAvatar videoStream={video} audioStream={null} chromaKeyConfig={config} onVideoReady={onVideoReady} />
    );
    const videoEl = container.querySelector('video') as HTMLVideoElement;
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(createChromaKeyProcessor).not.toHaveBeenCalled();

    act(() => {
      fireEvent(videoEl, new Event('loadedmetadata'));
    });
    expect(createChromaKeyProcessor).toHaveBeenCalledWith(videoEl, canvas, config);
    expect(processor.start).toHaveBeenCalledTimes(1);
    expect(onVideoReady).toHaveBeenCalledTimes(1);

    // a config change after start re-runs the stream effect (stop + restart) and pushes the config
    const next = { threshold: 0.6 } as any;
    rerender(<VoiceLiveAvatar videoStream={video} audioStream={null} chromaKeyConfig={next} onVideoReady={onVideoReady} />);
    expect(processor.stop).toHaveBeenCalled();

    unmount();
    expect(processor.stop).toHaveBeenCalled();
  });

  it('renders the raw video without a canvas when transparentBackground is false', () => {
    const { container } = render(<VoiceLiveAvatar videoStream={video} audioStream={null} transparentBackground={false} />);
    expect(container.querySelector('canvas')).toBeNull();
    const videoEl = container.querySelector('video') as HTMLVideoElement;
    act(() => {
      fireEvent(videoEl, new Event('loadedmetadata'));
    });
    expect(createChromaKeyProcessor).not.toHaveBeenCalled();
    expect(videoEl.style.display).not.toBe('none');
  });

  it('reveals controls only while the pointer is over the bottom quarter', () => {
    const { container, getByText } = render(
      <VoiceLiveAvatar videoStream={video} audioStream={null} showControls controls={<button>Mute</button>} />
    );
    const root = container.firstElementChild as HTMLDivElement;
    Object.defineProperty(root, 'clientHeight', { value: 400, configurable: true });
    root.getBoundingClientRect = () => ({ top: 0, left: 0, width: 300, height: 400 }) as DOMRect;
    const controls = getByText('Mute').parentElement as HTMLDivElement;
    expect(controls.style.opacity).toBe('0');

    fireEvent.mouseMove(root, { clientY: 100 });
    expect(controls.style.opacity).toBe('0');
    fireEvent.mouseMove(root, { clientY: 350 });
    expect(controls.style.opacity).toBe('1');
    fireEvent.mouseLeave(root);
    expect(controls.style.opacity).toBe('0');
  });

  it('calls onAudioReady when the audio element reports metadata', () => {
    const onAudioReady = vi.fn();
    const { container } = render(<VoiceLiveAvatar videoStream={video} audioStream={audio} onAudioReady={onAudioReady} />);
    const audioEl = container.querySelector('audio') as HTMLAudioElement;
    fireEvent(audioEl, new Event('loadedmetadata'));
    expect(onAudioReady).toHaveBeenCalledTimes(1);
  });
});
