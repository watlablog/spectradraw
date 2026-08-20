export function getPlaybackCursorFraction(
  playbackTimeSeconds: number,
  minimumTimeSeconds: number,
  maximumTimeSeconds: number,
): number | null {
  if (
    !Number.isFinite(playbackTimeSeconds)
    || !Number.isFinite(minimumTimeSeconds)
    || !Number.isFinite(maximumTimeSeconds)
    || minimumTimeSeconds >= maximumTimeSeconds
    || playbackTimeSeconds < minimumTimeSeconds
    || playbackTimeSeconds > maximumTimeSeconds
  ) {
    return null;
  }
  return (playbackTimeSeconds - minimumTimeSeconds)
    / (maximumTimeSeconds - minimumTimeSeconds);
}
