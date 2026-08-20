/// <reference lib="webworker" />

import { generate } from '../pipeline/generate';
import { analyzeSpectrogramView } from '../pipeline/spectrogramTile';
import type {
  GenerateRequest,
  GenerateResult,
  StftConfig,
  ViewResult,
  WorkerRequest,
} from '../types';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

interface AnalysisState {
  requestId: number;
  samples: Float32Array;
  stftConfig: StftConfig;
  referenceMagnitude: number;
}

let analysisState: AnalysisState | null = null;

function postError(requestId: number, error: unknown): void {
  workerScope.postMessage({
    type: 'error',
    requestId,
    message: error instanceof Error ? error.message : 'Generation failed unexpectedly.',
  });
}

function handleGenerate(request: GenerateRequest): void {
  const pipelineResult = generate(
    {
      ...(request.image === undefined ? {} : { image: request.image }),
      ...(request.audio === undefined ? {} : { audio: request.audio }),
    },
    request.settings,
    request.maximumDisplayColumns,
    (progress) => {
      workerScope.postMessage({
        type: 'progress',
        requestId: request.requestId,
        ...progress,
      });
    },
  );

  analysisState = {
    requestId: request.requestId,
    samples: pipelineResult.samples,
    stftConfig: pipelineResult.stftConfig,
    referenceMagnitude: pipelineResult.displayReferenceMagnitude,
  };
  const resultSamples = pipelineResult.samples.slice();
  const result: GenerateResult = {
    type: 'result',
    requestId: request.requestId,
    mode: pipelineResult.mode,
    sampleRate: pipelineResult.sampleRate,
    samples: resultSamples,
    finalMagnitudeDb: pipelineResult.finalMagnitudeDb,
    frameCount: pipelineResult.frameCount,
    binCount: pipelineResult.binCount,
    times: pipelineResult.times,
    frequencies: pipelineResult.frequencies,
    timeStartSeconds: pipelineResult.timeStartSeconds,
    timeEndSeconds: pipelineResult.timeEndSeconds,
    minFrequencyHz: pipelineResult.minFrequencyHz,
    maxFrequencyHz: pipelineResult.maxFrequencyHz,
    minAmplitudeDb: pipelineResult.minAmplitudeDb,
    maxAmplitudeDb: pipelineResult.maxAmplitudeDb,
  };
  workerScope.postMessage(result, [
    result.samples.buffer,
    result.finalMagnitudeDb.buffer,
    result.times.buffer,
    result.frequencies.buffer,
  ]);
}

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'generate') {
      handleGenerate(request);
      return;
    }
    if (analysisState === null || analysisState.requestId !== request.requestId) {
      return;
    }
    const tile = analyzeSpectrogramView(
      analysisState.samples,
      analysisState.stftConfig,
      request.minimumTimeSeconds,
      request.maximumTimeSeconds,
      request.maximumDisplayColumns,
      analysisState.referenceMagnitude,
    );
    const response: ViewResult = {
      type: 'view-result',
      requestId: request.requestId,
      viewRequestId: request.viewRequestId,
      finalMagnitudeDb: tile.valuesDb,
      frameCount: tile.frameCount,
      binCount: tile.binCount,
      times: tile.times,
      frequencies: tile.frequencies,
    };
    workerScope.postMessage(response, [
      response.finalMagnitudeDb.buffer,
      response.times.buffer,
      response.frequencies.buffer,
    ]);
  } catch (error) {
    postError(request.requestId, error);
  }
};
