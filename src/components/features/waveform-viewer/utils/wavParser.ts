import type { AudioData } from "../types";

export async function parseWavFile(file: File): Promise<AudioData> {
    const arrayBuffer = await file.arrayBuffer();
    const view = new DataView(arrayBuffer);

    // Check for RIFF header
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (riff !== "RIFF") {
        throw new Error("Not a valid WAV file");
    }

    // Check for WAVE format
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (wave !== "WAVE") {
        throw new Error("Not a valid WAV file");
    }

    let offset = 12;
    let sampleRate = 44100;
    let channels = 1;
    let bitsPerSample = 16;
    let dataOffset = 0;
    let dataSize = 0;

    // Parse chunks
    while (offset < arrayBuffer.byteLength) {
        const chunkId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
        const chunkSize = view.getUint32(offset + 4, true);

        if (chunkId === "fmt ") {
            // Parse format chunk
            const audioFormat = view.getUint16(offset + 8, true);
            if (audioFormat !== 1) {
                throw new Error("Only PCM format is supported");
            }
            channels = view.getUint16(offset + 10, true);
            sampleRate = view.getUint32(offset + 12, true);
            bitsPerSample = view.getUint16(offset + 22, true);
        } else if (chunkId === "data") {
            // Found data chunk
            dataOffset = offset + 8;
            dataSize = chunkSize;
            break;
        }

        offset += 8 + chunkSize;
    }

    if (dataOffset === 0) {
        throw new Error("No data chunk found");
    }

    // Read audio samples
    const bytesPerSample = bitsPerSample / 8;
    const numSamples = dataSize / (bytesPerSample * channels);
    const samples = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
        const sampleOffset = dataOffset + i * bytesPerSample * channels;
        let sample = 0;

        if (bitsPerSample === 8) {
            sample = (view.getUint8(sampleOffset) - 128) / 128;
        } else if (bitsPerSample === 16) {
            sample = view.getInt16(sampleOffset, true) / 32768;
        } else if (bitsPerSample === 24) {
            const b1 = view.getUint8(sampleOffset);
            const b2 = view.getUint8(sampleOffset + 1);
            const b3 = view.getUint8(sampleOffset + 2);
            const combined = (b3 << 16) | (b2 << 8) | b1;
            sample = (combined > 8388607 ? combined - 16777216 : combined) / 8388608;
        } else if (bitsPerSample === 32) {
            sample = view.getInt32(sampleOffset, true) / 2147483648;
        }

        // For multi-channel, take the average of all channels
        if (channels > 1) {
            let sum = sample;
            for (let ch = 1; ch < channels; ch++) {
                const chOffset = sampleOffset + ch * bytesPerSample;
                let chSample = 0;

                if (bitsPerSample === 8) {
                    chSample = (view.getUint8(chOffset) - 128) / 128;
                } else if (bitsPerSample === 16) {
                    chSample = view.getInt16(chOffset, true) / 32768;
                } else if (bitsPerSample === 24) {
                    const b1 = view.getUint8(chOffset);
                    const b2 = view.getUint8(chOffset + 1);
                    const b3 = view.getUint8(chOffset + 2);
                    const combined = (b3 << 16) | (b2 << 8) | b1;
                    chSample = (combined > 8388607 ? combined - 16777216 : combined) / 8388608;
                } else if (bitsPerSample === 32) {
                    chSample = view.getInt32(chOffset, true) / 2147483648;
                }

                sum += chSample;
            }
            sample = sum / channels;
        }

        samples[i] = sample;
    }

    const duration = numSamples / sampleRate;

    // Decode audio for playback using Web Audio API
    // biome-ignore lint/correctness/noUnusedVariables: <It's used later>
        let audioBuffer: AudioBuffer;
    try {
        // biome-ignore lint/suspicious/noExplicitAny: <It's used later>
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        audioContext.close();
    } catch (_error) {
        throw new Error("Failed to decode audio file");
    }

    return { samples, sampleRate, channels, duration, audioBuffer: arrayBuffer };
}
