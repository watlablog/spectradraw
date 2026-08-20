import type { Matrix2D, StftConfig, TargetMagnitude } from '../types';
import { normalizeMagnitude } from '../dsp/magnitude';
import { createStftLayout } from '../dsp/stft';
import { resizeBilinear } from './resizeMatrix';

export function createTargetMagnitude(
  source: Matrix2D,
  sampleCount: number,
  stftConfig: StftConfig,
  minimumFrequencyHz: number,
  maximumFrequencyHz: number,
): TargetMagnitude {
  const layout = createStftLayout(sampleCount, stftConfig);
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
    layout.frameCount,
  );
  const values = new Float64Array(layout.binCount * layout.frameCount);
  for (let selectedIndex = 0; selectedIndex < selectedBins.length; selectedIndex += 1) {
    const targetBin = selectedBins[selectedIndex];
    if (targetBin === undefined) {
      continue;
    }
    const sourceOffset = selectedIndex * layout.frameCount;
    const targetOffset = targetBin * layout.frameCount;
    values.set(resized.values.subarray(sourceOffset, sourceOffset + layout.frameCount), targetOffset);
  }

  if (!(normalizeMagnitude(values) > 0)) {
    throw new Error('This image does not contain any content that can be converted to sound.');
  }

  return { frameCount: layout.frameCount, binCount: layout.binCount, values };
}
