import { jetColor } from './colormap';
import { createWaveformEnvelope, dbfsToLinear } from './waveform';

export interface SpectrogramRenderData {
  valuesDb: Float32Array;
  samples: Float32Array;
  sampleRate: number;
  frameCount: number;
  binCount: number;
  times: Float64Array;
  frequencies: Float64Array;
  signalEndSeconds: number;
  minimumTimeSeconds: number;
  maximumTimeSeconds: number;
  minimumFrequencyHz: number;
  maximumFrequencyHz: number;
  minimumDb: number;
  maximumDb: number;
}

function formatFrequency(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k` : `${Math.round(value)}`;
}

function renderWaveform(
  context: CanvasRenderingContext2D,
  data: SpectrogramRenderData,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  const columnCount = Math.max(1, Math.round(width));
  const envelope = createWaveformEnvelope(
    data.samples,
    data.sampleRate,
    data.minimumTimeSeconds,
    data.maximumTimeSeconds,
    columnCount,
  );
  const maximumAmplitude = dbfsToLinear(data.maximumDb);
  const center = top + height / 2;
  const halfHeight = Math.max(1, height / 2 - 5);

  context.save();
  context.fillStyle = '#07131f';
  context.fillRect(left, top, width, height);
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();

  context.strokeStyle = 'rgba(166, 189, 220, 0.28)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, center);
  context.lineTo(left + width, center);
  context.stroke();

  context.strokeStyle = '#75a9ff';
  context.beginPath();
  for (let column = 0; column < columnCount; column += 1) {
    const x = left + ((column + 0.5) / columnCount) * width;
    const maximum = envelope.maxima[column] ?? 0;
    const minimum = envelope.minima[column] ?? 0;
    const maximumY = center - (maximum / maximumAmplitude) * halfHeight;
    const minimumY = center - (minimum / maximumAmplitude) * halfHeight;
    context.moveTo(x, maximumY);
    context.lineTo(x, minimumY);
  }
  context.stroke();
  context.restore();

  context.strokeStyle = 'rgba(217, 227, 236, 0.55)';
  context.strokeRect(left, top, width, height);
}

export function renderSpectrogram(
  canvas: HTMLCanvasElement,
  data: SpectrogramRenderData,
): void {
  if (
    data.valuesDb.length !== data.frameCount * data.binCount
    || data.samples.length < 1
    || !Number.isFinite(data.sampleRate)
    || data.sampleRate <= 0
    || data.times.length !== data.frameCount
    || data.frequencies.length !== data.binCount
  ) {
    throw new Error('Spectrogram render dimensions are invalid.');
  }
  if (
    data.minimumTimeSeconds >= data.maximumTimeSeconds
    || data.minimumFrequencyHz >= data.maximumFrequencyHz
    || data.minimumDb >= data.maximumDb
  ) {
    throw new Error('Spectrogram render ranges are invalid.');
  }

  const parentWidth = canvas.parentElement?.clientWidth ?? 800;
  const parentHeight = canvas.parentElement?.clientHeight ?? Math.min(620, parentWidth * 0.64);
  const cssWidth = Math.max(300, parentWidth);
  const cssHeight = Math.max(330, parentHeight);
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

  const left = cssWidth < 520 ? 82 : 104;
  const waveformTop = 18;
  const waveformHeight = Math.max(54, Math.min(82, cssHeight * 0.17));
  const waveformGap = 12;
  const top = waveformTop + waveformHeight + waveformGap;
  const right = cssWidth < 520 ? 110 : 132;
  const bottom = 94;
  canvas.parentElement?.style.setProperty('--plot-left', `${left}px`);
  canvas.parentElement?.style.setProperty('--plot-top', `${top}px`);
  canvas.parentElement?.style.setProperty('--plot-right', `${right}px`);
  canvas.parentElement?.style.setProperty('--plot-bottom', `${bottom}px`);
  canvas.parentElement?.style.setProperty('--waveform-top', `${waveformTop}px`);
  canvas.parentElement?.style.setProperty('--waveform-height', `${waveformHeight}px`);
  const plotWidth = Math.max(1, cssWidth - left - right);
  const plotHeight = Math.max(1, cssHeight - top - bottom);
  const bitmapWidth = Math.max(1, Math.round(plotWidth * deviceScale));
  const bitmapHeight = Math.max(1, Math.round(plotHeight * deviceScale));
  const bitmap = new ImageData(bitmapWidth, bitmapHeight);
  const firstTime = data.times[0] ?? 0;
  const lastTime = data.times[data.frameCount - 1] ?? firstTime;

  for (let y = 0; y < bitmapHeight; y += 1) {
    const frequencyFraction = 1 - y / Math.max(1, bitmapHeight - 1);
    const frequency = data.minimumFrequencyHz
      + frequencyFraction * (data.maximumFrequencyHz - data.minimumFrequencyHz);
    const maximumDataFrequency = data.frequencies[data.binCount - 1] ?? 0;
    const bin = Math.max(0, Math.min(
      data.binCount - 1,
      Math.round((frequency / Math.max(maximumDataFrequency, Number.EPSILON)) * (data.binCount - 1)),
    ));
    for (let x = 0; x < bitmapWidth; x += 1) {
      const timeFraction = x / Math.max(1, bitmapWidth - 1);
      const time = data.minimumTimeSeconds
        + timeFraction * (data.maximumTimeSeconds - data.minimumTimeSeconds);
      const frameFraction = lastTime === firstTime ? 0 : (time - firstTime) / (lastTime - firstTime);
      const frame = Math.max(0, Math.min(data.frameCount - 1, Math.round(frameFraction * (data.frameCount - 1))));
      const db = time >= 0 && time <= data.signalEndSeconds
        ? (data.valuesDb[bin * data.frameCount + frame] ?? data.minimumDb)
        : data.minimumDb;
      const normalized = Math.max(0, Math.min(
        1,
        (db - data.minimumDb) / (data.maximumDb - data.minimumDb),
      ));
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

  renderWaveform(
    context,
    data,
    left,
    waveformTop,
    plotWidth,
    waveformHeight,
  );

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
    const time = data.minimumTimeSeconds
      + fraction * (data.maximumTimeSeconds - data.minimumTimeSeconds);
    context.fillText(time.toFixed(2), x, top + plotHeight + 9);
  }
  context.fillText('Time [s]', left + plotWidth / 2, cssHeight - 56);

  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const fraction = tick / tickCount;
    const y = top + plotHeight - fraction * plotHeight;
    context.beginPath();
    context.moveTo(left - 5, y);
    context.lineTo(left, y);
    context.stroke();
    const frequency = data.minimumFrequencyHz
      + fraction * (data.maximumFrequencyHz - data.minimumFrequencyHz);
    context.fillText(formatFrequency(frequency), left - 9, y);
  }

  context.save();
  context.translate(left - 55, top + plotHeight / 2);
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
  context.fillText(`${data.maximumDb} dBFS`, colorbarX + colorbarWidth + 7, top);
  context.fillText(`${data.minimumDb} dBFS`, colorbarX + colorbarWidth + 7, top + plotHeight);
}
