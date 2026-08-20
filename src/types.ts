export type SupportedImageFormat = 'png' | 'jpeg' | 'webp';

export interface DecodedImage {
  fileName: string;
  format: SupportedImageFormat;
  width: number;
  height: number;
  imageData: ImageData;
}

export interface SpectraDrawSettings {
  sampleRate: number;
  durationSeconds: number;
  frameSize: number;
  overlapPercent: number;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  posterLevels: number;
  posterAttenuationDb: number;
  gaussianKernelSize: number;
  sobelKernelSize: number;
  sobelNormalizationPercentile: number;
  sobelThreshold: number;
  phaseSeed: number;
  griffinLimIterations: number;
  finalPeakDbfs: number;
  minDisplayDb: number;
}

export interface Matrix2D {
  rows: number;
  cols: number;
  values: Float64Array;
}

export interface StftConfig {
  sampleRate: number;
  frameSize: number;
  hopSize: number;
  fftSize: number;
}

export interface ComplexSpectrogram {
  frameCount: number;
  binCount: number;
  real: Float64Array;
  imag: Float64Array;
  times: Float64Array;
  frequencies: Float64Array;
}

export interface TargetMagnitude {
  frameCount: number;
  binCount: number;
  values: Float64Array;
}

export type WorkerStage =
  | 'image-processing'
  | 'target-spectrum'
  | 'griffin-lim'
  | 'final-stft';

export interface GenerateRequest {
  type: 'generate';
  requestId: number;
  image: ImageData;
  settings: SpectraDrawSettings;
}

export interface GenerateProgress {
  type: 'progress';
  requestId: number;
  stage: WorkerStage;
  iteration?: number;
  totalIterations?: number;
}

export interface GenerateResult {
  type: 'result';
  requestId: number;
  sampleRate: number;
  samples: Float32Array;
  finalMagnitudeDb: Float32Array;
  frameCount: number;
  binCount: number;
  times: Float64Array;
  frequencies: Float64Array;
  durationSeconds: number;
}

export interface GenerateError {
  type: 'error';
  requestId: number;
  message: string;
}

export type WorkerResponse = GenerateProgress | GenerateResult | GenerateError;
