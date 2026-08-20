import { describe, expect, it } from 'vitest';

import { getPlaybackCursorFraction } from '../src/audio/playbackCursor';

describe('playback cursor position', () => {
  it('maps playback time onto the current time view', () => {
    expect(getPlaybackCursorFraction(0, 0, 2)).toBe(0);
    expect(getPlaybackCursorFraction(1, 0, 2)).toBe(0.5);
    expect(getPlaybackCursorFraction(2, 0, 2)).toBe(1);
    expect(getPlaybackCursorFraction(1.25, 0.5, 2)).toBe(0.5);
  });

  it('hides the cursor when playback is outside the current view', () => {
    expect(getPlaybackCursorFraction(0.25, 0.5, 2)).toBeNull();
    expect(getPlaybackCursorFraction(2.1, 0.5, 2)).toBeNull();
    expect(getPlaybackCursorFraction(Number.NaN, 0, 2)).toBeNull();
  });
});
