# SpectraDraw

SpectraDraw is a static browser application that turns an image into sound in
the time-frequency domain. Images and generated audio stay in the browser; no
backend, account, upload, or external processing API is used.

## Features

- PNG, JPEG, and WebP input with file-signature validation
- Configurable duration and minimum/maximum frequency
- Deterministic Griffin–Lim phase estimation in a Web Worker
- Playback and 32-bit float mono WAV download
- A final spectrogram calculated from the generated Float32 waveform

## Signal path

```text
Image
  -> processed target magnitude
  -> random phase + Griffin–Lim
  -> ISTFT waveform
  -> -1 dBFS peak normalization
  -> canonical Float32 samples
       |-> 32-bit float WAV
       `-> final STFT -> displayed spectrogram
```

The displayed result is deliberately not the target image matrix. It shows the
spectrum found by re-analyzing the samples that are used for playback and WAV
export.

## Development

```sh
npm install
npm run dev
```

Quality checks:

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

Upload the contents of `dist/` to any static host. Vite uses a relative base
path, so the output also works below a subdirectory.

## Numerical reference

The STFT follows the important conventions of SciPy `ShortTimeFFT` used by the
PyCon JP reference: a magnitude-scaled periodic Hann window, centered boundary
frames, `onesided2X` scaling, and canonical-dual-window ISTFT.

Development-only Python fixture tooling is documented in
`tests/reference/README.md`. Python is not needed to install, build, deploy, or
use SpectraDraw.
