export interface FftBackend {
  readonly size: number;

  forwardReal(
    input: Float64Array,
    outputReal: Float64Array,
    outputImag: Float64Array,
  ): void;

  inverseComplex(
    real: Float64Array,
    imag: Float64Array,
    output: Float64Array,
  ): void;
}
