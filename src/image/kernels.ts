function reflect101(index: number, length: number): number {
  if (length <= 1) {
    return 0;
  }

  let reflected = index;
  while (reflected < 0 || reflected >= length) {
    reflected = reflected < 0
      ? -reflected
      : 2 * length - reflected - 2;
  }
  return reflected;
}

function gaussianKernel1d(size: number): Float64Array {
  if (!Number.isInteger(size) || size < 1 || size % 2 === 0) {
    throw new Error('Gaussian kernel size must be a positive odd integer.');
  }

  if (size === 5) {
    return new Float64Array([1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]);
  }

  const sigma = 0.3 * ((size - 1) * 0.5 - 1) + 0.8;
  const radius = Math.floor(size / 2);
  const kernel = new Float64Array(size);
  let sum = 0;
  for (let index = 0; index < size; index += 1) {
    const distance = index - radius;
    const value = Math.exp(-(distance * distance) / (2 * sigma * sigma));
    kernel[index] = value;
    sum += value;
  }
  for (let index = 0; index < size; index += 1) {
    kernel[index] = (kernel[index] ?? 0) / sum;
  }
  return kernel;
}

export function gaussianBlur(
  source: Float64Array,
  width: number,
  height: number,
  kernelSize: number,
): Float64Array {
  if (source.length !== width * height) {
    throw new Error('Gaussian source dimensions are invalid.');
  }

  const kernel = gaussianKernel1d(kernelSize);
  const radius = Math.floor(kernelSize / 2);
  const horizontal = new Float64Array(source.length);
  const result = new Float64Array(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceX = reflect101(x + offset, width);
        sum += (source[y * width + sourceX] ?? 0) * (kernel[offset + radius] ?? 0);
      }
      horizontal[y * width + x] = sum;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceY = reflect101(y + offset, height);
        sum += (horizontal[sourceY * width + x] ?? 0) * (kernel[offset + radius] ?? 0);
      }
      // cv2.GaussianBlur receives uint8 grayscale and returns uint8.
      result[y * width + x] = Math.max(0, Math.min(255, Math.round(sum)));
    }
  }
  return result;
}

export function sobelMagnitude(
  source: Float64Array,
  width: number,
  height: number,
  kernelSize: number,
): Float64Array {
  if (source.length !== width * height) {
    throw new Error('Sobel source dimensions are invalid.');
  }
  if (kernelSize !== 3) {
    throw new Error('The MVP supports a 3x3 Sobel kernel.');
  }

  const kernelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1] as const;
  const kernelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1] as const;
  const result = new Float64Array(source.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let gradientX = 0;
      let gradientY = 0;
      let kernelIndex = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sourceY = reflect101(y + offsetY, height);
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sourceX = reflect101(x + offsetX, width);
          const value = source[sourceY * width + sourceX] ?? 0;
          gradientX += value * (kernelX[kernelIndex] ?? 0);
          gradientY += value * (kernelY[kernelIndex] ?? 0);
          kernelIndex += 1;
        }
      }
      result[y * width + x] = Math.hypot(gradientX, gradientY);
    }
  }
  return result;
}
