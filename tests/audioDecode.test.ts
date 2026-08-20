import { describe, expect, it } from 'vitest';

import {
  detectAudioFormat,
  downmixToMono,
  readMp3SampleRate,
  readWavSampleRate,
} from '../src/audio/decodeAudio';

function wavHeader(sampleRate: number, withJunk = false): Uint8Array {
  const junkLength = withJunk ? 10 : 0;
  const bytes = new Uint8Array(36 + junkLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  let offset = 12;
  if (withJunk) {
    bytes.set([0x4a, 0x55, 0x4e, 0x4b], offset);
    view.setUint32(offset + 4, 1, true);
    bytes[offset + 8] = 0;
    offset += 10;
  }
  bytes.set([0x66, 0x6d, 0x74, 0x20], offset);
  view.setUint32(offset + 4, 16, true);
  view.setUint16(offset + 8, 1, true);
  view.setUint16(offset + 10, 2, true);
  view.setUint32(offset + 12, sampleRate, true);
  return bytes;
}

describe('audio format inspection', () => {
  it('detects RIFF/WAVE and reads fmt chunks after unrelated chunks', () => {
    expect(detectAudioFormat(wavHeader(44_100))).toBe('wav');
    expect(readWavSampleRate(wavHeader(96_000, true))).toBe(96_000);
  });

  it('detects MP3 frame sync with and without an ID3 prefix', () => {
    const frame = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    expect(detectAudioFormat(frame)).toBe('mp3');
    expect(readMp3SampleRate(frame)).toBe(44_100);

    const tagged = new Uint8Array(14);
    tagged.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0], 0);
    tagged.set(frame, 10);
    expect(detectAudioFormat(tagged)).toBe('mp3');
    expect(readMp3SampleRate(tagged)).toBe(44_100);
  });

  it('rejects unsupported, truncated, and out-of-range headers', () => {
    expect(detectAudioFormat(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(() => readWavSampleRate(wavHeader(192_000))).toThrow('between');
    expect(() => readMp3SampleRate(new Uint8Array([0xff, 0xfb, 0x00, 0x00]))).toThrow('valid');
  });

  it('averages all decoded channels without normalization', () => {
    const channels = [new Float32Array([1, -1, 0.5]), new Float32Array([-1, 1, 0.25])];
    const mono = downmixToMono({
      length: 3,
      numberOfChannels: 2,
      sampleRate: 48_000,
      getChannelData(channel: number) {
        return channels[channel] ?? new Float32Array(0);
      },
    });
    expect(Array.from(mono)).toEqual([0, 0, 0.375]);
  });
});
