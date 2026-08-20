import type { SpectraDrawSettings } from './types';

export const DEFAULT_SETTINGS: Readonly<SpectraDrawSettings> = {
  sampleRate: 48_000,
  durationSeconds: 2.25,
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
  minDisplayDb: -20,
};

export function getHopSize(settings: SpectraDrawSettings): number {
  return Math.round(settings.frameSize * (1 - settings.overlapPercent / 100));
}
