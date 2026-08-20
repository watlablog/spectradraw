import { PROCESSING_CHUNK_SECONDS, SPECTROGRAM_DATA_FLOOR_DB } from '../config';
import { magnitudeFromComplex, magnitudeToDb, magnitudeToDbWithReference } from '../dsp/magnitude';
import { stft } from '../dsp/stft';
import type { StftConfig } from '../types';

export interface SpectrogramTile {
  valuesDb: Float32Array;
  frameCount: number;
  binCount: number;
  times: Float64Array;
  frequencies: Float64Array;
}

export interface SpectrogramAnalysis {
  tile: SpectrogramTile;
  referenceMagnitude: number;
}

function maximum(values: Float64Array): number {
  let result = 0;
  for (const value of values) {
    result = Math.max(result, value);
  }
  return result;
}

function createFrequencies(config: StftConfig): Float64Array {
  const frequencies = new Float64Array(config.fftSize / 2 + 1);
  for (let bin = 0; bin < frequencies.length; bin += 1) {
    frequencies[bin] = (bin * config.sampleRate) / config.fftSize;
  }
  return frequencies;
}

function analyzeExact(
  samples: Float32Array,
  config: StftConfig,
  referenceMagnitude?: number,
): SpectrogramAnalysis {
  const spectrum = stft(samples, config);
  const magnitude = magnitudeFromComplex(spectrum);
  const reference = referenceMagnitude ?? maximum(magnitude);
  return {
    tile: {
      valuesDb: referenceMagnitude === undefined
        ? magnitudeToDb(magnitude, SPECTROGRAM_DATA_FLOOR_DB)
        : magnitudeToDbWithReference(magnitude, reference, SPECTROGRAM_DATA_FLOOR_DB),
      frameCount: spectrum.frameCount,
      binCount: spectrum.binCount,
      times: spectrum.times,
      frequencies: spectrum.frequencies,
    },
    referenceMagnitude: reference,
  };
}

function analyzePooled(
  samples: Float32Array,
  config: StftConfig,
  minimumTimeSeconds: number,
  maximumTimeSeconds: number,
  maximumColumns: number,
  referenceMagnitude?: number,
): SpectrogramAnalysis {
  const duration = samples.length / config.sampleRate;
  const minimumTime = Math.max(0, Math.min(duration, minimumTimeSeconds));
  const maximumTime = Math.max(minimumTime, Math.min(duration, maximumTimeSeconds));
  const span = maximumTime - minimumTime;
  if (!(span > 0)) {
    throw new Error('The requested spectrogram time range is empty.');
  }
  const estimatedFrames = Math.max(1, Math.ceil((span * config.sampleRate) / config.hopSize));
  const columnCount = Math.max(1, Math.min(maximumColumns, estimatedFrames));
  const binCount = config.fftSize / 2 + 1;
  const pooled = new Float64Array(binCount * columnCount);
  const times = new Float64Array(columnCount);
  for (let column = 0; column < columnCount; column += 1) {
    times[column] = minimumTime + ((column + 0.5) / columnCount) * span;
  }

  const hop = config.hopSize;
  const coreSamples = Math.max(hop, Math.round(
    (PROCESSING_CHUNK_SECONDS * config.sampleRate) / hop,
  ) * hop);
  const minimumSample = Math.floor((minimumTime * config.sampleRate) / hop) * hop;
  const maximumSample = Math.min(samples.length, Math.ceil((maximumTime * config.sampleRate) / hop) * hop);
  let calculatedReference = 0;

  for (let coreStart = minimumSample; coreStart < maximumSample; coreStart += coreSamples) {
    const coreEnd = Math.min(maximumSample, coreStart + coreSamples);
    const sliceStart = Math.max(0, coreStart - config.frameSize);
    const sliceEnd = Math.min(samples.length, coreEnd + config.frameSize);
    const spectrum = stft(samples.slice(sliceStart, sliceEnd), config);
    for (let frame = 0; frame < spectrum.frameCount; frame += 1) {
      const globalTime = sliceStart / config.sampleRate + (spectrum.times[frame] ?? 0);
      const includeEnd = coreEnd === maximumSample;
      if (
        globalTime < minimumTime
        || globalTime > maximumTime
        || globalTime < coreStart / config.sampleRate
        || (includeEnd ? globalTime > coreEnd / config.sampleRate : globalTime >= coreEnd / config.sampleRate)
      ) {
        continue;
      }
      const column = Math.max(0, Math.min(
        columnCount - 1,
        Math.floor(((globalTime - minimumTime) / span) * columnCount),
      ));
      for (let bin = 0; bin < binCount; bin += 1) {
        const sourceIndex = bin * spectrum.frameCount + frame;
        const value = Math.hypot(
          spectrum.real[sourceIndex] ?? 0,
          spectrum.imag[sourceIndex] ?? 0,
        );
        calculatedReference = Math.max(calculatedReference, value);
        const targetIndex = bin * columnCount + column;
        pooled[targetIndex] = Math.max(pooled[targetIndex] ?? 0, value);
      }
    }
  }

  const reference = referenceMagnitude ?? calculatedReference;
  return {
    tile: {
      valuesDb: magnitudeToDbWithReference(pooled, reference, SPECTROGRAM_DATA_FLOOR_DB),
      frameCount: columnCount,
      binCount,
      times,
      frequencies: createFrequencies(config),
    },
    referenceMagnitude: reference,
  };
}

export function analyzeFullSpectrogram(
  samples: Float32Array,
  config: StftConfig,
  maximumColumns: number,
): SpectrogramAnalysis {
  const estimatedFrames = Math.ceil(samples.length / config.hopSize) + 4;
  if (estimatedFrames <= maximumColumns) {
    return analyzeExact(samples, config);
  }
  return analyzePooled(
    samples,
    config,
    0,
    samples.length / config.sampleRate,
    maximumColumns,
  );
}

export function analyzeSpectrogramView(
  samples: Float32Array,
  config: StftConfig,
  minimumTimeSeconds: number,
  maximumTimeSeconds: number,
  maximumColumns: number,
  referenceMagnitude: number,
): SpectrogramTile {
  const startSample = Math.max(0, Math.floor(minimumTimeSeconds * config.sampleRate));
  const endSample = Math.min(samples.length, Math.ceil(maximumTimeSeconds * config.sampleRate));
  const estimatedFrames = Math.ceil(Math.max(0, endSample - startSample) / config.hopSize) + 4;
  if (minimumTimeSeconds <= 0 && maximumTimeSeconds >= samples.length / config.sampleRate) {
    return analyzeFullSpectrogram(samples, config, maximumColumns).tile;
  }
  if (estimatedFrames <= maximumColumns) {
    const haloStart = Math.max(0, startSample - config.frameSize);
    const haloEnd = Math.min(samples.length, endSample + config.frameSize);
    const analysis = analyzeExact(samples.slice(haloStart, haloEnd), config, referenceMagnitude);
    const selectedFrames: number[] = [];
    for (let frame = 0; frame < analysis.tile.frameCount; frame += 1) {
      const globalTime = haloStart / config.sampleRate + (analysis.tile.times[frame] ?? 0);
      if (globalTime >= minimumTimeSeconds && globalTime <= maximumTimeSeconds) {
        selectedFrames.push(frame);
      }
    }
    if (selectedFrames.length > 0) {
      const valuesDb = new Float32Array(analysis.tile.binCount * selectedFrames.length);
      const times = new Float64Array(selectedFrames.length);
      for (let targetFrame = 0; targetFrame < selectedFrames.length; targetFrame += 1) {
        const sourceFrame = selectedFrames[targetFrame] ?? 0;
        times[targetFrame] = haloStart / config.sampleRate + (analysis.tile.times[sourceFrame] ?? 0);
        for (let bin = 0; bin < analysis.tile.binCount; bin += 1) {
          valuesDb[bin * selectedFrames.length + targetFrame]
            = analysis.tile.valuesDb[bin * analysis.tile.frameCount + sourceFrame] ?? SPECTROGRAM_DATA_FLOOR_DB;
        }
      }
      return {
        valuesDb,
        frameCount: selectedFrames.length,
        binCount: analysis.tile.binCount,
        times,
        frequencies: analysis.tile.frequencies,
      };
    }
  }
  return analyzePooled(
    samples,
    config,
    minimumTimeSeconds,
    maximumTimeSeconds,
    maximumColumns,
    referenceMagnitude,
  ).tile;
}
