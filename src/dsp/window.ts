export function createPeriodicHann(size: number): Float64Array {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error('Window size must be an integer greater than one.');
  }

  const window = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }
  return window;
}

export function scaleWindowToMagnitude(window: Float64Array): Float64Array {
  let sum = 0;
  for (const value of window) {
    sum += value;
  }
  if (!(sum > 0)) {
    throw new Error('A magnitude-scaled window must have a positive sum.');
  }

  const scaled = new Float64Array(window.length);
  for (let index = 0; index < window.length; index += 1) {
    scaled[index] = (window[index] ?? 0) / sum;
  }
  return scaled;
}

export function createCanonicalDualWindow(
  analysisWindow: Float64Array,
  hopSize: number,
): Float64Array {
  if (!Number.isInteger(hopSize) || hopSize < 1 || hopSize > analysisWindow.length) {
    throw new Error('Hop size must be between one and the window length.');
  }

  const denominatorByResidue = new Float64Array(hopSize);
  for (let index = 0; index < analysisWindow.length; index += 1) {
    const value = analysisWindow[index] ?? 0;
    const residue = index % hopSize;
    denominatorByResidue[residue] = (denominatorByResidue[residue] ?? 0) + value * value;
  }

  const dual = new Float64Array(analysisWindow.length);
  for (let index = 0; index < analysisWindow.length; index += 1) {
    const denominator = denominatorByResidue[index % hopSize] ?? 0;
    if (!(denominator > 0)) {
      throw new Error('The selected window and hop size are not invertible.');
    }
    dual[index] = (analysisWindow[index] ?? 0) / denominator;
  }
  return dual;
}
