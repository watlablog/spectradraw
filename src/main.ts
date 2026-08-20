import './style.css';

import { encodeFloat32Wav } from './audio/wav';
import { DEFAULT_SETTINGS } from './config';
import { decodeImageFile } from './image/decodeImage';
import { validateSettings } from './pipeline/generate';
import { renderSpectrogram, type SpectrogramRenderData } from './render/spectrogram';
import type {
  DecodedImage,
  GenerateRequest,
  GenerateResult,
  SpectraDrawSettings,
  WorkerResponse,
  WorkerStage,
} from './types';

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

const imageInput = requireElement<HTMLInputElement>('#image-input');
const dropZone = requireElement<HTMLLabelElement>('#drop-zone');
const dropPrompt = requireElement<HTMLSpanElement>('#drop-prompt');
const imagePreview = requireElement<HTMLCanvasElement>('#image-preview');
const imageMetadata = requireElement<HTMLParagraphElement>('#image-metadata');
const inputState = requireElement<HTMLSpanElement>('#input-state');
const settingsForm = requireElement<HTMLFormElement>('#settings-form');
const durationInput = requireElement<HTMLInputElement>('#duration-input');
const minimumFrequencyInput = requireElement<HTMLInputElement>('#min-frequency-input');
const maximumFrequencyInput = requireElement<HTMLInputElement>('#max-frequency-input');
const calculateButton = requireElement<HTMLButtonElement>('#calculate-button');
const resultState = requireElement<HTMLSpanElement>('#result-state');
const resultPlaceholder = requireElement<HTMLParagraphElement>('#result-placeholder');
const resultMetadata = requireElement<HTMLParagraphElement>('#result-metadata');
const spectrogramCanvas = requireElement<HTMLCanvasElement>('#spectrogram-canvas');
const audioPlayer = requireElement<HTMLAudioElement>('#audio-player');
const downloadWavButton = requireElement<HTMLButtonElement>('#download-wav-button');
const message = requireElement<HTMLParagraphElement>('#message');

const worker = new Worker(
  new URL('./workers/spectrogram.worker.ts', import.meta.url),
  { type: 'module' },
);

let decodedImage: DecodedImage | null = null;
let currentRequestId = 0;
let isBusy = false;
let audioUrl: string | null = null;
let lastWavBlob: Blob | null = null;
let lastRenderData: SpectrogramRenderData | null = null;
let resizeFrame: number | null = null;

function setPill(element: HTMLElement, text: string, kind?: 'busy' | 'success' | 'error'): void {
  element.textContent = text;
  if (kind === undefined) {
    delete element.dataset.kind;
  } else {
    element.dataset.kind = kind;
  }
}

function setMessage(text: string, kind?: 'success' | 'error'): void {
  message.textContent = text;
  if (kind === undefined) {
    delete message.dataset.kind;
  } else {
    message.dataset.kind = kind;
  }
}

function setBusy(busy: boolean): void {
  isBusy = busy;
  imageInput.disabled = busy;
  durationInput.disabled = busy;
  minimumFrequencyInput.disabled = busy;
  maximumFrequencyInput.disabled = busy;
  calculateButton.disabled = busy || decodedImage === null;
  dropZone.setAttribute('aria-disabled', String(busy));
}

function clearResult(): void {
  if (audioUrl !== null) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  lastWavBlob = null;
  lastRenderData = null;
  audioPlayer.pause();
  audioPlayer.removeAttribute('src');
  audioPlayer.load();
  downloadWavButton.disabled = true;
  spectrogramCanvas.hidden = true;
  resultPlaceholder.hidden = false;
  resultMetadata.textContent = '';
  setPill(resultState, 'Ready');
}

function renderImagePreview(image: DecodedImage): void {
  imagePreview.width = image.width;
  imagePreview.height = image.height;
  const context = imagePreview.getContext('2d');
  if (context === null) {
    throw new Error('The image preview canvas is unavailable.');
  }
  context.putImageData(image.imageData, 0, 0);
  imagePreview.hidden = false;
  dropPrompt.hidden = true;
}

function formatName(format: DecodedImage['format']): string {
  if (format === 'jpeg') {
    return 'JPEG';
  }
  return format.toUpperCase();
}

async function selectFile(file: File): Promise<void> {
  if (isBusy) {
    return;
  }

  currentRequestId += 1;
  decodedImage = null;
  calculateButton.disabled = true;
  clearResult();
  setPill(inputState, 'Decoding', 'busy');
  setMessage('Decoding the image locally...');

  try {
    const decoded = await decodeImageFile(file);
    decodedImage = decoded;
    renderImagePreview(decoded);
    imageMetadata.textContent = `${decoded.fileName} · ${formatName(decoded.format)} · ${decoded.width} × ${decoded.height} px`;
    setPill(inputState, 'Selected', 'success');
    setMessage('Image ready. Adjust the settings, then calculate.', 'success');
    calculateButton.disabled = false;
  } catch (error) {
    imagePreview.hidden = true;
    dropPrompt.hidden = false;
    imageMetadata.textContent = 'No valid image selected';
    setPill(inputState, 'Error', 'error');
    setMessage(error instanceof Error ? error.message : 'The image could not be opened.', 'error');
  }
}

function readSettings(): SpectraDrawSettings {
  const settings: SpectraDrawSettings = {
    ...DEFAULT_SETTINGS,
    durationSeconds: durationInput.valueAsNumber,
    minFrequencyHz: minimumFrequencyInput.valueAsNumber,
    maxFrequencyHz: maximumFrequencyInput.valueAsNumber,
  };
  validateSettings(settings);
  return settings;
}

function stageLabel(stage: WorkerStage, iteration?: number, totalIterations?: number): string {
  switch (stage) {
    case 'image-processing':
      return 'Processing image';
    case 'target-spectrum':
      return 'Building target spectrum';
    case 'griffin-lim':
      return `Griffin–Lim ${iteration ?? 0} / ${totalIterations ?? DEFAULT_SETTINGS.griffinLimIterations}`;
    case 'final-stft':
      return 'Analyzing final waveform';
  }
}

function presentResult(result: GenerateResult): void {
  const wav = encodeFloat32Wav(result.samples, result.sampleRate);
  lastWavBlob = wav;
  audioUrl = URL.createObjectURL(wav);
  audioPlayer.src = audioUrl;
  downloadWavButton.disabled = false;

  lastRenderData = {
    valuesDb: result.finalMagnitudeDb,
    frameCount: result.frameCount,
    binCount: result.binCount,
    times: result.times,
    frequencies: result.frequencies,
    durationSeconds: result.durationSeconds,
    minimumDb: DEFAULT_SETTINGS.minDisplayDb,
  };
  resultPlaceholder.hidden = true;
  spectrogramCanvas.hidden = false;
  renderSpectrogram(spectrogramCanvas, lastRenderData);
  resultMetadata.textContent = `${result.durationSeconds.toFixed(2)} s · ${result.sampleRate.toLocaleString()} Hz · mono · 32-bit float`;
}

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (decodedImage === null || isBusy) {
    return;
  }

  try {
    const settings = readSettings();
    clearResult();
    setBusy(true);
    setPill(resultState, 'Starting', 'busy');
    setMessage('Starting local signal processing...');
    currentRequestId += 1;
    const requestId = currentRequestId;
    const workerImage = new ImageData(
      new Uint8ClampedArray(decodedImage.imageData.data),
      decodedImage.width,
      decodedImage.height,
    );
    const request: GenerateRequest = {
      type: 'generate',
      requestId,
      image: workerImage,
      settings,
    };
    worker.postMessage(request, [workerImage.data.buffer]);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : 'The settings are invalid.', 'error');
  }
});

worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
  const response = event.data;
  if (response.requestId !== currentRequestId) {
    return;
  }

  if (response.type === 'progress') {
    const label = stageLabel(response.stage, response.iteration, response.totalIterations);
    setPill(resultState, label, 'busy');
    setMessage(`${label}...`);
    return;
  }

  setBusy(false);
  if (response.type === 'error') {
    setPill(resultState, 'Error', 'error');
    setMessage(response.message, 'error');
    return;
  }

  try {
    presentResult(response);
    setPill(resultState, 'Complete', 'success');
    setMessage('Sound and final spectrogram generated locally.', 'success');
  } catch (error) {
    setPill(resultState, 'Error', 'error');
    setMessage(error instanceof Error ? error.message : 'The result could not be displayed.', 'error');
  }
});

worker.addEventListener('error', () => {
  setBusy(false);
  setPill(resultState, 'Error', 'error');
  setMessage('The signal-processing worker stopped unexpectedly.', 'error');
});

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (file !== undefined) {
    void selectFile(file);
  }
});

for (const eventName of ['dragenter', 'dragover'] as const) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (!isBusy) {
      dropZone.dataset.dragging = 'true';
    }
  });
}
for (const eventName of ['dragleave', 'drop'] as const) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    delete dropZone.dataset.dragging;
  });
}
dropZone.addEventListener('drop', (event) => {
  if (isBusy) {
    return;
  }
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) {
    void selectFile(file);
  }
});
dropZone.addEventListener('keydown', (event) => {
  if (!isBusy && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    imageInput.click();
  }
});

downloadWavButton.addEventListener('click', () => {
  if (lastWavBlob === null) {
    return;
  }
  const url = URL.createObjectURL(lastWavBlob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'spectradraw.wav';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

window.addEventListener('resize', () => {
  if (lastRenderData === null || resizeFrame !== null) {
    return;
  }
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    if (lastRenderData !== null) {
      renderSpectrogram(spectrogramCanvas, lastRenderData);
    }
  });
});

window.addEventListener('beforeunload', () => {
  if (audioUrl !== null) {
    URL.revokeObjectURL(audioUrl);
  }
  worker.terminate();
});

clearResult();
