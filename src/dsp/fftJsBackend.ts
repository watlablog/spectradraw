import FFT from 'fft.js';

import type { FftBackend } from './fftBackend';

export class FftJsBackend implements FftBackend {
  readonly size: number;

  private readonly fft: FFT;
  private readonly forwardBuffer: number[];
  private readonly inverseInput: number[];
  private readonly inverseOutput: number[];

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0) {
      throw new Error('FFT size must be a power of two greater than one.');
    }

    this.size = size;
    this.fft = new FFT(size);
    this.forwardBuffer = this.fft.createComplexArray();
    this.inverseInput = this.fft.createComplexArray();
    this.inverseOutput = this.fft.createComplexArray();
  }

  forwardReal(
    input: Float64Array,
    outputReal: Float64Array,
    outputImag: Float64Array,
  ): void {
    const binCount = this.size / 2 + 1;
    if (input.length !== this.size || outputReal.length < binCount || outputImag.length < binCount) {
      throw new Error('Invalid forward FFT buffer length.');
    }

    this.fft.realTransform(this.forwardBuffer, input);
    for (let bin = 0; bin < binCount; bin += 1) {
      outputReal[bin] = this.forwardBuffer[2 * bin] ?? 0;
      outputImag[bin] = this.forwardBuffer[2 * bin + 1] ?? 0;
    }
  }

  inverseComplex(
    real: Float64Array,
    imag: Float64Array,
    output: Float64Array,
  ): void {
    if (real.length !== this.size || imag.length !== this.size || output.length !== this.size) {
      throw new Error('Invalid inverse FFT buffer length.');
    }

    for (let index = 0; index < this.size; index += 1) {
      this.inverseInput[2 * index] = real[index] ?? 0;
      this.inverseInput[2 * index + 1] = imag[index] ?? 0;
    }

    this.fft.inverseTransform(this.inverseOutput, this.inverseInput);
    for (let index = 0; index < this.size; index += 1) {
      output[index] = this.inverseOutput[2 * index] ?? 0;
    }
  }
}
