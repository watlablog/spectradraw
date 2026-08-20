export interface WaveformEnvelope {
  minima: Float32Array;
  maxima: Float32Array;
}

export function dbfsToLinear(dbfs: number): number {
  if (!Number.isFinite(dbfs)) {
    throw new Error('The dBFS value must be finite.');
  }
  return 10 ** (dbfs / 20);
}

export function createWaveformEnvelope(
  samples: Float32Array,
  sampleRate: number,
  minimumTimeSeconds: number,
  maximumTimeSeconds: number,
  columnCount: number,
): WaveformEnvelope {
  if (
    !Number.isFinite(sampleRate)
    || sampleRate <= 0
    || !Number.isFinite(minimumTimeSeconds)
    || !Number.isFinite(maximumTimeSeconds)
    || minimumTimeSeconds < 0
    || minimumTimeSeconds >= maximumTimeSeconds
    || !Number.isInteger(columnCount)
    || columnCount < 1
  ) {
    throw new Error('Waveform envelope parameters are invalid.');
  }

  const minima = new Float32Array(columnCount);
  const maxima = new Float32Array(columnCount);
  const timeSpan = maximumTimeSeconds - minimumTimeSeconds;

  for (let column = 0; column < columnCount; column += 1) {
    const columnStartTime = minimumTimeSeconds + (column / columnCount) * timeSpan;
    const columnEndTime = minimumTimeSeconds + ((column + 1) / columnCount) * timeSpan;
    const sampleStart = Math.max(0, Math.min(
      samples.length,
      Math.floor(columnStartTime * sampleRate),
    ));
    const sampleEnd = Math.max(sampleStart, Math.min(
      samples.length,
      Math.ceil(columnEndTime * sampleRate),
    ));

    let minimum = 0;
    let maximum = 0;
    for (let sample = sampleStart; sample < sampleEnd; sample += 1) {
      const value = samples[sample] ?? 0;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    minima[column] = minimum;
    maxima[column] = maximum;
  }

  return { minima, maxima };
}
