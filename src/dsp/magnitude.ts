import type { ComplexSpectrogram } from '../types';

export function magnitudeFromComplex(spectrum: ComplexSpectrogram): Float64Array {
  const magnitude = new Float64Array(spectrum.real.length);
  for (let index = 0; index < magnitude.length; index += 1) {
    magnitude[index] = Math.hypot(spectrum.real[index] ?? 0, spectrum.imag[index] ?? 0);
  }
  return magnitude;
}

export function normalizeMagnitude(values: Float64Array): number {
  let maximum = 0;
  for (const value of values) {
    if (value > maximum) {
      maximum = value;
    }
  }
  if (!(maximum > 0)) {
    return 0;
  }
  for (let index = 0; index < values.length; index += 1) {
    values[index] = (values[index] ?? 0) / maximum;
  }
  return maximum;
}

export function magnitudeToDb(
  magnitude: Float64Array,
  minimumDb: number,
): Float32Array {
  let reference = 0;
  for (const value of magnitude) {
    if (value > reference) {
      reference = value;
    }
  }

  const result = new Float32Array(magnitude.length);
  if (!(reference > 0)) {
    result.fill(minimumDb);
    return result;
  }

  const minimumMagnitude = reference * 10 ** (minimumDb / 20);
  for (let index = 0; index < magnitude.length; index += 1) {
    const clipped = Math.max(magnitude[index] ?? 0, minimumMagnitude);
    result[index] = 20 * Math.log10(clipped / reference);
  }
  return result;
}
