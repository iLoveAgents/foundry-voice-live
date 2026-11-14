/**
 * Inline AudioWorklet processor for PCM16 playback (WebSocket transport).
 *
 * The processor source is shipped as a string and loaded from a Blob URL so the package
 * needs no separate worklet asset. See `PcmPlayer` in `audioOutput.ts` for the host side.
 */

/**
 * Inline AudioWorklet processor for playback with Lanczos-3 resampling.
 * Runs entirely off the main thread for optimal performance.
 *
 * Receives PCM16 Int16Array buffers via postMessage, resamples from source
 * sample rate to output sample rate using Lanczos-3 interpolation, and
 * plays back via a queue-based buffer for gapless audio.
 */
export const AUDIO_PLAYBACK_PROCESSOR_CODE = `
class AudioPlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.bufferQueue = [];
    this.currentBuffer = null;
    this.currentOffset = 0;
    this.sourceSampleRate = (options && options.processorOptions && options.processorOptions.sourceSampleRate) || 24000;
    this.ratio = sampleRate / this.sourceSampleRate;

    this.port.onmessage = (event) => {
      if (event.data === null) {
        // Stop signal - clear queue (barge-in)
        this.bufferQueue = [];
        this.currentBuffer = null;
        this.currentOffset = 0;
      } else {
        // Receive Int16Array buffer, convert and resample
        const int16 = new Int16Array(event.data);
        const resampled = this.resample(int16);
        this.bufferQueue.push(resampled);
      }
    };
  }

  // Lanczos-3 kernel
  lanczos(x) {
    if (x === 0) return 1;
    if (Math.abs(x) >= 3) return 0;
    const px = Math.PI * x;
    const pa = px / 3;
    return (Math.sin(px) * Math.sin(pa)) / (px * pa);
  }

  // Convert Int16 PCM to Float32 and resample using Lanczos-3
  resample(int16) {
    const sourceLen = int16.length;
    const outputLen = Math.ceil(sourceLen * this.ratio);
    const output = new Float32Array(outputLen);

    for (let i = 0; i < outputLen; i++) {
      const srcIdx = i / this.ratio;
      const center = Math.floor(srcIdx);
      const frac = srcIdx - center;

      let sample = 0;
      for (let j = -2; j <= 3; j++) {
        const idx = center + j;
        if (idx >= 0 && idx < sourceLen) {
          sample += (int16[idx] / 32768.0) * this.lanczos(frac - j);
        }
      }
      output[i] = sample;
    }
    return output;
  }

  process(inputs, outputs) {
    const channel = outputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      if (!this.currentBuffer || this.currentOffset >= this.currentBuffer.length) {
        if (this.bufferQueue.length > 0) {
          this.currentBuffer = this.bufferQueue.shift();
          this.currentOffset = 0;
        } else {
          channel[i] = 0;
          continue;
        }
      }
      channel[i] = this.currentBuffer[this.currentOffset];
      this.currentOffset++;
    }
    return true;
  }
}

registerProcessor('audio-playback-processor', AudioPlaybackProcessor);
`;

export function createPlaybackProcessorBlobUrl(): string {
  const blob = new Blob([AUDIO_PLAYBACK_PROCESSOR_CODE], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}
