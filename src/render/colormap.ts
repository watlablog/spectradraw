function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function jetColor(value: number): readonly [number, number, number] {
  const normalized = clamp01(value);
  const red = clamp01(1.5 - Math.abs(4 * normalized - 3));
  const green = clamp01(1.5 - Math.abs(4 * normalized - 2));
  const blue = clamp01(1.5 - Math.abs(4 * normalized - 1));
  return [Math.round(red * 255), Math.round(green * 255), Math.round(blue * 255)];
}
