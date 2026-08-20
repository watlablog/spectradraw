import type { ComplexSpectrogram, StftConfig, TargetMagnitude } from '../types';
import { FftJsBackend } from './fftJsBackend';
import { istft, stft } from './stft';
import { createSeededRandom } from './random';

export interface GriffinLimOptions {
  sampleCount: number;
  iterations: number;
  phaseSeed: number;
  stftConfig: StftConfig;
}

export type GriffinLimProgress = (iteration: number, totalIterations: number) => void;

export function griffinLim(
  target: TargetMagnitude,
  options: GriffinLimOptions,
  onProgress?: GriffinLimProgress,
): Float64Array {
  if (!Number.isInteger(options.iterations) || options.iterations < 1) {
    throw new Error('Griffin-Lim iterations must be at least one.');
  }

  const valueCount = target.binCount * target.frameCount;
  if (target.values.length !== valueCount) {
    throw new Error('Target magnitude dimensions are invalid.');
  }

  const random = createSeededRandom(options.phaseSeed);
  const phase = new Float64Array(valueCount);
  for (let index = 0; index < valueCount; index += 1) {
    phase[index] = random.next() * 2 * Math.PI - Math.PI;
  }

  const real = new Float64Array(valueCount);
  const imag = new Float64Array(valueCount);
  const backend = new FftJsBackend(options.stftConfig.fftSize);
  let output: Float64Array = new Float64Array(options.sampleCount);

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    for (let index = 0; index < valueCount; index += 1) {
      const magnitude = target.values[index] ?? 0;
      const angle = phase[index] ?? 0;
      real[index] = magnitude * Math.cos(angle);
      imag[index] = magnitude * Math.sin(angle);
    }

    const spectrum: ComplexSpectrogram = {
      frameCount: target.frameCount,
      binCount: target.binCount,
      real,
      imag,
      times: new Float64Array(0),
      frequencies: new Float64Array(0),
    };
    output = istft(spectrum, options.sampleCount, options.stftConfig, backend);
    const estimated = stft(output, options.stftConfig, backend);

    for (let index = 0; index < valueCount; index += 1) {
      phase[index] = Math.atan2(estimated.imag[index] ?? 0, estimated.real[index] ?? 0);
    }
    onProgress?.(iteration, options.iterations);
  }

  return output;
}
