import type { Matrix2D, StftConfig, TargetMagnitude } from '../types';
import { normalizeMagnitude } from '../dsp/magnitude';
import { createStftLayout } from '../dsp/stft';
import { resizeBilinear } from './resizeMatrix';

export function createTargetMagnitude(
  source: Matrix2D,
  sampleCount: number,
  stftConfig: StftConfig,
  timeStartSeconds: number,
  timeEndSeconds: number,
  minimumFrequencyHz: number,
  maximumFrequencyHz: number,
  minimumAmplitudeDb: number,
  maximumAmplitudeDb: number,
): TargetMagnitude {
  const layout = createStftLayout(sampleCount, stftConfig);
  const selectedFrames: number[] = [];
  for (let frame = 0; frame < layout.frameCount; frame += 1) {
    const time = layout.times[frame] ?? 0;
    if (time >= timeStartSeconds && time <= timeEndSeconds) {
      selectedFrames.push(frame);
    }
  }
  if (selectedFrames.length === 0) {
    throw new Error('The selected time range contains no STFT frames.');
  }

  const selectedBins: number[] = [];
  for (let bin = 0; bin < layout.binCount; bin += 1) {
    const frequency = layout.frequencies[bin] ?? 0;
    if (frequency >= minimumFrequencyHz && frequency <= maximumFrequencyHz) {
      selectedBins.push(bin);
    }
  }
  if (selectedBins.length === 0) {
    throw new Error('The selected frequency range contains no STFT bins.');
  }

  const verticallyFlipped = new Float64Array(source.values.length);
  for (let row = 0; row < source.rows; row += 1) {
    const sourceRow = source.rows - row - 1;
    for (let col = 0; col < source.cols; col += 1) {
      verticallyFlipped[row * source.cols + col] = Math.fround(
        source.values[sourceRow * source.cols + col] ?? 0,
      );
    }
  }

  const resized = resizeBilinear(
    { rows: source.rows, cols: source.cols, values: verticallyFlipped },
    selectedBins.length,
    selectedFrames.length,
  );
  const values = new Float64Array(layout.binCount * layout.frameCount);
  for (let selectedIndex = 0; selectedIndex < selectedBins.length; selectedIndex += 1) {
    const targetBin = selectedBins[selectedIndex];
    if (targetBin === undefined) {
      continue;
    }
    const sourceOffset = selectedIndex * selectedFrames.length;
    const targetOffset = targetBin * layout.frameCount;
    for (let timeIndex = 0; timeIndex < selectedFrames.length; timeIndex += 1) {
      const targetFrame = selectedFrames[timeIndex];
      if (targetFrame !== undefined) {
        values[targetOffset + targetFrame] = resized.values[sourceOffset + timeIndex] ?? 0;
      }
    }
  }

  if (!(normalizeMagnitude(values) > 0)) {
    throw new Error('This image does not contain any content that can be converted to sound.');
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    if (value > 0) {
      const amplitudeDb = minimumAmplitudeDb
        + value * (maximumAmplitudeDb - minimumAmplitudeDb);
      values[index] = 10 ** (amplitudeDb / 20);
    }
  }

  return { frameCount: layout.frameCount, binCount: layout.binCount, values };
}
