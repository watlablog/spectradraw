/// <reference lib="webworker" />

import type { GenerateRequest, GenerateResult } from '../types';
import { generateFromImage } from '../pipeline/generate';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const request = event.data;
  if (request.type !== 'generate') {
    return;
  }

  try {
    const pipelineResult = generateFromImage(request.image, request.settings, (progress) => {
      workerScope.postMessage({
        type: 'progress',
        requestId: request.requestId,
        ...progress,
      });
    });

    const result: GenerateResult = {
      type: 'result',
      requestId: request.requestId,
      ...pipelineResult,
    };
    workerScope.postMessage(result, [
      result.samples.buffer,
      result.finalMagnitudeDb.buffer,
      result.times.buffer,
      result.frequencies.buffer,
    ]);
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Generation failed unexpectedly.',
    });
  }
};
