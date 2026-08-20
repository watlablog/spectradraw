import { describe, expect, it } from 'vitest';

import { createWaveformEnvelope, dbfsToLinear } from '../src/render/waveform';

describe('waveform rendering data', () => {
  it('converts a dBFS view maximum to a linear symmetric limit', () => {
    expect(dbfsToLinear(0)).toBe(1);
    expect(dbfsToLinear(-20)).toBeCloseTo(0.1, 14);
    expect(dbfsToLinear(-6)).toBeCloseTo(0.5011872336272722, 14);
  });

  it('builds min/max columns only from the selected time interval', () => {
    const envelope = createWaveformEnvelope(
      new Float32Array([0, 0.25, -0.5, 0.75, -1, 0.5, 0.125, 0]),
      4,
      0.5,
      1.5,
      2,
    );

    expect(Array.from(envelope.minima)).toEqual([-0.5, -1]);
    expect(Array.from(envelope.maxima)).toEqual([0.75, 0.5]);
  });
});
