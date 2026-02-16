class PcmRecorderWorklet extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (input && input[0]) {
      // Copy the channel before posting so the buffer isn't mutated later.
      this.port.postMessage(input[0].slice(0));
    }

    // Keep output silent so monitoring does not feed the mic back.
    if (output) {
      for (let i = 0; i < output.length; i += 1) {
        output[i].fill(0);
      }
    }

    return true;
  }
}

registerProcessor("pcm-recorder-worklet", PcmRecorderWorklet);
