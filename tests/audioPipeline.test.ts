import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../src/config';
import { generate } from '../src/pipeline/generate';
import type { SpectraDrawSettings } from '../src/types';

function image(): ImageData {
  const width = 4;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = index % 2 === 0 ? 0 : 255;
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

const settings: SpectraDrawSettings = {
  ...DEFAULT_SETTINGS,
  sampleRate: 8_000,
  frameSize: 32,
  overlapPercent: 75,
  griffinLimIterations: 2,
  timeStartSeconds: 0.01,
  timeEndSeconds: 0.04,
  minFrequencyHz: 0,
  maxFrequencyHz: 4_000,
};

function tone(length: number): Float32Array {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = 0.2 * Math.sin((2 * Math.PI * 500 * index) / settings.sampleRate);
  }
  return samples;
}

describe('audio and composite pipelines', () => {
  it('pads audio at its placement start without changing its gain', () => {
    const source = tone(80);
    const result = generate({ audio: { sampleRate: 8_000, samples: source } }, {
      ...settings,
      audioStartSeconds: 0.005,
    }, 1_000);
    expect(result.mode).toBe('audio-only');
    expect(result.samples.length).toBe(120);
    expect(Array.from(result.samples.subarray(0, 40))).toEqual(new Array(40).fill(0));
    expect(result.samples.subarray(40)).toEqual(source);
  });

  it('uses the union timeline and normalizes a composite to -1 dBFS', () => {
    const source = tone(160);
    const progress: string[] = [];
    const result = generate({
      image: image(),
      audio: { sampleRate: 8_000, samples: source },
    }, {
      ...settings,
      audioStartSeconds: 0.03,
      timeStartSeconds: 0,
      timeEndSeconds: 0.04,
      imageAttenuationDb: 6,
    }, 1_000, (event) => progress.push(event.stage));

    expect(result.mode).toBe('composite');
    expect(result.samples.length).toBe(400);
    const peak = result.samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    expect(peak).toBeCloseTo(10 ** (-1 / 20), 6);
    expect(progress).toContain('source-analysis');
    expect(Array.from(result.samples).every(Number.isFinite)).toBe(true);
  });

  it('rejects silent source audio as a composite reference', () => {
    expect(() => generate({
      image: image(),
      audio: { sampleRate: 8_000, samples: new Float32Array(160) },
    }, settings, 1_000)).toThrow('Silent audio');
  });

  it('keeps image-only mode deterministic after adding optional audio', () => {
    const first = generate({ image: image() }, settings, 1_000);
    const second = generate({ image: image() }, settings, 1_000);
    expect(first.samples).toEqual(second.samples);
    expect(first.finalMagnitudeDb).toEqual(second.finalMagnitudeDb);
  });

  it('uses deterministic overlapping chunks at the long-processing threshold', () => {
    const longSettings: SpectraDrawSettings = {
      ...settings,
      timeStartSeconds: 0,
      timeEndSeconds: 10,
      griffinLimIterations: 1,
    };
    const chunks: string[] = [];
    const first = generate({ image: image() }, longSettings, 128, (event) => {
      if (event.chunkCount !== undefined) chunks.push(`${event.chunkIndex}/${event.chunkCount}`);
    });
    const second = generate({ image: image() }, longSettings, 128);

    expect(first.samples.length).toBe(80_000);
    expect(first.frameCount).toBe(128);
    expect(first.samples).toEqual(second.samples);
    expect(chunks.some((value) => value.endsWith('/2'))).toBe(true);
    expect(Array.from(first.samples).every(Number.isFinite)).toBe(true);
  });

  it('bypasses source-only chunks in a long composite and applies one final gain', () => {
    const source = tone(80_000);
    const result = generate({
      image: image(),
      audio: { sampleRate: 8_000, samples: source },
    }, {
      ...settings,
      timeStartSeconds: 0,
      timeEndSeconds: 0.25,
      griffinLimIterations: 1,
      imageAttenuationDb: 6,
    }, 128);

    expect(result.mode).toBe('composite');
    expect(result.samples.length).toBe(source.length);
    expect(result.frameCount).toBe(128);
    const peak = result.samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    expect(peak).toBeCloseTo(10 ** (-1 / 20), 6);
    expect(Array.from(result.samples).every(Number.isFinite)).toBe(true);
  });
});
