import {
  getHopSize,
  LONG_PROCESSING_THRESHOLD_SECONDS,
  MAX_SPECTROGRAM_COLUMNS,
  PROCESSING_CHUNK_SECONDS,
  SPECTROGRAM_DATA_FLOOR_DB,
} from '../config';
import { griffinLim } from '../dsp/griffinLim';
import { magnitudeFromComplex } from '../dsp/magnitude';
import { stft } from '../dsp/stft';
import { createMappedImageMagnitude, createTargetMagnitude } from '../image/createTargetMagnitude';
import { processImageData } from '../image/processImage';
import type {
  AudioPayload,
  ComplexSpectrogram,
  InputMode,
  Matrix2D,
  SpectraDrawSettings,
  StftConfig,
  TargetMagnitude,
  WorkerStage,
} from '../types';
import { analyzeFullSpectrogram } from './spectrogramTile';

export interface PipelineProgress {
  stage: WorkerStage;
  iteration?: number;
  totalIterations?: number;
  chunkIndex?: number;
  chunkCount?: number;
}

export interface PipelineInput {
  image?: ImageData;
  audio?: AudioPayload;
}

export interface PipelineResult {
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
  displayReferenceMagnitude: number;
  stftConfig: StftConfig;
}

export type PipelineProgressCallback = (progress: PipelineProgress) => void;

function determineMode(input: PipelineInput): InputMode {
  if (input.image !== undefined && input.audio !== undefined) return 'composite';
  if (input.image !== undefined) return 'image-only';
  if (input.audio !== undefined) return 'audio-only';
  throw new Error('Choose an image, an audio file, or both.');
}

export function validateSettings(
  settings: SpectraDrawSettings,
  mode: InputMode = 'image-only',
): void {
  if (Object.values(settings).some((value) => !Number.isFinite(value))) {
    throw new Error('All settings must be finite numbers.');
  }
  if (!Number.isInteger(settings.sampleRate) || settings.sampleRate < 8_000 || settings.sampleRate > 96_000) {
    throw new Error('Sample rate must be an integer between 8000 and 96000 Hz.');
  }
  if (settings.audioStartSeconds < 0) {
    throw new Error('Audio start must be non-negative.');
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
  if (!Number.isInteger(settings.griffinLimIterations) || settings.griffinLimIterations < 1) {
    throw new Error('Griffin-Lim iterations must be at least one.');
  }

  if (mode !== 'audio-only') {
    if (settings.timeStartSeconds < 0 || settings.timeStartSeconds >= settings.timeEndSeconds) {
      throw new Error('Time range must have a non-negative start before the end.');
    }
    if (
      settings.minFrequencyHz < 0
      || settings.minFrequencyHz >= settings.maxFrequencyHz
      || settings.maxFrequencyHz > settings.sampleRate / 2
    ) {
      throw new Error(`Frequency range must be between 0 and ${settings.sampleRate / 2} Hz.`);
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

  if (mode === 'image-only' && (
    settings.minAmplitudeDb < SPECTROGRAM_DATA_FLOOR_DB
    || settings.minAmplitudeDb >= settings.maxAmplitudeDb
    || settings.maxAmplitudeDb > 0
  )) {
    throw new Error(`Amplitude mapping range must be between ${SPECTROGRAM_DATA_FLOOR_DB} and 0 dBFS.`);
  }
  if (mode === 'composite' && (settings.imageAttenuationDb < 0 || settings.imageAttenuationDb > 80)) {
    throw new Error('Image attenuation must be between 0 and 80 dB.');
  }
}

function validateAudio(audio: AudioPayload | undefined, sampleRate: number): void {
  if (audio === undefined) return;
  if (audio.sampleRate !== sampleRate || audio.samples.length < 1) {
    throw new Error('The decoded audio dimensions are invalid.');
  }
  for (const value of audio.samples) {
    if (!Number.isFinite(value)) throw new Error('The decoded audio contains non-finite samples.');
  }
}

function createStftConfig(settings: SpectraDrawSettings): StftConfig {
  return {
    sampleRate: settings.sampleRate,
    frameSize: settings.frameSize,
    hopSize: getHopSize(settings),
    fftSize: settings.frameSize,
  };
}

export function calculateOutputSampleCount(input: PipelineInput, settings: SpectraDrawSettings): number {
  const mode = determineMode(input);
  const audioStart = Math.round(settings.audioStartSeconds * settings.sampleRate);
  const audioEnd = input.audio === undefined ? 0 : audioStart + input.audio.samples.length;
  const imageEnd = mode === 'audio-only' ? 0 : Math.round(settings.timeEndSeconds * settings.sampleRate);
  const sampleCount = Math.max(audioEnd, imageEnd);
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
    throw new Error('The output timeline is empty or too large.');
  }
  if (44 + sampleCount * Float32Array.BYTES_PER_ELEMENT > 0xffff_ffff) {
    throw new Error('The output is too long for a RIFF/WAV file.');
  }
  return sampleCount;
}

function placeAudio(audio: AudioPayload | undefined, settings: SpectraDrawSettings, sampleCount: number): Float32Array {
  const result = new Float32Array(sampleCount);
  if (audio !== undefined) {
    result.set(audio.samples, Math.round(settings.audioStartSeconds * settings.sampleRate));
  }
  return result;
}

function maximumAbsolute(values: Float64Array | Float32Array): number {
  let peak = 0;
  for (const value of values) peak = Math.max(peak, Math.abs(value));
  return peak;
}

function normalizeWaveform(values: Float64Array, targetDbfs: number): Float32Array {
  const peak = maximumAbsolute(values);
  if (!(peak > 0) || !Number.isFinite(peak)) {
    throw new Error('Griffin-Lim produced an invalid output waveform.');
  }
  const gain = (10 ** (targetDbfs / 20)) / peak;
  const samples = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    samples[index] = (values[index] ?? 0) * gain;
  }
  return samples;
}

function createSourcePhase(spectrum: ComplexSpectrogram): Float64Array {
  const phase = new Float64Array(spectrum.real.length);
  for (let index = 0; index < phase.length; index += 1) {
    phase[index] = Math.atan2(spectrum.imag[index] ?? 0, spectrum.real[index] ?? 0);
  }
  return phase;
}

function createCompositeTarget(
  imageMagnitude: TargetMagnitude,
  sourceSpectrum: ComplexSpectrogram,
  sourceReference: number,
  attenuationDb: number,
): TargetMagnitude {
  if (!(sourceReference > 0) || !Number.isFinite(sourceReference)) {
    throw new Error('Silent audio cannot be used as the image amplitude reference.');
  }
  if (imageMagnitude.frameCount !== sourceSpectrum.frameCount || imageMagnitude.binCount !== sourceSpectrum.binCount) {
    throw new Error('Image and source spectrogram dimensions do not match.');
  }
  const sourceMagnitude = magnitudeFromComplex(sourceSpectrum);
  const imagePeak = sourceReference * 10 ** (-attenuationDb / 20);
  const values = new Float64Array(sourceMagnitude.length);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = Math.max(sourceMagnitude[index] ?? 0, (imageMagnitude.values[index] ?? 0) * imagePeak);
  }
  return { frameCount: sourceSpectrum.frameCount, binCount: sourceSpectrum.binCount, values };
}

function cropImageForTime(source: Matrix2D, minimumFraction: number, maximumFraction: number): Matrix2D {
  const minimum = Math.max(0, Math.min(1, minimumFraction));
  const maximum = Math.max(minimum, Math.min(1, maximumFraction));
  const columns = Math.max(1, Math.ceil(source.cols * Math.max(maximum - minimum, 1 / source.cols)));
  const values = new Float64Array(source.rows * columns);
  for (let row = 0; row < source.rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const fraction = columns === 1
        ? (minimum + maximum) / 2
        : minimum + ((column + 0.5) / columns) * (maximum - minimum);
      const position = Math.max(0, Math.min(source.cols - 1, fraction * source.cols - 0.5));
      const left = Math.floor(position);
      const right = Math.min(source.cols - 1, left + 1);
      const weight = position - left;
      values[row * columns + column] = Math.fround(
        (source.values[row * source.cols + left] ?? 0) * (1 - weight)
          + (source.values[row * source.cols + right] ?? 0) * weight,
      );
    }
  }
  return { rows: source.rows, cols: columns, values };
}

function generateShort(
  input: PipelineInput,
  mode: InputMode,
  sourceTimeline: Float32Array,
  sampleCount: number,
  stftConfig: StftConfig,
  settings: SpectraDrawSettings,
  onProgress?: PipelineProgressCallback,
): Float32Array {
  if (mode === 'audio-only') return sourceTimeline;
  onProgress?.({ stage: 'image-processing' });
  const processed = processImageData(input.image as ImageData, settings);
  onProgress?.({ stage: 'target-spectrum' });

  if (mode === 'image-only') {
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
    const waveform = griffinLim(target, {
      sampleCount,
      iterations: settings.griffinLimIterations,
      phaseSeed: settings.phaseSeed,
      stftConfig,
    }, (iteration, totalIterations) => {
      onProgress?.({ stage: 'griffin-lim', iteration, totalIterations });
    });
    waveform.fill(0, 0, Math.min(waveform.length, Math.round(settings.sampleRate * settings.timeStartSeconds)));
    return normalizeWaveform(waveform, settings.finalPeakDbfs);
  }

  onProgress?.({ stage: 'source-analysis' });
  const sourceSpectrum = stft(sourceTimeline, stftConfig);
  const sourceReference = maximumAbsolute(magnitudeFromComplex(sourceSpectrum));
  const imageMagnitude = createMappedImageMagnitude(
    processed.compositedMagnitude,
    sampleCount,
    stftConfig,
    settings.timeStartSeconds,
    settings.timeEndSeconds,
    settings.minFrequencyHz,
    settings.maxFrequencyHz,
  );
  const target = createCompositeTarget(imageMagnitude, sourceSpectrum, sourceReference, settings.imageAttenuationDb);
  const waveform = griffinLim(target, {
    sampleCount,
    iterations: settings.griffinLimIterations,
    phaseSeed: settings.phaseSeed,
    stftConfig,
    initialPhase: createSourcePhase(sourceSpectrum),
  }, (iteration, totalIterations) => {
    onProgress?.({ stage: 'griffin-lim', iteration, totalIterations });
  });
  return normalizeWaveform(waveform, settings.finalPeakDbfs);
}

function generateLong(
  input: PipelineInput,
  mode: InputMode,
  sourceTimeline: Float32Array,
  sampleCount: number,
  stftConfig: StftConfig,
  settings: SpectraDrawSettings,
  onProgress?: PipelineProgressCallback,
): Float32Array {
  if (mode === 'audio-only') return sourceTimeline;
  onProgress?.({ stage: 'image-processing' });
  const processed = processImageData(input.image as ImageData, settings);
  let sourceReference = 0;
  if (mode === 'composite') {
    onProgress?.({ stage: 'source-analysis' });
    sourceReference = analyzeFullSpectrogram(sourceTimeline, stftConfig, MAX_SPECTROGRAM_COLUMNS).referenceMagnitude;
    if (!(sourceReference > 0)) throw new Error('Silent audio cannot be used as the image amplitude reference.');
  }

  const hop = stftConfig.hopSize;
  const coreSamples = Math.max(hop, Math.round((PROCESSING_CHUNK_SECONDS * settings.sampleRate) / hop) * hop);
  const overlapSamples = Math.min(settings.frameSize, Math.floor(coreSamples / 4));
  const stepSamples = Math.max(hop, coreSamples - overlapSamples);
  const haloSamples = Math.ceil(((settings.griffinLimIterations + 1) * settings.frameSize) / hop) * hop;
  const chunkCount = Math.max(1, Math.ceil(Math.max(0, sampleCount - overlapSamples) / stepSamples));
  const accumulated = new Float64Array(sampleCount);
  const weights = new Float64Array(sampleCount);
  const imageDuration = settings.timeEndSeconds - settings.timeStartSeconds;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const coreStart = chunkIndex * stepSamples;
    const coreEnd = Math.min(sampleCount, coreStart + coreSamples);
    const expandedStartTime = Math.max(0, (coreStart - haloSamples) / settings.sampleRate);
    const expandedEndTime = Math.min(sampleCount, coreEnd + haloSamples) / settings.sampleRate;
    const affected = expandedEndTime >= settings.timeStartSeconds && expandedStartTime <= settings.timeEndSeconds;
    let coreValues: Float64Array | Float32Array;

    if (!affected) {
      coreValues = sourceTimeline.subarray(coreStart, coreEnd);
    } else {
      const segmentStart = Math.max(0, coreStart - haloSamples);
      const segmentEnd = Math.min(sampleCount, coreEnd + haloSamples);
      const segmentCount = segmentEnd - segmentStart;
      const segmentStartTime = segmentStart / settings.sampleRate;
      const localImageStart = Math.max(0, settings.timeStartSeconds - segmentStartTime);
      const localImageEnd = Math.min(segmentCount / settings.sampleRate, settings.timeEndSeconds - segmentStartTime);
      const cropStart = (Math.max(settings.timeStartSeconds, segmentStartTime) - settings.timeStartSeconds) / imageDuration;
      const cropEnd = (Math.min(settings.timeEndSeconds, segmentEnd / settings.sampleRate) - settings.timeStartSeconds) / imageDuration;
      const imageCrop = cropImageForTime(processed.compositedMagnitude, cropStart, cropEnd);
      if (!(maximumAbsolute(imageCrop.values) > 0)) {
        coreValues = sourceTimeline.subarray(coreStart, coreEnd);
      } else {
        onProgress?.({ stage: 'target-spectrum', chunkIndex: chunkIndex + 1, chunkCount });
        let target: TargetMagnitude;
        let initialPhase: Float64Array | undefined;
        if (mode === 'image-only') {
          target = createTargetMagnitude(
            imageCrop,
            segmentCount,
            stftConfig,
            localImageStart,
            localImageEnd,
            settings.minFrequencyHz,
            settings.maxFrequencyHz,
            settings.minAmplitudeDb,
            settings.maxAmplitudeDb,
          );
        } else {
          const sourceSpectrum = stft(sourceTimeline.slice(segmentStart, segmentEnd), stftConfig);
          const mapped = createMappedImageMagnitude(
            imageCrop,
            segmentCount,
            stftConfig,
            localImageStart,
            localImageEnd,
            settings.minFrequencyHz,
            settings.maxFrequencyHz,
          );
          target = createCompositeTarget(mapped, sourceSpectrum, sourceReference, settings.imageAttenuationDb);
          initialPhase = createSourcePhase(sourceSpectrum);
        }
        const segmentWaveform = griffinLim(target, {
          sampleCount: segmentCount,
          iterations: settings.griffinLimIterations,
          phaseSeed: settings.phaseSeed + chunkIndex,
          stftConfig,
          ...(initialPhase === undefined ? {} : { initialPhase }),
        }, (iteration, totalIterations) => {
          onProgress?.({
            stage: 'griffin-lim',
            iteration,
            totalIterations,
            chunkIndex: chunkIndex + 1,
            chunkCount,
          });
        });
        coreValues = segmentWaveform.subarray(coreStart - segmentStart, coreEnd - segmentStart);
      }
    }

    for (let offset = 0; offset < coreValues.length; offset += 1) {
      const outputIndex = coreStart + offset;
      let weight = 1;
      if (chunkIndex > 0 && offset < overlapSamples) {
        const fraction = (offset + 0.5) / overlapSamples;
        weight = Math.sin((Math.PI / 2) * fraction) ** 2;
      }
      const remaining = coreValues.length - offset;
      if (chunkIndex < chunkCount - 1 && remaining <= overlapSamples) {
        const fraction = (remaining - 0.5) / overlapSamples;
        weight = Math.min(weight, Math.sin((Math.PI / 2) * fraction) ** 2);
      }
      accumulated[outputIndex] = (accumulated[outputIndex] ?? 0) + (coreValues[offset] ?? 0) * weight;
      weights[outputIndex] = (weights[outputIndex] ?? 0) + weight;
    }
  }

  for (let index = 0; index < accumulated.length; index += 1) {
    const weight = weights[index] ?? 0;
    if (weight > 0) accumulated[index] = (accumulated[index] ?? 0) / weight;
  }
  if (mode === 'image-only') {
    accumulated.fill(0, 0, Math.min(accumulated.length, Math.round(settings.timeStartSeconds * settings.sampleRate)));
  }
  return normalizeWaveform(accumulated, settings.finalPeakDbfs);
}

export function generate(
  input: PipelineInput,
  settings: SpectraDrawSettings,
  maximumDisplayColumns = MAX_SPECTROGRAM_COLUMNS,
  onProgress?: PipelineProgressCallback,
): PipelineResult {
  const mode = determineMode(input);
  validateSettings(settings, mode);
  validateAudio(input.audio, settings.sampleRate);
  const sampleCount = calculateOutputSampleCount(input, settings);
  const stftConfig = createStftConfig(settings);
  onProgress?.({ stage: 'audio-preparation' });
  const sourceTimeline = placeAudio(input.audio, settings, sampleCount);
  const duration = sampleCount / settings.sampleRate;
  const samples = duration < LONG_PROCESSING_THRESHOLD_SECONDS
    ? generateShort(input, mode, sourceTimeline, sampleCount, stftConfig, settings, onProgress)
    : generateLong(input, mode, sourceTimeline, sampleCount, stftConfig, settings, onProgress);

  onProgress?.({ stage: 'final-stft' });
  const analysis = analyzeFullSpectrogram(samples, stftConfig, maximumDisplayColumns);
  return {
    mode,
    sampleRate: settings.sampleRate,
    samples,
    finalMagnitudeDb: analysis.tile.valuesDb,
    frameCount: analysis.tile.frameCount,
    binCount: analysis.tile.binCount,
    times: analysis.tile.times,
    frequencies: analysis.tile.frequencies,
    timeStartSeconds: mode === 'audio-only' ? settings.audioStartSeconds : settings.timeStartSeconds,
    timeEndSeconds: duration,
    minFrequencyHz: mode === 'audio-only' ? 0 : settings.minFrequencyHz,
    maxFrequencyHz: mode === 'audio-only' ? settings.sampleRate / 2 : settings.maxFrequencyHz,
    minAmplitudeDb: mode === 'composite' ? -settings.imageAttenuationDb : settings.minAmplitudeDb,
    maxAmplitudeDb: mode === 'composite' ? 0 : settings.maxAmplitudeDb,
    displayReferenceMagnitude: analysis.referenceMagnitude,
    stftConfig,
  };
}

export function generateFromImage(
  image: ImageData,
  settings: SpectraDrawSettings,
  onProgress?: PipelineProgressCallback,
): PipelineResult {
  return generate({ image }, settings, Number.MAX_SAFE_INTEGER, onProgress);
}
