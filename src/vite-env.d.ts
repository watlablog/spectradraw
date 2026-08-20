/// <reference types="vite/client" />

declare module 'fft.js' {
  export default class FFT {
    constructor(size: number);
    createComplexArray(): number[];
    transform(output: number[], input: number[]): void;
    realTransform(output: number[], input: ArrayLike<number>): void;
    inverseTransform(output: number[], input: number[]): void;
  }
}
