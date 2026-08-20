import type { SpectraDrawSettings } from './types';

export const DEFAULT_SETTINGS: Readonly<SpectraDrawSettings> = {
  sampleRate: 48_000,
  timeStartSeconds: 0,
  timeEndSeconds: 2.25,
  frameSize: 2_048,
  overlapPercent: 90,
  minFrequencyHz: 0,
  maxFrequencyHz: 24_000,
  posterLevels: 4,
  posterAttenuationDb: 12,
  gaussianKernelSize: 5,
  sobelKernelSize: 3,
  sobelNormalizationPercentile: 99,
  sobelThreshold: 0.1,
  phaseSeed: 0,
  griffinLimIterations: 10,
  finalPeakDbfs: -1,
  minAmplitudeDb: -20,
  maxAmplitudeDb: 0,
};

// Final STFT values retain this wider range so the amplitude slider can redraw
// the spectrogram without running Griffin-Lim again.
export const SPECTROGRAM_DATA_FLOOR_DB = -80;

export function getHopSize(settings: SpectraDrawSettings): number {
  return Math.round(settings.frameSize * (1 - settings.overlapPercent / 100));
}
