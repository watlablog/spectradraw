import { jetColor } from './colormap';

export interface SpectrogramRenderData {
  valuesDb: Float32Array;
  frameCount: number;
  binCount: number;
  times: Float64Array;
  frequencies: Float64Array;
  durationSeconds: number;
  minimumDb: number;
}

function formatFrequency(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k` : `${Math.round(value)}`;
}

export function renderSpectrogram(
  canvas: HTMLCanvasElement,
  data: SpectrogramRenderData,
): void {
  if (
    data.valuesDb.length !== data.frameCount * data.binCount
    || data.times.length !== data.frameCount
    || data.frequencies.length !== data.binCount
  ) {
    throw new Error('Spectrogram render dimensions are invalid.');
  }

  const parentWidth = canvas.parentElement?.clientWidth ?? 800;
  const cssWidth = Math.max(300, parentWidth);
  const cssHeight = Math.max(330, Math.min(620, cssWidth * 0.64));
  const deviceScale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssWidth * deviceScale);
  canvas.height = Math.round(cssHeight * deviceScale);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('The spectrogram canvas is unavailable.');
  }
  context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const left = 68;
  const top = 24;
  const right = 92;
  const bottom = 58;
  const plotWidth = Math.max(1, cssWidth - left - right);
  const plotHeight = Math.max(1, cssHeight - top - bottom);
  const bitmapWidth = Math.max(1, Math.round(plotWidth * deviceScale));
  const bitmapHeight = Math.max(1, Math.round(plotHeight * deviceScale));
  const bitmap = new ImageData(bitmapWidth, bitmapHeight);
  const firstTime = data.times[0] ?? 0;
  const lastTime = data.times[data.frameCount - 1] ?? firstTime;

  for (let y = 0; y < bitmapHeight; y += 1) {
    const frequencyFraction = 1 - y / Math.max(1, bitmapHeight - 1);
    const bin = Math.max(0, Math.min(data.binCount - 1, Math.round(frequencyFraction * (data.binCount - 1))));
    for (let x = 0; x < bitmapWidth; x += 1) {
      const time = (x / Math.max(1, bitmapWidth - 1)) * data.durationSeconds;
      const frameFraction = lastTime === firstTime ? 0 : (time - firstTime) / (lastTime - firstTime);
      const frame = Math.max(0, Math.min(data.frameCount - 1, Math.round(frameFraction * (data.frameCount - 1))));
      const db = data.valuesDb[bin * data.frameCount + frame] ?? data.minimumDb;
      const normalized = Math.max(0, Math.min(1, (db - data.minimumDb) / -data.minimumDb));
      const [red, green, blue] = jetColor(normalized);
      const pixel = (y * bitmapWidth + x) * 4;
      bitmap.data[pixel] = red;
      bitmap.data[pixel + 1] = green;
      bitmap.data[pixel + 2] = blue;
      bitmap.data[pixel + 3] = 255;
    }
  }

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.putImageData(bitmap, Math.round(left * deviceScale), Math.round(top * deviceScale));
  context.restore();
  context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);

  context.strokeStyle = '#d9e3ec';
  context.lineWidth = 1;
  context.strokeRect(left, top, plotWidth, plotHeight);
  context.fillStyle = '#e8f1ff';
  context.font = '12px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'top';

  const tickCount = 4;
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const fraction = tick / tickCount;
    const x = left + fraction * plotWidth;
    context.beginPath();
    context.moveTo(x, top + plotHeight);
    context.lineTo(x, top + plotHeight + 5);
    context.stroke();
    context.fillText((fraction * data.durationSeconds).toFixed(2), x, top + plotHeight + 9);
  }
  context.fillText('Time [s]', left + plotWidth / 2, cssHeight - 20);

  const maximumFrequency = data.frequencies[data.binCount - 1] ?? 0;
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const fraction = tick / tickCount;
    const y = top + plotHeight - fraction * plotHeight;
    context.beginPath();
    context.moveTo(left - 5, y);
    context.lineTo(left, y);
    context.stroke();
    context.fillText(formatFrequency(fraction * maximumFrequency), left - 9, y);
  }

  context.save();
  context.translate(16, top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.textAlign = 'center';
  context.fillText('Frequency [Hz]', 0, 0);
  context.restore();

  const colorbarX = left + plotWidth + 24;
  const colorbarWidth = 16;
  const gradient = context.createLinearGradient(0, top + plotHeight, 0, top);
  for (let stop = 0; stop <= 8; stop += 1) {
    const fraction = stop / 8;
    const [red, green, blue] = jetColor(fraction);
    gradient.addColorStop(fraction, `rgb(${red} ${green} ${blue})`);
  }
  context.fillStyle = gradient;
  context.fillRect(colorbarX, top, colorbarWidth, plotHeight);
  context.strokeRect(colorbarX, top, colorbarWidth, plotHeight);
  context.fillStyle = '#e8f1ff';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillText('0 dB', colorbarX + colorbarWidth + 7, top);
  context.fillText(`${data.minimumDb} dB`, colorbarX + colorbarWidth + 7, top + plotHeight);
}
