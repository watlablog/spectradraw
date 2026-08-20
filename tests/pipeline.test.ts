import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, getHopSize } from '../src/config';
import { magnitudeFromComplex, magnitudeToDb } from '../src/dsp/magnitude';
import { stft } from '../src/dsp/stft';
import { generateFromImage } from '../src/pipeline/generate';
import type { SpectraDrawSettings } from '../src/types';

function checkerboardImage(): ImageData {
  const width = 6;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const value = (x + y) % 2 === 0 ? 0 : 255;
      data[pixel * 4] = value;
      data[pixel * 4 + 1] = value;
      data[pixel * 4 + 2] = value;
      data[pixel * 4 + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

const settings: SpectraDrawSettings = {
  ...DEFAULT_SETTINGS,
  sampleRate: 8_000,
  durationSeconds: 0.04,
  frameSize: 32,
  overlapPercent: 75,
  minFrequencyHz: 0,
  maxFrequencyHz: 4_000,
  griffinLimIterations: 2,
};

describe('complete image-to-sound pipeline', () => {
  it('is deterministic for one implementation and reports every stage', () => {
    const progress: string[] = [];
    const first = generateFromImage(checkerboardImage(), settings, (event) => {
      progress.push(`${event.stage}:${event.iteration ?? ''}`);
    });
    const second = generateFromImage(checkerboardImage(), settings);

    expect(first.samples).toEqual(second.samples);
    expect(first.finalMagnitudeDb).toEqual(second.finalMagnitudeDb);
    expect(progress).toEqual([
      'image-processing:',
      'target-spectrum:',
      'griffin-lim:1',
      'griffin-lim:2',
      'final-stft:',
    ]);
    expect(first.samples.length).toBe(Math.round(settings.sampleRate * settings.durationSeconds));
    expect(Array.from(first.samples).every(Number.isFinite)).toBe(true);
  });

  it('derives final display data by re-running STFT on the canonical Float32 samples', () => {
    const result = generateFromImage(checkerboardImage(), settings);
    const finalSpectrum = stft(result.samples, {
      sampleRate: settings.sampleRate,
      frameSize: settings.frameSize,
      hopSize: getHopSize(settings),
      fftSize: settings.frameSize,
    });
    const expectedDb = magnitudeToDb(
      magnitudeFromComplex(finalSpectrum),
      settings.minDisplayDb,
    );

    expect(result.frameCount).toBe(finalSpectrum.frameCount);
    expect(result.binCount).toBe(finalSpectrum.binCount);
    expect(result.finalMagnitudeDb).toEqual(expectedDb);
  });
});
