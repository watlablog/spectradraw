import type { DecodedImage, SupportedImageFormat } from '../types';

const MIME_BY_FORMAT: Readonly<Record<SupportedImageFormat, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function detectImageFormat(bytes: Uint8Array): SupportedImageFormat | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The browser could not decode this image.'));
    };
    image.src = url;
  });
}

export async function decodeImageFile(file: File): Promise<DecodedImage> {
  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const format = detectImageFormat(signature);
  if (format === null) {
    throw new Error('Unsupported image. Choose a PNG, JPEG, or WebP file.');
  }

  const canonicalBlob = new Blob([file], { type: MIME_BY_FORMAT[format] });
  let source: ImageBitmap | HTMLImageElement;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(canonicalBlob, { imageOrientation: 'from-image' });
    source = bitmap;
  } catch {
    source = await loadImageElement(canonicalBlob);
  }

  const width = source.width;
  const height = source.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    bitmap?.close();
    throw new Error('The decoded image has invalid dimensions.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) {
    bitmap?.close();
    throw new Error('A canvas could not be created for this image.');
  }

  try {
    context.drawImage(source, 0, 0);
    const imageData = context.getImageData(0, 0, width, height);
    return { fileName: file.name, format, width, height, imageData };
  } catch {
    throw new Error('The image could not be converted to RGBA pixels.');
  } finally {
    bitmap?.close();
  }
}
