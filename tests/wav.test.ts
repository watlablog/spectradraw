import { describe, expect, it } from 'vitest';

import { encodeFloat32Wav } from '../src/audio/wav';

describe('32-bit float WAV encoder', () => {
  it('writes a mono IEEE-float RIFF header and sample payload', async () => {
    const samples = new Float32Array([-1, -0.25, 0, 0.5, 1]);
    const blob = encodeFloat32Wav(samples, 48_000);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const ascii = (start: number, length: number): string => String.fromCharCode(...bytes.slice(start, start + length));

    expect(blob.type).toBe('audio/wav');
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(32);
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.byteLength);
    expect(view.getFloat32(44, true)).toBe(-1);
    expect(view.getFloat32(44 + 4 * 3, true)).toBe(0.5);
  });
});
