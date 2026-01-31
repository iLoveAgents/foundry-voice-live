// AudioWorklet processor for capturing and converting microphone audio to PCM16
class AudioCaptureProcessor extends AudioWorkletProcessor {

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input && input.length > 0) {
      const inputData = input[0]; // Get first channel

      if (inputData && inputData.length > 0) {
        // Convert float32 audio samples to PCM16
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Clamp to [-1, 1] and convert to 16-bit integer
          const clamped = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = Math.round(clamped * 32767);
        }

        // Send the PCM16 data to the main thread
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
      }
    }

    // Return true to keep the processor alive
    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
