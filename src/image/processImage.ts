import type { Matrix2D, SpectraDrawSettings } from '../types';
import { normalizeMagnitude } from '../dsp/magnitude';
import { gaussianBlur, sobelMagnitude } from './kernels';

export interface ProcessedImage {
  imageMagnitude: Matrix2D;
  compositedMagnitude: Matrix2D;
}

function percentile(values: number[], requestedPercentile: number): number {
  if (values.length === 0) {
    return 0;
  }
  values.sort((left, right) => left - right);
  const position = ((values.length - 1) * requestedPercentile) / 100;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;
  const lower = values[lowerIndex] ?? 0;
  const upper = values[upperIndex] ?? lower;
  return lower + (upper - lower) * fraction;
}

export function processImageData(
  image: ImageData,
  settings: SpectraDrawSettings,
): ProcessedImage {
  const { width, height, data } = image;
  if (width < 1 || height < 1 || data.length !== width * height * 4) {
    throw new Error('Decoded image dimensions are invalid.');
  }

  const pixelCount = width * height;
  const grayscale = new Float64Array(pixelCount);
  const alpha = new Float64Array(pixelCount);
  const imageMagnitude = new Float64Array(pixelCount);
  const posterized = new Float64Array(pixelCount);

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sourceIndex = pixel * 4;
    const red = data[sourceIndex] ?? 0;
    const green = data[sourceIndex + 1] ?? 0;
    const blue = data[sourceIndex + 2] ?? 0;
    const pixelAlpha = (data[sourceIndex + 3] ?? 0) / 255;
    const gray = Math.max(0, Math.min(255, Math.round(0.299 * red + 0.587 * green + 0.114 * blue)));
    const inverted = 1 - gray / 255;

    grayscale[pixel] = gray;
    alpha[pixel] = pixelAlpha;
    imageMagnitude[pixel] = inverted * pixelAlpha;
    posterized[pixel] = (
      Math.round(inverted * (settings.posterLevels - 1))
      / (settings.posterLevels - 1)
    ) * pixelAlpha;
  }
  normalizeMagnitude(imageMagnitude);
  normalizeMagnitude(posterized);

  const blurred = gaussianBlur(
    grayscale,
    width,
    height,
    settings.gaussianKernelSize,
  );
  const sobel = sobelMagnitude(
    blurred,
    width,
    height,
    settings.sobelKernelSize,
  );
  const nonzero: number[] = [];
  for (const value of sobel) {
    if (value > 0) {
      nonzero.push(value);
    }
  }
  const normalizationValue = percentile(nonzero, settings.sobelNormalizationPercentile);
  if (normalizationValue > 0) {
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const normalized = Math.min(1, (sobel[pixel] ?? 0) / normalizationValue);
      sobel[pixel] = normalized < settings.sobelThreshold
        ? 0
        : normalized * (alpha[pixel] ?? 0);
    }
    normalizeMagnitude(sobel);
  } else {
    sobel.fill(0);
  }

  const posterGain = 10 ** (-settings.posterAttenuationDb / 20);
  const composited = new Float64Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    composited[pixel] = Math.max(
      sobel[pixel] ?? 0,
      (posterized[pixel] ?? 0) * posterGain,
    );
  }

  return {
    imageMagnitude: { rows: height, cols: width, values: imageMagnitude },
    compositedMagnitude: { rows: height, cols: width, values: composited },
  };
}
