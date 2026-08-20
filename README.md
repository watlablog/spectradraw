# SpectraDraw

SpectraDraw is a static browser application that turns an image into sound in
the time-frequency domain. Images and generated audio stay in the browser; no
backend, account, upload, or external processing API is used.

## Features

- PNG, JPEG, and WebP input with file-signature validation
- Start/end placement controls for the image on the time axis
- Calculate-time image mapping inputs for time, frequency, and amplitude
- Independent dual-handle view sliders around the spectrogram axes
- Deterministic Griffin–Lim phase estimation in a Web Worker
- Playback and 32-bit float mono WAV download
- A final spectrogram calculated from the generated Float32 waveform
- A time waveform above the spectrogram with the same visible time range
- A synchronized yellow playback cursor across both plots

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

The generated WAV begins at 0 seconds and ends at the selected time endpoint.
The image is mapped only between the selected start and end positions, leaving
the preceding interval silent. Frequency and amplitude mapping values affect
the next calculation only. The sliders around the completed spectrogram crop
its time, frequency, and dB views without changing the generated audio or its
image mapping.

Amplitude mapping defaults to -20 through 0 dBFS and can be extended down to
-80 dBFS. Editing a mapping field never starts processing; generation begins
only from an explicit activation of the Calculate button.

The waveform and spectrogram share the time view slider and exactly the same
horizontal plot bounds. The waveform uses a symmetric linear vertical limit
derived from the amplitude view maximum with `10^(dBFS / 20)`.

During playback and seeking, matching yellow cursors mark the current time in
the waveform and spectrogram. Pausing leaves the cursor at that position;
natural playback completion resets both the player and cursor to 0 seconds.

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
