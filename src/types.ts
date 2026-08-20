export type SupportedImageFormat = 'png' | 'jpeg' | 'webp';
export type SupportedAudioFormat = 'wav' | 'mp3';
export type InputMode = 'image-only' | 'audio-only' | 'composite';

export interface DecodedImage {
  fileName: string;
  format: SupportedImageFormat;
  width: number;
  height: number;
  imageData: ImageData;
}

export interface DecodedAudio {
  fileName: string;
  format: SupportedAudioFormat;
  sampleRate: number;
  channelCount: number;
  durationSeconds: number;
  samples: Float32Array;
}

export interface AudioPayload {
  sampleRate: number;
  samples: Float32Array;
}

export interface SpectraDrawSettings {
  sampleRate: number;
  audioStartSeconds: number;
  imageAttenuationDb: number;
  timeStartSeconds: number;
  timeEndSeconds: number;
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
  minAmplitudeDb: number;
  maxAmplitudeDb: number;
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
  | 'audio-preparation'
  | 'source-analysis'
  | 'image-processing'
  | 'target-spectrum'
  | 'griffin-lim'
  | 'final-stft';

export interface GenerateRequest {
  type: 'generate';
  requestId: number;
  image?: ImageData;
  audio?: AudioPayload;
  settings: SpectraDrawSettings;
  maximumDisplayColumns: number;
}

export interface AnalyzeViewRequest {
  type: 'analyze-view';
  requestId: number;
  viewRequestId: number;
  minimumTimeSeconds: number;
  maximumTimeSeconds: number;
  maximumDisplayColumns: number;
}

export type WorkerRequest = GenerateRequest | AnalyzeViewRequest;

export interface GenerateProgress {
  type: 'progress';
  requestId: number;
  stage: WorkerStage;
  iteration?: number;
  totalIterations?: number;
  chunkIndex?: number;
  chunkCount?: number;
}

export interface GenerateResult {
  type: 'result';
  requestId: number;
  mode: InputMode;
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

export interface ViewResult {
  type: 'view-result';
  requestId: number;
  viewRequestId: number;
  finalMagnitudeDb: Float32Array;
  frameCount: number;
  binCount: number;
  times: Float64Array;
  frequencies: Float64Array;
}

export interface GenerateError {
  type: 'error';
  requestId: number;
  message: string;
}

export type WorkerResponse = GenerateProgress | GenerateResult | ViewResult | GenerateError;
