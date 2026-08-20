import type { SpectraDrawSettings, StftConfig, WorkerStage } from '../types';
import { getHopSize } from '../config';
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
  durationSeconds: number;
}

export type PipelineProgressCallback = (progress: PipelineProgress) => void;

export function validateSettings(settings: SpectraDrawSettings): void {
  const values = Object.values(settings);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('All settings must be finite numbers.');
  }
  if (settings.durationSeconds <= 0 || settings.sampleRate <= 0) {
    throw new Error('Duration and sample rate must be positive.');
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
  const sampleCount = Math.round(settings.sampleRate * settings.durationSeconds);
  if (sampleCount < 1) {
    throw new Error('Duration is too short to generate audio.');
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
    settings.minFrequencyHz,
    settings.maxFrequencyHz,
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
    settings.minDisplayDb,
  );

  return {
    sampleRate: settings.sampleRate,
    samples,
    finalMagnitudeDb,
    frameCount: finalSpectrum.frameCount,
    binCount: finalSpectrum.binCount,
    times: finalSpectrum.times,
    frequencies: finalSpectrum.frequencies,
    durationSeconds: settings.durationSeconds,
  };
}
