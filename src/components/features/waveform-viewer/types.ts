export interface AudioData {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  duration: number;
  audioBuffer: ArrayBuffer; // Store original file for playback
}
