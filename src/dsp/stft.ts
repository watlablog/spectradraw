import type { ComplexSpectrogram, StftConfig } from '../types';
import type { FftBackend } from './fftBackend';
import { FftJsBackend } from './fftJsBackend';
import {
  createCanonicalDualWindow,
  createPeriodicHann,
  scaleWindowToMagnitude,
} from './window';

export interface StftLayout {
  pMin: number;
  pMax: number;
  frameCount: number;
  binCount: number;
  times: Float64Array;
  frequencies: Float64Array;
}

function validateConfig(config: StftConfig): void {
  if (!Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
    throw new Error('Sample rate must be positive.');
  }
  if (
    !Number.isInteger(config.frameSize)
    || config.frameSize < 2
    || (config.frameSize & (config.frameSize - 1)) !== 0
  ) {
    throw new Error('Frame size must be a power of two.');
  }
  if (config.fftSize !== config.frameSize) {
    throw new Error('The MVP requires FFT size to equal frame size.');
  }
  if (!Number.isInteger(config.hopSize) || config.hopSize < 1 || config.hopSize > config.frameSize) {
    throw new Error('Hop size must be between one and frame size.');
  }
}

export function createStftLayout(sampleCount: number, config: StftConfig): StftLayout {
  validateConfig(config);
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error('Sample count must be a positive integer.');
  }

  const middle = Math.floor(config.frameSize / 2);
  const pMin = Math.floor((middle - config.frameSize) / config.hopSize) + 1;
  const pMax = Math.ceil((sampleCount + middle) / config.hopSize);
  const frameCount = pMax - pMin;
  const binCount = config.fftSize / 2 + 1;
  const times = new Float64Array(frameCount);
  const frequencies = new Float64Array(binCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    times[frame] = ((pMin + frame) * config.hopSize) / config.sampleRate;
  }
  for (let bin = 0; bin < binCount; bin += 1) {
    frequencies[bin] = (bin * config.sampleRate) / config.fftSize;
  }

  return { pMin, pMax, frameCount, binCount, times, frequencies };
}

function createAnalysisWindow(frameSize: number): Float64Array {
  return scaleWindowToMagnitude(createPeriodicHann(frameSize));
}

export function stft(
  samples: Float32Array | Float64Array,
  config: StftConfig,
  backend: FftBackend = new FftJsBackend(config.fftSize),
): ComplexSpectrogram {
  const layout = createStftLayout(samples.length, config);
  if (backend.size !== config.fftSize) {
    throw new Error('FFT backend size does not match the STFT configuration.');
  }

  const window = createAnalysisWindow(config.frameSize);
  const middle = Math.floor(config.frameSize / 2);
  const windowed = new Float64Array(config.fftSize);
  const fftInput = new Float64Array(config.fftSize);
  const frameReal = new Float64Array(layout.binCount);
  const frameImag = new Float64Array(layout.binCount);
  const real = new Float64Array(layout.binCount * layout.frameCount);
  const imag = new Float64Array(layout.binCount * layout.frameCount);

  for (let frame = 0; frame < layout.frameCount; frame += 1) {
    const p = layout.pMin + frame;
    const sourceStart = p * config.hopSize - middle;

    for (let offset = 0; offset < config.frameSize; offset += 1) {
      const sourceIndex = sourceStart + offset;
      const sample = sourceIndex >= 0 && sourceIndex < samples.length
        ? (samples[sourceIndex] ?? 0)
        : 0;
      windowed[offset] = sample * (window[offset] ?? 0);
    }

    // SciPy ShortTimeFFT phase_shift=0 places the window center at FFT index 0.
    for (let index = 0; index < config.fftSize; index += 1) {
      fftInput[index] = windowed[(index + middle) % config.frameSize] ?? 0;
    }

    backend.forwardReal(fftInput, frameReal, frameImag);
    for (let bin = 0; bin < layout.binCount; bin += 1) {
      const oneSidedScale = bin === 0 || bin === layout.binCount - 1 ? 1 : 2;
      const targetIndex = bin * layout.frameCount + frame;
      real[targetIndex] = (frameReal[bin] ?? 0) * oneSidedScale;
      imag[targetIndex] = (frameImag[bin] ?? 0) * oneSidedScale;
    }
  }

  return {
    frameCount: layout.frameCount,
    binCount: layout.binCount,
    real,
    imag,
    times: layout.times,
    frequencies: layout.frequencies,
  };
}

export function istft(
  spectrum: ComplexSpectrogram,
  outputSampleCount: number,
  config: StftConfig,
  backend: FftBackend = new FftJsBackend(config.fftSize),
): Float64Array {
  const layout = createStftLayout(outputSampleCount, config);
  if (spectrum.frameCount !== layout.frameCount || spectrum.binCount !== layout.binCount) {
    throw new Error('Spectrum dimensions do not match the requested ISTFT output.');
  }
  if (backend.size !== config.fftSize) {
    throw new Error('FFT backend size does not match the ISTFT configuration.');
  }

  const analysisWindow = createAnalysisWindow(config.frameSize);
  const dualWindow = createCanonicalDualWindow(analysisWindow, config.hopSize);
  const middle = Math.floor(config.frameSize / 2);
  const fullReal = new Float64Array(config.fftSize);
  const fullImag = new Float64Array(config.fftSize);
  const inverse = new Float64Array(config.fftSize);
  const output = new Float64Array(outputSampleCount);

  for (let frame = 0; frame < layout.frameCount; frame += 1) {
    fullReal.fill(0);
    fullImag.fill(0);

    for (let bin = 0; bin < layout.binCount; bin += 1) {
      const sourceIndex = bin * layout.frameCount + frame;
      const oneSidedScale = bin === 0 || bin === layout.binCount - 1 ? 1 : 2;
      const binReal = (spectrum.real[sourceIndex] ?? 0) / oneSidedScale;
      const binImag = bin === 0 || bin === layout.binCount - 1
        ? 0
        : (spectrum.imag[sourceIndex] ?? 0) / oneSidedScale;
      fullReal[bin] = binReal;
      fullImag[bin] = binImag;

      if (bin > 0 && bin < layout.binCount - 1) {
        fullReal[config.fftSize - bin] = binReal;
        fullImag[config.fftSize - bin] = -binImag;
      }
    }

    backend.inverseComplex(fullReal, fullImag, inverse);
    const p = layout.pMin + frame;
    const outputStart = p * config.hopSize - middle;
    for (let offset = 0; offset < config.frameSize; offset += 1) {
      const outputIndex = outputStart + offset;
      if (outputIndex < 0 || outputIndex >= output.length) {
        continue;
      }
      const unshiftedIndex = (offset - middle + config.fftSize) % config.fftSize;
      output[outputIndex] = (output[outputIndex] ?? 0)
        + (inverse[unshiftedIndex] ?? 0) * (dualWindow[offset] ?? 0);
    }
  }

  return output;
}
