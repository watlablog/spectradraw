import { describe, expect, it } from 'vitest';

import { magnitudeFromComplex } from '../src/dsp/magnitude';
import { createStftLayout, istft, stft } from '../src/dsp/stft';
import { createPeriodicHann, scaleWindowToMagnitude } from '../src/dsp/window';
import type { StftConfig } from '../src/types';

const config: StftConfig = {
  sampleRate: 8_000,
  frameSize: 32,
  hopSize: 8,
  fftSize: 32,
};

describe('periodic Hann window', () => {
  it('uses the periodic, not symmetric, definition', () => {
    const window = createPeriodicHann(8);
    expect(Array.from(window)).toEqual([
      0,
      0.1464466094067262,
      0.49999999999999994,
      0.8535533905932737,
      1,
      0.8535533905932738,
      0.5000000000000001,
      0.14644660940672632,
    ]);
    const scaled = scaleWindowToMagnitude(window);
    expect(Array.from(scaled).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 14);
  });
});

describe('SciPy-compatible STFT layout', () => {
  it('includes centered boundary frames before and after the signal', () => {
    const layout = createStftLayout(10, {
      sampleRate: 100,
      frameSize: 8,
      hopSize: 2,
      fftSize: 8,
    });
    expect(layout.pMin).toBe(-1);
    expect(layout.pMax).toBe(7);
    expect(layout.frameCount).toBe(8);
    expect(Array.from(layout.times)).toEqual([-0.02, 0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12]);
    expect(Array.from(layout.frequencies)).toEqual([0, 12.5, 25, 37.5, 50]);
  });

  it('matches the Python reference layout for the default application settings', () => {
    const layout = createStftLayout(108_000, {
      sampleRate: 48_000,
      frameSize: 2_048,
      hopSize: 205,
      fftSize: 2_048,
    });
    expect(layout.frameCount).toBe(536);
    expect(layout.binCount).toBe(1_025);
    expect(layout.times[0]).toBeCloseTo(-0.017083333333333332, 15);
    expect(layout.times[layout.times.length - 1]).toBeCloseTo(2.2678125, 15);
  });

  it('reconstructs a signal through STFT and canonical-dual ISTFT', () => {
    const samples = new Float64Array(257);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = 0.45 * Math.sin((2 * Math.PI * 437 * index) / config.sampleRate)
        + 0.2 * Math.cos((2 * Math.PI * 1_219 * index) / config.sampleRate)
        + ((index % 17) - 8) * 0.001;
    }

    const reconstructed = istft(stft(samples, config), samples.length, config);
    let squaredError = 0;
    let squaredSignal = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const difference = (samples[index] ?? 0) - (reconstructed[index] ?? 0);
      squaredError += difference * difference;
      squaredSignal += (samples[index] ?? 0) ** 2;
    }
    const normalizedRms = Math.sqrt(squaredError / squaredSignal);
    expect(normalizedRms).toBeLessThan(1e-10);
  });

  it('uses magnitude-scaled onesided2X amplitudes', () => {
    const samples = new Float64Array(256);
    const targetBin = 3;
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.cos((2 * Math.PI * targetBin * index) / config.frameSize);
    }
    const spectrum = stft(samples, config);
    const magnitude = magnitudeFromComplex(spectrum);
    const layout = createStftLayout(samples.length, config);
    const fullyCoveredP = 2;
    const frame = fullyCoveredP - layout.pMin;
    expect(magnitude[targetBin * layout.frameCount + frame]).toBeCloseTo(1, 12);
  });

  it('matches SciPy ShortTimeFFT complex values at centered boundary frames', () => {
    const samples = new Float64Array([0.25, -0.5, 0.75, 1, -0.25, 0.5, -0.75, 0.125, 0.4, -0.2]);
    const referenceConfig: StftConfig = {
      sampleRate: 100,
      frameSize: 8,
      hopSize: 2,
      fftSize: 8,
    };
    const spectrum = stft(samples, referenceConfig);
    const at = (bin: number, frame: number): number => bin * spectrum.frameCount + frame;

    expect(spectrum.real[at(0, 0)]).toBeCloseTo(0.012944173824159216, 14);
    expect(spectrum.imag[at(1, 0)]).toBeCloseTo(-0.03661165235168155, 14);
    expect(spectrum.real[at(1, 2)]).toBeCloseTo(0.49999999999999994, 14);
    expect(spectrum.imag[at(3, 3)]).toBeCloseTo(-0.2564720869120797, 14);
    expect(spectrum.real[at(4, 7)]).toBeCloseTo(0.0073223304703363135, 14);
    expect(spectrum.imag[at(2, 7)]).toBeCloseTo(0.014644660940672627, 14);
  });
});
