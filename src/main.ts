import './style.css';

import { decodeAudioFile } from './audio/decodeAudio';
import { getPlaybackCursorFraction } from './audio/playbackCursor';
import { encodeFloat32Wav } from './audio/wav';
import {
  DEFAULT_SETTINGS,
  LONG_PROCESSING_THRESHOLD_SECONDS,
  MAX_SPECTROGRAM_COLUMNS,
  SPECTROGRAM_DATA_FLOOR_DB,
} from './config';
import { decodeImageFile } from './image/decodeImage';
import { calculateOutputSampleCount, validateSettings } from './pipeline/generate';
import { renderSpectrogram, type SpectrogramRenderData } from './render/spectrogram';
import { bindDualRange } from './ui/dualRange';
import type {
  DecodedAudio,
  DecodedImage,
  GenerateRequest,
  GenerateResult,
  InputMode,
  SpectraDrawSettings,
  WorkerResponse,
  WorkerStage,
} from './types';

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const imageInput = requireElement<HTMLInputElement>('#image-input');
const imageDropZone = requireElement<HTMLLabelElement>('#drop-zone');
const imageDropPrompt = requireElement<HTMLSpanElement>('#drop-prompt');
const imagePreview = requireElement<HTMLCanvasElement>('#image-preview');
const imageMetadata = requireElement<HTMLParagraphElement>('#image-metadata');
const clearImageButton = requireElement<HTMLButtonElement>('#clear-image-button');
const audioInput = requireElement<HTMLInputElement>('#audio-input');
const audioDropZone = requireElement<HTMLLabelElement>('#audio-drop-zone');
const audioMetadata = requireElement<HTMLParagraphElement>('#audio-metadata');
const clearAudioButton = requireElement<HTMLButtonElement>('#clear-audio-button');
const inputState = requireElement<HTMLSpanElement>('#input-state');
const settingsForm = requireElement<HTMLFormElement>('#settings-form');
const audioPlacementSettings = requireElement<HTMLFieldSetElement>('#audio-placement-settings');
const timeMappingSettings = requireElement<HTMLFieldSetElement>('#time-mapping-settings');
const frequencyMappingSettings = requireElement<HTMLFieldSetElement>('#frequency-mapping-settings');
const imageAmplitudeSettings = requireElement<HTMLFieldSetElement>('#image-amplitude-settings');
const compositeAmplitudeSettings = requireElement<HTMLFieldSetElement>('#composite-amplitude-settings');
const audioStartInput = requireElement<HTMLInputElement>('#audio-start-input');
const timeStartInput = requireElement<HTMLInputElement>('#time-start-input');
const timeEndInput = requireElement<HTMLInputElement>('#time-end-input');
const minimumFrequencyInput = requireElement<HTMLInputElement>('#min-frequency-input');
const maximumFrequencyInput = requireElement<HTMLInputElement>('#max-frequency-input');
const minimumAmplitudeInput = requireElement<HTMLInputElement>('#min-amplitude-input');
const maximumAmplitudeInput = requireElement<HTMLInputElement>('#max-amplitude-input');
const imageAttenuationInput = requireElement<HTMLInputElement>('#image-attenuation-input');
const calculateButton = requireElement<HTMLButtonElement>('#calculate-button');
const cancelButton = requireElement<HTMLButtonElement>('#cancel-button');
const longProcessingDialog = requireElement<HTMLDialogElement>('#long-processing-dialog');
const longProcessingMessage = requireElement<HTMLParagraphElement>('#long-processing-message');
const resultState = requireElement<HTMLSpanElement>('#result-state');
const resultFrame = requireElement<HTMLDivElement>('#result-frame');
const resultPlaceholder = requireElement<HTMLParagraphElement>('#result-placeholder');
const resultMetadata = requireElement<HTMLParagraphElement>('#result-metadata');
const spectrogramCanvas = requireElement<HTMLCanvasElement>('#spectrogram-canvas');
const audioPlayer = requireElement<HTMLAudioElement>('#audio-player');
const playbackCursor = requireElement<HTMLDivElement>('#playback-cursor');
const downloadWavButton = requireElement<HTMLButtonElement>('#download-wav-button');
const message = requireElement<HTMLParagraphElement>('#message');

let worker: Worker;
let decodedImage: DecodedImage | null = null;
let decodedAudio: DecodedAudio | null = null;
let currentRequestId = 0;
let currentViewRequestId = 0;
let inputSelectionId = 0;
let isBusy = false;
let audioUrl: string | null = null;
let lastWavBlob: Blob | null = null;
let lastResult: GenerateResult | null = null;
let lastRenderData: SpectrogramRenderData | null = null;
let resizeFrame: number | null = null;
let playbackFrame: number | null = null;
let viewAnalysisTimer: number | null = null;

const mappingInputs = [
  audioStartInput,
  timeStartInput,
  timeEndInput,
  minimumFrequencyInput,
  maximumFrequencyInput,
  minimumAmplitudeInput,
  maximumAmplitudeInput,
  imageAttenuationInput,
];

const timeViewRange = bindDualRange({
  minimumRange: requireElement<HTMLInputElement>('#time-start-range'),
  maximumRange: requireElement<HTMLInputElement>('#time-end-range'),
  selection: requireElement<HTMLElement>('#time-range-selection'),
}, {
  domainMinimum: 0,
  domainMaximum: DEFAULT_SETTINGS.timeEndSeconds,
  minimumGap: 0.05,
  onChange: handleTimeViewRangeChange,
});

const frequencyViewRange = bindDualRange({
  minimumRange: requireElement<HTMLInputElement>('#min-frequency-range'),
  maximumRange: requireElement<HTMLInputElement>('#max-frequency-range'),
  selection: requireElement<HTMLElement>('#frequency-range-selection'),
}, {
  domainMinimum: 0,
  domainMaximum: DEFAULT_SETTINGS.sampleRate / 2,
  minimumGap: 1,
  orientation: 'vertical',
  onChange: handleLocalViewRangeChange,
});

const amplitudeViewRange = bindDualRange({
  minimumRange: requireElement<HTMLInputElement>('#min-amplitude-range'),
  maximumRange: requireElement<HTMLInputElement>('#max-amplitude-range'),
  selection: requireElement<HTMLElement>('#amplitude-range-selection'),
}, {
  domainMinimum: SPECTROGRAM_DATA_FLOOR_DB,
  domainMaximum: 0,
  minimumGap: 1,
  orientation: 'vertical',
  onChange: handleLocalViewRangeChange,
});

function getInputMode(): InputMode | null {
  if (decodedImage !== null && decodedAudio !== null) return 'composite';
  if (decodedImage !== null) return 'image-only';
  if (decodedAudio !== null) return 'audio-only';
  return null;
}

function setPill(element: HTMLElement, text: string, kind?: 'busy' | 'success' | 'error'): void {
  element.textContent = text;
  if (kind === undefined) delete element.dataset.kind;
  else element.dataset.kind = kind;
}

function setMessage(text: string, kind?: 'success' | 'error'): void {
  message.textContent = text;
  if (kind === undefined) delete message.dataset.kind;
  else message.dataset.kind = kind;
}

function updateInputControls(): void {
  const mode = getInputMode();
  const hasImage = decodedImage !== null;
  const hasAudio = decodedAudio !== null;
  audioPlacementSettings.hidden = !hasAudio;
  audioPlacementSettings.disabled = isBusy || !hasAudio;
  timeMappingSettings.hidden = !hasImage;
  timeMappingSettings.disabled = isBusy || !hasImage;
  frequencyMappingSettings.hidden = !hasImage;
  frequencyMappingSettings.disabled = isBusy || !hasImage;
  imageAmplitudeSettings.hidden = mode === 'composite' || !hasImage;
  imageAmplitudeSettings.disabled = isBusy || mode !== 'image-only';
  compositeAmplitudeSettings.hidden = mode !== 'composite';
  compositeAmplitudeSettings.disabled = isBusy || mode !== 'composite';
  clearImageButton.hidden = !hasImage;
  clearImageButton.disabled = isBusy;
  clearAudioButton.hidden = !hasAudio;
  clearAudioButton.disabled = isBusy;
  calculateButton.disabled = isBusy || mode === null;

  if (mode === null) setPill(inputState, 'No input');
  else if (mode === 'image-only') setPill(inputState, 'Image', 'success');
  else if (mode === 'audio-only') setPill(inputState, 'Audio', 'success');
  else setPill(inputState, 'Image + audio', 'success');
}

function setBusy(busy: boolean): void {
  isBusy = busy;
  imageInput.disabled = busy;
  audioInput.disabled = busy;
  imageDropZone.setAttribute('aria-disabled', String(busy));
  audioDropZone.setAttribute('aria-disabled', String(busy));
  calculateButton.hidden = busy;
  cancelButton.hidden = !busy;
  updateInputControls();
  const disableRanges = busy || lastResult === null;
  timeViewRange.setDisabled(disableRanges);
  frequencyViewRange.setDisabled(disableRanges);
  amplitudeViewRange.setDisabled(disableRanges);
}

function clearViewTimer(): void {
  if (viewAnalysisTimer !== null) {
    window.clearTimeout(viewAnalysisTimer);
    viewAnalysisTimer = null;
  }
}

function clearResult(): void {
  clearViewTimer();
  currentViewRequestId += 1;
  stopPlaybackAnimation();
  playbackCursor.hidden = true;
  if (audioUrl !== null) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  lastWavBlob = null;
  lastResult = null;
  lastRenderData = null;
  timeViewRange.setDisabled(true);
  frequencyViewRange.setDisabled(true);
  amplitudeViewRange.setDisabled(true);
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
  if (context === null) throw new Error('The image preview canvas is unavailable.');
  context.putImageData(image.imageData, 0, 0);
  imagePreview.hidden = false;
  imageDropPrompt.hidden = true;
}

function imageFormatName(format: DecodedImage['format']): string {
  return format === 'jpeg' ? 'JPEG' : format.toUpperCase();
}

function updateFrequencyLimit(sampleRate: number): void {
  const nyquist = sampleRate / 2;
  minimumFrequencyInput.max = String(Math.max(0, nyquist - 1));
  maximumFrequencyInput.max = String(nyquist);
  if (maximumFrequencyInput.valueAsNumber > nyquist) maximumFrequencyInput.value = String(nyquist);
  if (minimumFrequencyInput.valueAsNumber >= maximumFrequencyInput.valueAsNumber) {
    minimumFrequencyInput.value = '0';
  }
}

async function selectImage(file: File): Promise<void> {
  if (isBusy) return;
  const selectionId = ++inputSelectionId;
  clearResult();
  setPill(inputState, 'Decoding', 'busy');
  setMessage('Decoding the image locally...');
  try {
    const decoded = await decodeImageFile(file);
    if (selectionId !== inputSelectionId) return;
    decodedImage = decoded;
    renderImagePreview(decoded);
    imageMetadata.textContent = `${decoded.fileName} · ${imageFormatName(decoded.format)} · ${decoded.width} × ${decoded.height} px`;
    setMessage('Image ready. Adjust the settings, then calculate.', 'success');
  } catch (error) {
    if (selectionId !== inputSelectionId) return;
    decodedImage = null;
    imagePreview.hidden = true;
    imageDropPrompt.hidden = false;
    imageMetadata.textContent = 'No valid image selected';
    setMessage(error instanceof Error ? error.message : 'The image could not be opened.', 'error');
  }
  updateInputControls();
}

async function selectAudio(file: File): Promise<void> {
  if (isBusy) return;
  const selectionId = ++inputSelectionId;
  clearResult();
  setPill(inputState, 'Decoding', 'busy');
  setMessage('Decoding the audio locally...');
  try {
    const decoded = await decodeAudioFile(file);
    if (selectionId !== inputSelectionId) return;
    decodedAudio = decoded;
    updateFrequencyLimit(decoded.sampleRate);
    const channels = decoded.channelCount === 1 ? 'mono' : `${decoded.channelCount} ch → mono`;
    audioMetadata.textContent = `${decoded.fileName} · ${decoded.format.toUpperCase()} · ${decoded.sampleRate.toLocaleString()} Hz · ${channels} · ${decoded.durationSeconds.toFixed(2)} s`;
    audioDropZone.dataset.selected = 'true';
    setMessage('Audio ready. Adjust its start position, then calculate.', 'success');
  } catch (error) {
    if (selectionId !== inputSelectionId) return;
    decodedAudio = null;
    delete audioDropZone.dataset.selected;
    audioMetadata.textContent = 'No valid audio selected';
    setMessage(error instanceof Error ? error.message : 'The audio could not be opened.', 'error');
  }
  updateInputControls();
}

function readSettings(): SpectraDrawSettings {
  const mode = getInputMode();
  if (mode === null) throw new Error('Choose an image, an audio file, or both.');
  const settings: SpectraDrawSettings = {
    ...DEFAULT_SETTINGS,
    sampleRate: decodedAudio?.sampleRate ?? DEFAULT_SETTINGS.sampleRate,
    audioStartSeconds: audioStartInput.valueAsNumber,
    imageAttenuationDb: imageAttenuationInput.valueAsNumber,
    timeStartSeconds: timeStartInput.valueAsNumber,
    timeEndSeconds: timeEndInput.valueAsNumber,
    minFrequencyHz: minimumFrequencyInput.valueAsNumber,
    maxFrequencyHz: maximumFrequencyInput.valueAsNumber,
    minAmplitudeDb: minimumAmplitudeInput.valueAsNumber,
    maxAmplitudeDb: maximumAmplitudeInput.valueAsNumber,
  };
  validateSettings(settings, mode);
  return settings;
}

function renderLatestResult(): void {
  if (lastResult === null) return;
  const time = timeViewRange.getValues();
  const frequency = frequencyViewRange.getValues();
  const amplitude = amplitudeViewRange.getValues();
  lastRenderData = {
    valuesDb: lastResult.finalMagnitudeDb,
    samples: lastResult.samples,
    sampleRate: lastResult.sampleRate,
    frameCount: lastResult.frameCount,
    binCount: lastResult.binCount,
    times: lastResult.times,
    frequencies: lastResult.frequencies,
    signalEndSeconds: lastResult.timeEndSeconds,
    minimumTimeSeconds: time.minimum,
    maximumTimeSeconds: time.maximum,
    minimumFrequencyHz: frequency.minimum,
    maximumFrequencyHz: frequency.maximum,
    minimumDb: amplitude.minimum,
    maximumDb: amplitude.maximum,
  };
  renderSpectrogram(spectrogramCanvas, lastRenderData);
}

function maximumDisplayColumns(): number {
  const scale = Math.min(2, window.devicePixelRatio || 1);
  return Math.max(128, Math.min(MAX_SPECTROGRAM_COLUMNS, Math.ceil(resultFrame.clientWidth * scale)));
}

function requestViewAnalysis(): void {
  if (lastResult === null || isBusy) return;
  currentViewRequestId += 1;
  const time = timeViewRange.getValues();
  worker.postMessage({
    type: 'analyze-view',
    requestId: lastResult.requestId,
    viewRequestId: currentViewRequestId,
    minimumTimeSeconds: time.minimum,
    maximumTimeSeconds: time.maximum,
    maximumDisplayColumns: maximumDisplayColumns(),
  });
}

function scheduleViewAnalysis(): void {
  clearViewTimer();
  viewAnalysisTimer = window.setTimeout(() => {
    viewAnalysisTimer = null;
    requestViewAnalysis();
  }, 100);
}

function updatePlaybackCursor(timeSeconds = audioPlayer.currentTime): void {
  if (lastResult === null) {
    playbackCursor.hidden = true;
    return;
  }
  const time = timeViewRange.getValues();
  const fraction = getPlaybackCursorFraction(Number.isFinite(timeSeconds) ? timeSeconds : 0, time.minimum, time.maximum);
  if (fraction === null) {
    playbackCursor.hidden = true;
    return;
  }
  const frameStyle = getComputedStyle(resultFrame);
  const plotLeft = Number.parseFloat(frameStyle.getPropertyValue('--plot-left'));
  const plotRight = Number.parseFloat(frameStyle.getPropertyValue('--plot-right'));
  if (!Number.isFinite(plotLeft) || !Number.isFinite(plotRight)) {
    playbackCursor.hidden = true;
    return;
  }
  const plotWidth = Math.max(1, resultFrame.clientWidth - plotLeft - plotRight);
  resultFrame.style.setProperty('--playback-cursor-left', `${plotLeft + fraction * plotWidth}px`);
  playbackCursor.hidden = false;
}

function stopPlaybackAnimation(): void {
  if (playbackFrame !== null) {
    cancelAnimationFrame(playbackFrame);
    playbackFrame = null;
  }
}

function startPlaybackAnimation(): void {
  stopPlaybackAnimation();
  const tick = (): void => {
    updatePlaybackCursor();
    if (!audioPlayer.paused && !audioPlayer.ended) playbackFrame = requestAnimationFrame(tick);
    else playbackFrame = null;
  };
  tick();
}

function handleTimeViewRangeChange(): void {
  if (lastResult === null || isBusy) return;
  renderLatestResult();
  updatePlaybackCursor();
  scheduleViewAnalysis();
  setMessage('Time view updated. Re-analyzing the visible final waveform...', 'success');
}

function handleLocalViewRangeChange(): void {
  if (lastResult === null || isBusy) return;
  renderLatestResult();
  updatePlaybackCursor();
  setMessage('View range updated. The generated audio and mapping are unchanged.', 'success');
}

function configureViewRanges(result: GenerateResult): void {
  timeViewRange.setBounds(0, result.timeEndSeconds);
  frequencyViewRange.setBounds(0, result.sampleRate / 2);
  amplitudeViewRange.setBounds(
    SPECTROGRAM_DATA_FLOOR_DB,
    DEFAULT_SETTINGS.maxAmplitudeDb,
    DEFAULT_SETTINGS.minAmplitudeDb,
    DEFAULT_SETTINGS.maxAmplitudeDb,
  );
  timeViewRange.setDisabled(false);
  frequencyViewRange.setDisabled(false);
  amplitudeViewRange.setDisabled(false);
}

function stageLabel(
  stage: WorkerStage,
  iteration?: number,
  totalIterations?: number,
  chunkIndex?: number,
  chunkCount?: number,
): string {
  const chunk = chunkCount === undefined ? '' : ` · chunk ${chunkIndex ?? 0}/${chunkCount}`;
  switch (stage) {
    case 'audio-preparation': return 'Preparing timeline';
    case 'source-analysis': return `Analyzing source${chunk}`;
    case 'image-processing': return 'Processing image';
    case 'target-spectrum': return `Building target${chunk}`;
    case 'griffin-lim': return `Griffin–Lim ${iteration ?? 0}/${totalIterations ?? DEFAULT_SETTINGS.griffinLimIterations}${chunk}`;
    case 'final-stft': return 'Analyzing final waveform';
  }
}

function presentResult(result: GenerateResult): void {
  const wav = encodeFloat32Wav(result.samples, result.sampleRate);
  lastWavBlob = wav;
  audioUrl = URL.createObjectURL(wav);
  audioPlayer.src = audioUrl;
  downloadWavButton.disabled = false;
  lastResult = result;
  configureViewRanges(result);
  resultPlaceholder.hidden = true;
  spectrogramCanvas.hidden = false;
  renderLatestResult();
  updatePlaybackCursor(0);
  if (result.mode === 'image-only') {
    resultMetadata.textContent = `Image · ${result.timeStartSeconds.toFixed(2)}–${result.timeEndSeconds.toFixed(2)} s · ${result.minFrequencyHz.toLocaleString()}–${result.maxFrequencyHz.toLocaleString()} Hz · ${result.minAmplitudeDb}–${result.maxAmplitudeDb} dBFS · ${result.sampleRate.toLocaleString()} Hz WAV`;
  } else if (result.mode === 'audio-only') {
    resultMetadata.textContent = `Audio · starts at ${result.timeStartSeconds.toFixed(2)} s · ${result.timeEndSeconds.toFixed(2)} s · ${result.sampleRate.toLocaleString()} Hz WAV`;
  } else {
    resultMetadata.textContent = `Audio + image · image ${result.timeStartSeconds.toFixed(2)}–${Math.min(result.timeEndSeconds, timeEndInput.valueAsNumber).toFixed(2)} s · ${result.minFrequencyHz.toLocaleString()}–${result.maxFrequencyHz.toLocaleString()} Hz · ${Math.abs(result.minAmplitudeDb)} dB attenuation · ${result.timeEndSeconds.toFixed(2)} s WAV`;
  }
}

function createWorker(): Worker {
  const nextWorker = new Worker(new URL('./workers/spectrogram.worker.ts', import.meta.url), { type: 'module' });
  nextWorker.addEventListener('message', handleWorkerMessage);
  nextWorker.addEventListener('error', () => {
    if (!isBusy) return;
    setBusy(false);
    setPill(resultState, 'Error', 'error');
    setMessage('The signal-processing worker stopped unexpectedly.', 'error');
  });
  return nextWorker;
}

function handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
  const response = event.data;
  if (response.requestId !== currentRequestId) return;
  if (response.type === 'progress') {
    const label = stageLabel(
      response.stage,
      response.iteration,
      response.totalIterations,
      response.chunkIndex,
      response.chunkCount,
    );
    setPill(resultState, label, 'busy');
    setMessage(`${label}...`);
    return;
  }
  if (response.type === 'view-result') {
    if (lastResult === null || response.viewRequestId !== currentViewRequestId) return;
    lastResult.finalMagnitudeDb = response.finalMagnitudeDb;
    lastResult.frameCount = response.frameCount;
    lastResult.binCount = response.binCount;
    lastResult.times = response.times;
    lastResult.frequencies = response.frequencies;
    renderLatestResult();
    updatePlaybackCursor();
    setMessage('Visible range analyzed from the final waveform.', 'success');
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
}

function confirmLongCalculation(durationSeconds: number): Promise<boolean> {
  longProcessingMessage.textContent = `The ${durationSeconds.toFixed(2)} second output will use chunked processing and may take significant time and memory. Continue?`;
  longProcessingDialog.returnValue = 'cancel';
  return new Promise((resolve) => {
    const form = longProcessingDialog.querySelector<HTMLFormElement>('form');
    if (form === null) {
      resolve(false);
      return;
    }
    const finish = (shouldContinue: boolean): void => {
      form.removeEventListener('submit', handleSubmit);
      longProcessingDialog.removeEventListener('cancel', handleCancel);
      longProcessingDialog.close(shouldContinue ? 'continue' : 'cancel');
      resolve(shouldContinue);
    };
    const handleSubmit = (event: SubmitEvent): void => {
      event.preventDefault();
      const value = event.submitter instanceof HTMLButtonElement
        ? event.submitter.value
        : 'cancel';
      finish(value === 'continue');
    };
    const handleCancel = (event: Event): void => {
      event.preventDefault();
      finish(false);
    };
    form.addEventListener('submit', handleSubmit);
    longProcessingDialog.addEventListener('cancel', handleCancel);
    longProcessingDialog.showModal();
  });
}

async function startCalculation(): Promise<void> {
  const mode = getInputMode();
  if (mode === null || isBusy) return;
  try {
    const settings = readSettings();
    const pipelineInput = {
      ...(decodedImage === null ? {} : { image: decodedImage.imageData }),
      ...(decodedAudio === null ? {} : { audio: { sampleRate: decodedAudio.sampleRate, samples: decodedAudio.samples } }),
    };
    const sampleCount = calculateOutputSampleCount(pipelineInput, settings);
    const duration = sampleCount / settings.sampleRate;
    if (duration >= LONG_PROCESSING_THRESHOLD_SECONDS && !(await confirmLongCalculation(duration))) {
      setMessage('Calculation canceled before processing. Inputs are unchanged.');
      return;
    }

    clearResult();
    setBusy(true);
    setPill(resultState, 'Starting', 'busy');
    setMessage('Starting local signal processing...');
    currentRequestId += 1;
    const requestId = currentRequestId;
    const workerImage = decodedImage === null ? undefined : new ImageData(
      new Uint8ClampedArray(decodedImage.imageData.data),
      decodedImage.width,
      decodedImage.height,
    );
    const workerAudio = decodedAudio === null ? undefined : {
      sampleRate: decodedAudio.sampleRate,
      samples: new Float32Array(decodedAudio.samples),
    };
    const request: GenerateRequest = {
      type: 'generate',
      requestId,
      settings,
      maximumDisplayColumns: maximumDisplayColumns(),
      ...(workerImage === undefined ? {} : { image: workerImage }),
      ...(workerAudio === undefined ? {} : { audio: workerAudio }),
    };
    const transfers: Transferable[] = [];
    if (workerImage !== undefined) transfers.push(workerImage.data.buffer);
    if (workerAudio !== undefined) transfers.push(workerAudio.samples.buffer);
    worker.postMessage(request, transfers);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : 'The settings are invalid.', 'error');
  }
}

function cancelCalculation(): void {
  if (!isBusy) return;
  currentRequestId += 1;
  worker.terminate();
  worker = createWorker();
  clearResult();
  setBusy(false);
  setPill(resultState, 'Canceled');
  setMessage('Calculation canceled. Inputs and settings are unchanged.');
}

function bindDropZone(
  zone: HTMLLabelElement,
  input: HTMLInputElement,
  select: (file: File) => Promise<void>,
): void {
  for (const eventName of ['dragenter', 'dragover'] as const) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!isBusy) zone.dataset.dragging = 'true';
    });
  }
  for (const eventName of ['dragleave', 'drop'] as const) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      delete zone.dataset.dragging;
    });
  }
  zone.addEventListener('drop', (event) => {
    if (isBusy) return;
    const file = event.dataTransfer?.files[0];
    if (file !== undefined) void select(file);
  });
  zone.addEventListener('keydown', (event) => {
    if (!isBusy && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file !== undefined) void select(file);
  });
}

settingsForm.addEventListener('submit', (event) => event.preventDefault());
for (const input of mappingInputs) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
}
calculateButton.addEventListener('click', () => void startCalculation());
cancelButton.addEventListener('click', cancelCalculation);

clearImageButton.addEventListener('click', () => {
  if (isBusy) return;
  inputSelectionId += 1;
  decodedImage = null;
  imageInput.value = '';
  imagePreview.hidden = true;
  imageDropPrompt.hidden = false;
  imageMetadata.textContent = 'No image selected';
  clearResult();
  updateInputControls();
  setMessage(decodedAudio === null ? 'Choose an image, an audio file, or both.' : 'Audio input remains selected.');
});

clearAudioButton.addEventListener('click', () => {
  if (isBusy) return;
  inputSelectionId += 1;
  decodedAudio = null;
  audioInput.value = '';
  delete audioDropZone.dataset.selected;
  audioMetadata.textContent = 'No audio selected';
  updateFrequencyLimit(DEFAULT_SETTINGS.sampleRate);
  clearResult();
  updateInputControls();
  setMessage(decodedImage === null ? 'Choose an image, an audio file, or both.' : 'Image input remains selected.');
});

bindDropZone(imageDropZone, imageInput, selectImage);
bindDropZone(audioDropZone, audioInput, selectAudio);

audioPlayer.addEventListener('play', startPlaybackAnimation);
audioPlayer.addEventListener('pause', () => {
  stopPlaybackAnimation();
  updatePlaybackCursor();
});
for (const eventName of ['timeupdate', 'seeking', 'seeked', 'loadedmetadata'] as const) {
  audioPlayer.addEventListener(eventName, () => updatePlaybackCursor());
}
audioPlayer.addEventListener('ended', () => {
  stopPlaybackAnimation();
  audioPlayer.currentTime = 0;
  updatePlaybackCursor(0);
});

downloadWavButton.addEventListener('click', () => {
  if (lastWavBlob === null) return;
  const url = URL.createObjectURL(lastWavBlob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'spectradraw.wav';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

window.addEventListener('resize', () => {
  if (lastRenderData === null || resizeFrame !== null) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    if (lastRenderData !== null) {
      renderLatestResult();
      updatePlaybackCursor();
      scheduleViewAnalysis();
    }
  });
});

window.addEventListener('beforeunload', () => {
  clearViewTimer();
  stopPlaybackAnimation();
  if (audioUrl !== null) URL.revokeObjectURL(audioUrl);
  worker.terminate();
});

worker = createWorker();
clearResult();
updateInputControls();
