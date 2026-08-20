import type { SpectraDrawSettings, StftConfig, WorkerStage } from '../types';
import { getHopSize, SPECTROGRAM_DATA_FLOOR_DB } from '../config';
import { griffinLim } from '../dsp/griffinLim';
import { magnitudeFromComplex, magnitudeToDb } from '../dsp/magnitude';
import { stft } from '../dsp/stft';
import { createTargetMagnitude } from '../image/createTargetMagnitude';
import { processImageData } from '../image/processImage';

export interface PipelineProgress {
  stage: WorkerStage;
  iteration?: number;
  totalIterations?: number;
}

export interface PipelineResult {
  sampleRate: number;
  samples: Float32Array;
  finalMagnitudeDb: Float32Array;
  frameCount: number;
  binCount: number;
  times: Float64Array;
  frequencies: Float64Array;
  timeStartSeconds: number;
  timeEndSeconds: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  minAmplitudeDb: number;
  maxAmplitudeDb: number;
}

export type PipelineProgressCallback = (progress: PipelineProgress) => void;

export function validateSettings(settings: SpectraDrawSettings): void {
  const values = Object.values(settings);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('All settings must be finite numbers.');
  }
  if (settings.sampleRate <= 0) {
    throw new Error('Sample rate must be positive.');
  }
  if (
    settings.timeStartSeconds < 0
    || settings.timeStartSeconds >= settings.timeEndSeconds
  ) {
    throw new Error('Time range must have a non-negative start before the end.');
  }
  if (
    !Number.isInteger(settings.frameSize)
    || settings.frameSize < 2
    || (settings.frameSize & (settings.frameSize - 1)) !== 0
  ) {
    throw new Error('Frame size must be a power of two.');
  }
  if (settings.overlapPercent < 0 || settings.overlapPercent >= 100 || getHopSize(settings) < 1) {
    throw new Error('Overlap must produce a hop size of at least one sample.');
  }
  if (
    settings.minFrequencyHz < 0
    || settings.minFrequencyHz >= settings.maxFrequencyHz
    || settings.maxFrequencyHz > settings.sampleRate / 2
  ) {
    throw new Error(`Frequency range must be between 0 and ${settings.sampleRate / 2} Hz.`);
  }
  if (
    settings.minAmplitudeDb < SPECTROGRAM_DATA_FLOOR_DB
    || settings.minAmplitudeDb >= settings.maxAmplitudeDb
    || settings.maxAmplitudeDb > 0
  ) {
    throw new Error(`Amplitude mapping range must be between ${SPECTROGRAM_DATA_FLOOR_DB} and 0 dBFS.`);
  }
  if (!Number.isInteger(settings.griffinLimIterations) || settings.griffinLimIterations < 1) {
    throw new Error('Griffin-Lim iterations must be at least one.');
  }
  if (!Number.isInteger(settings.posterLevels) || settings.posterLevels < 2) {
    throw new Error('Poster levels must be at least two.');
  }
  if (
    !Number.isInteger(settings.gaussianKernelSize)
    || settings.gaussianKernelSize < 1
    || settings.gaussianKernelSize % 2 === 0
    || !Number.isInteger(settings.sobelKernelSize)
    || settings.sobelKernelSize < 1
    || settings.sobelKernelSize % 2 === 0
  ) {
    throw new Error('Image-processing kernel sizes must be positive odd integers.');
  }
  if (settings.sobelThreshold < 0) {
    throw new Error('Sobel threshold cannot be negative.');
  }
}

export function generateFromImage(
  image: ImageData,
  settings: SpectraDrawSettings,
  onProgress?: PipelineProgressCallback,
): PipelineResult {
  validateSettings(settings);
  const sampleCount = Math.round(settings.sampleRate * settings.timeEndSeconds);
  if (sampleCount < 1) {
    throw new Error('The time range is too short to generate audio.');
  }

  const stftConfig: StftConfig = {
    sampleRate: settings.sampleRate,
    frameSize: settings.frameSize,
    hopSize: getHopSize(settings),
    fftSize: settings.frameSize,
  };

  onProgress?.({ stage: 'image-processing' });
  const processed = processImageData(image, settings);

  onProgress?.({ stage: 'target-spectrum' });
  const target = createTargetMagnitude(
    processed.compositedMagnitude,
    sampleCount,
    stftConfig,
    settings.timeStartSeconds,
    settings.timeEndSeconds,
    settings.minFrequencyHz,
    settings.maxFrequencyHz,
    settings.minAmplitudeDb,
    settings.maxAmplitudeDb,
  );

  const waveform = griffinLim(
    target,
    {
      sampleCount,
      iterations: settings.griffinLimIterations,
      phaseSeed: settings.phaseSeed,
      stftConfig,
    },
    (iteration, totalIterations) => {
      onProgress?.({ stage: 'griffin-lim', iteration, totalIterations });
    },
  );

  // The start control is a placement boundary, so keep the exported waveform
  // exactly silent before it even though neighboring STFT windows overlap it.
  const silentSampleCount = Math.min(
    waveform.length,
    Math.round(settings.sampleRate * settings.timeStartSeconds),
  );
  waveform.fill(0, 0, silentSampleCount);

  let peak = 0;
  for (const value of waveform) {
    peak = Math.max(peak, Math.abs(value));
  }
  if (!(peak > 0)) {
    throw new Error('The generated waveform is silent.');
  }
  const targetPeak = 10 ** (settings.finalPeakDbfs / 20);
  const samples = new Float32Array(waveform.length);
  for (let index = 0; index < waveform.length; index += 1) {
    samples[index] = ((waveform[index] ?? 0) * targetPeak) / peak;
  }

  // The canonical Float32 waveform feeds both WAV export and this final STFT.
  onProgress?.({ stage: 'final-stft' });
  const finalSpectrum = stft(samples, stftConfig);
  const finalMagnitudeDb = magnitudeToDb(
    magnitudeFromComplex(finalSpectrum),
    SPECTROGRAM_DATA_FLOOR_DB,
  );

  return {
    sampleRate: settings.sampleRate,
    samples,
    finalMagnitudeDb,
    frameCount: finalSpectrum.frameCount,
    binCount: finalSpectrum.binCount,
    times: finalSpectrum.times,
    frequencies: finalSpectrum.frequencies,
    timeStartSeconds: settings.timeStartSeconds,
    timeEndSeconds: settings.timeEndSeconds,
    minFrequencyHz: settings.minFrequencyHz,
    maxFrequencyHz: settings.maxFrequencyHz,
    minAmplitudeDb: settings.minAmplitudeDb,
    maxAmplitudeDb: settings.maxAmplitudeDb,
  };
}
