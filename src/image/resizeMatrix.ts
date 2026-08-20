import type { Matrix2D } from '../types';

interface ResampleCoefficients {
  start: number;
  weights: Float64Array;
}

function createPillowBilinearCoefficients(
  sourceSize: number,
  targetSize: number,
): ResampleCoefficients[] {
  const scale = sourceSize / targetSize;
  const filterScale = Math.max(1, scale);
  const support = filterScale;
  const coefficients: ResampleCoefficients[] = [];

  for (let targetIndex = 0; targetIndex < targetSize; targetIndex += 1) {
    const center = (targetIndex + 0.5) * scale;
    const start = Math.max(0, Math.floor(center - support + 0.5));
    const end = Math.min(sourceSize, Math.floor(center + support + 0.5));
    const weights = new Float64Array(Math.max(0, end - start));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      const distance = (sourceIndex - center + 0.5) / filterScale;
      const weight = Math.max(0, 1 - Math.abs(distance));
      weights[sourceIndex - start] = weight;
      sum += weight;
    }
    if (!(sum > 0)) {
      throw new Error('Bilinear resize produced an empty filter.');
    }
    for (let index = 0; index < weights.length; index += 1) {
      weights[index] = (weights[index] ?? 0) / sum;
    }
    coefficients.push({ start, weights });
  }
  return coefficients;
}

export function resizeBilinear(
  source: Matrix2D,
  targetRows: number,
  targetCols: number,
): Matrix2D {
  if (source.values.length !== source.rows * source.cols || source.rows < 1 || source.cols < 1) {
    throw new Error('Source matrix dimensions are invalid.');
  }
  if (!Number.isInteger(targetRows) || !Number.isInteger(targetCols) || targetRows < 1 || targetCols < 1) {
    throw new Error('Resize dimensions must be positive integers.');
  }

  const horizontalCoefficients = createPillowBilinearCoefficients(source.cols, targetCols);
  const verticalCoefficients = createPillowBilinearCoefficients(source.rows, targetRows);
  const horizontal = new Float64Array(source.rows * targetCols);
  const result = new Float64Array(targetRows * targetCols);

  for (let row = 0; row < source.rows; row += 1) {
    for (let targetCol = 0; targetCol < targetCols; targetCol += 1) {
      const coefficient = horizontalCoefficients[targetCol];
      if (coefficient === undefined) {
        continue;
      }
      let value = 0;
      for (let offset = 0; offset < coefficient.weights.length; offset += 1) {
        value += (source.values[row * source.cols + coefficient.start + offset] ?? 0)
          * (coefficient.weights[offset] ?? 0);
      }
      horizontal[row * targetCols + targetCol] = Math.fround(value);
    }
  }

  for (let targetRow = 0; targetRow < targetRows; targetRow += 1) {
    const coefficient = verticalCoefficients[targetRow];
    if (coefficient === undefined) {
      continue;
    }
    for (let col = 0; col < targetCols; col += 1) {
      let value = 0;
      for (let offset = 0; offset < coefficient.weights.length; offset += 1) {
        value += (horizontal[(coefficient.start + offset) * targetCols + col] ?? 0)
          * (coefficient.weights[offset] ?? 0);
      }
      // Pillow's mode F path stores each resized value as float32.
      result[targetRow * targetCols + col] = Math.fround(value);
    }
  }

  return { rows: targetRows, cols: targetCols, values: result };
}
