import type { DecodedAudio, SupportedAudioFormat } from '../types';

const MINIMUM_SAMPLE_RATE = 8_000;
const MAXIMUM_SAMPLE_RATE = 96_000;

interface AudioBufferLike {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return result;
}

function isMp3FrameHeader(bytes: Uint8Array, offset: number): boolean {
  if (offset + 4 > bytes.length) {
    return false;
  }
  const first = bytes[offset] ?? 0;
  const second = bytes[offset + 1] ?? 0;
  const third = bytes[offset + 2] ?? 0;
  const versionBits = (second >> 3) & 0x03;
  const layerBits = (second >> 1) & 0x03;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  return first === 0xff
    && (second & 0xe0) === 0xe0
    && versionBits !== 0x01
    && layerBits === 0x01
    && bitrateIndex !== 0
    && bitrateIndex !== 0x0f
    && sampleRateIndex !== 0x03;
}

function id3PayloadEnd(bytes: Uint8Array): number {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'ID3') {
    return 0;
  }
  const sizeBytes = [bytes[6] ?? 0, bytes[7] ?? 0, bytes[8] ?? 0, bytes[9] ?? 0];
  if (sizeBytes.some((value) => (value & 0x80) !== 0)) {
    throw new Error('The MP3 has an invalid ID3 header.');
  }
  const size = ((sizeBytes[0] ?? 0) << 21)
    | ((sizeBytes[1] ?? 0) << 14)
    | ((sizeBytes[2] ?? 0) << 7)
    | (sizeBytes[3] ?? 0);
  const footerLength = ((bytes[5] ?? 0) & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footerLength;
}

function findMp3Frame(bytes: Uint8Array): number {
  const start = id3PayloadEnd(bytes);
  const limit = Math.min(bytes.length - 4, start + 1_048_576);
  for (let offset = start; offset <= limit; offset += 1) {
    if (isMp3FrameHeader(bytes, offset)) {
      return offset;
    }
  }
  return -1;
}

export function detectAudioFormat(bytes: Uint8Array): SupportedAudioFormat | null {
  if (
    bytes.length >= 12
    && ascii(bytes, 0, 4) === 'RIFF'
    && ascii(bytes, 8, 4) === 'WAVE'
  ) {
    return 'wav';
  }
  if (bytes.length >= 10 && ascii(bytes, 0, 3) === 'ID3') {
    return 'mp3';
  }
  return findMp3Frame(bytes) >= 0 ? 'mp3' : null;
}

function validateSampleRate(sampleRate: number): number {
  if (
    !Number.isInteger(sampleRate)
    || sampleRate < MINIMUM_SAMPLE_RATE
    || sampleRate > MAXIMUM_SAMPLE_RATE
  ) {
    throw new Error(`Audio sample rate must be between ${MINIMUM_SAMPLE_RATE} and ${MAXIMUM_SAMPLE_RATE} Hz.`);
  }
  return sampleRate;
}

export function readWavSampleRate(bytes: Uint8Array): number {
  if (detectAudioFormat(bytes) !== 'wav') {
    throw new Error('The WAV signature is invalid.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkName = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (chunkName === 'fmt ') {
      if (chunkSize < 16 || dataOffset + 8 > bytes.length) {
        throw new Error('The WAV fmt chunk is truncated.');
      }
      return validateSampleRate(view.getUint32(dataOffset + 4, true));
    }
    const nextOffset = dataOffset + chunkSize + (chunkSize & 1);
    if (nextOffset <= offset || nextOffset > bytes.length) {
      break;
    }
    offset = nextOffset;
  }
  throw new Error('The WAV does not contain a valid fmt chunk.');
}

export function readMp3SampleRate(bytes: Uint8Array): number {
  const offset = findMp3Frame(bytes);
  if (offset < 0) {
    throw new Error('The MP3 does not contain a valid Layer III frame.');
  }
  const second = bytes[offset + 1] ?? 0;
  const third = bytes[offset + 2] ?? 0;
  const versionBits = (second >> 3) & 0x03;
  const sampleRateIndex = (third >> 2) & 0x03;
  const baseRates = [44_100, 48_000, 32_000];
  const baseRate = baseRates[sampleRateIndex];
  if (baseRate === undefined) {
    throw new Error('The MP3 sample rate is invalid.');
  }
  const divisor = versionBits === 0x03 ? 1 : versionBits === 0x02 ? 2 : 4;
  return validateSampleRate(baseRate / divisor);
}

export function downmixToMono(buffer: AudioBufferLike): Float32Array {
  if (buffer.length < 1 || buffer.numberOfChannels < 1) {
    throw new Error('The decoded audio is empty.');
  }
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    if (source.length !== buffer.length) {
      throw new Error('The decoded audio channel lengths do not match.');
    }
    for (let index = 0; index < mono.length; index += 1) {
      const value = source[index] ?? 0;
      if (!Number.isFinite(value)) {
        throw new Error('The decoded audio contains non-finite samples.');
      }
      mono[index] = (mono[index] ?? 0) + value / buffer.numberOfChannels;
    }
  }
  return mono;
}

export async function decodeAudioFile(file: File): Promise<DecodedAudio> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const format = detectAudioFormat(bytes);
  if (format === null) {
    throw new Error('Unsupported audio. Choose a WAV or MP3 file.');
  }
  const sampleRate = format === 'wav'
    ? readWavSampleRate(bytes)
    : readMp3SampleRate(bytes);

  let decoded: AudioBuffer;
  try {
    const context = new OfflineAudioContext(1, 1, sampleRate);
    decoded = await context.decodeAudioData(arrayBuffer.slice(0));
  } catch {
    throw new Error(`The browser could not decode this ${format.toUpperCase()} file.`);
  }
  if (decoded.sampleRate !== sampleRate) {
    throw new Error('The browser could not preserve the source audio sample rate.');
  }
  const samples = downmixToMono(decoded);
  return {
    fileName: file.name,
    format,
    sampleRate,
    channelCount: decoded.numberOfChannels,
    durationSeconds: samples.length / sampleRate,
    samples,
  };
}
