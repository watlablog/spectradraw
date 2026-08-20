import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../src/config';
import { createTargetMagnitude } from '../src/image/createTargetMagnitude';
import { detectImageFormat } from '../src/image/decodeImage';
import { gaussianBlur } from '../src/image/kernels';
import { processImageData } from '../src/image/processImage';
import { resizeBilinear } from '../src/image/resizeMatrix';

function imageData(width: number, height: number, rgba: number[]): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(rgba),
    colorSpace: 'srgb',
  } as ImageData;
}

describe('image signature detection', () => {
  it('detects PNG, JPEG, and WebP independently of names and MIME types', () => {
    expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageFormat(new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]))).toBe('webp');
  });

  it('rejects unsupported or truncated signatures', () => {
    expect(detectImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(detectImageFormat(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});

describe('image processing', () => {
  it('matches OpenCV grayscale GaussianBlur behavior on a compact fixture', () => {
    const grayscale = new Float64Array([0, 255, 76, 150]);
    expect(Array.from(gaussianBlur(grayscale, 2, 2, 5))).toEqual([120, 120, 120, 120]);
  });

  it('keeps all-white and fully transparent inputs finite and silent', () => {
    const white = processImageData(imageData(2, 2, [
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]), { ...DEFAULT_SETTINGS });
    const transparent = processImageData(imageData(2, 2, [
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]), { ...DEFAULT_SETTINGS });

    expect(Array.from(white.compositedMagnitude.values)).toEqual([0, 0, 0, 0]);
    expect(Array.from(transparent.compositedMagnitude.values)).toEqual([0, 0, 0, 0]);
    expect(Array.from(white.compositedMagnitude.values).every(Number.isFinite)).toBe(true);
  });

  it('applies alpha to inverted brightness', () => {
    const processed = processImageData(imageData(2, 1, [
      0, 0, 0, 255,
      0, 0, 0, 128,
    ]), { ...DEFAULT_SETTINGS });
    expect(processed.imageMagnitude.values[0]).toBe(1);
    expect(processed.imageMagnitude.values[1]).toBeCloseTo(128 / 255, 12);
  });
});

describe('bilinear matrix resize', () => {
  it('uses half-pixel coordinates and edge clamping', () => {
    const resized = resizeBilinear({
      rows: 2,
      cols: 2,
      values: new Float64Array([1, 2, 3, 4]),
    }, 3, 3);
    expect(Array.from(resized.values)).toEqual([
      1, 1.5, 2,
      2, 2.5, 3,
      3, 3.5, 4,
    ]);
  });

  it('matches Pillow BILINEAR filter widening when reducing an image', () => {
    const resized = resizeBilinear({
      rows: 4,
      cols: 4,
      values: new Float64Array([
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16,
      ]),
    }, 2, 2);
    expect(Array.from(resized.values)).toEqual([
      4.5714287757873535,
      6.142857074737549,
      10.85714340209961,
      12.428571701049805,
    ]);
  });
});

describe('target time placement', () => {
  it('writes image energy only to frames inside the selected start/end range', () => {
    const target = createTargetMagnitude(
      { rows: 1, cols: 1, values: new Float64Array([1]) },
      10,
      { sampleRate: 100, frameSize: 8, hopSize: 2, fftSize: 8 },
      0.04,
      0.08,
      0,
      50,
      -20,
      0,
    );

    const activeFrames = new Set([3, 4, 5]);
    for (let bin = 0; bin < target.binCount; bin += 1) {
      for (let frame = 0; frame < target.frameCount; frame += 1) {
        const value = target.values[bin * target.frameCount + frame] ?? 0;
        if (activeFrames.has(frame)) {
          expect(value).toBe(1);
        } else {
          expect(value).toBe(0);
        }
      }
    }
  });

  it('maps nonzero image levels into the requested dB range', () => {
    const target = createTargetMagnitude(
      { rows: 1, cols: 2, values: new Float64Array([0.25, 1]) },
      10,
      { sampleRate: 100, frameSize: 8, hopSize: 2, fftSize: 8 },
      0.04,
      0.08,
      0,
      50,
      -20,
      0,
    );
    const nonzero = Array.from(target.values).filter((value) => value > 0);
    expect(Math.min(...nonzero)).toBeGreaterThanOrEqual(0.1);
    expect(Math.max(...nonzero)).toBe(1);
  });
});
