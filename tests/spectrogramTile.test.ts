import { describe, expect, it } from 'vitest';

import { analyzeFullSpectrogram, analyzeSpectrogramView } from '../src/pipeline/spectrogramTile';
import type { StftConfig } from '../src/types';

const config: StftConfig = {
  sampleRate: 8_000,
  frameSize: 32,
  hopSize: 8,
  fftSize: 32,
};

describe('spectrogram tiles', () => {
  it('pools long views and re-analyzes a selected range with one global reference', () => {
    const samples = new Float32Array(16_000);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = index < 8_000
        ? 0.4 * Math.sin((2 * Math.PI * 500 * index) / config.sampleRate)
        : 0.2 * Math.sin((2 * Math.PI * 1_000 * index) / config.sampleRate);
    }
    const full = analyzeFullSpectrogram(samples, config, 64);
    expect(full.tile.frameCount).toBe(64);
    expect(full.tile.valuesDb.length).toBe(full.tile.binCount * 64);
    expect(Math.max(...full.tile.valuesDb)).toBeCloseTo(0, 5);

    const view = analyzeSpectrogramView(samples, config, 1, 2, 128, full.referenceMagnitude);
    expect(view.frameCount).toBeLessThanOrEqual(128);
    expect(view.times[0]).toBeGreaterThanOrEqual(1);
    expect(Array.from(view.valuesDb).every(Number.isFinite)).toBe(true);
  });
});
