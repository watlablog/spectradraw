"""Generate compact SciPy/OpenCV/Pillow reference values for SpectraDraw tests."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import PIL
import scipy
from PIL import Image
from scipy import signal


OUTPUT = Path(__file__).with_name("python_reference.json")
SAMPLE_RATE = 48_000
FRAME_SIZE = 2_048
HOP_SIZE = 205


def short_time_fft() -> signal.ShortTimeFFT:
    return signal.ShortTimeFFT.from_window(
        "hann",
        SAMPLE_RATE,
        nperseg=FRAME_SIZE,
        noverlap=FRAME_SIZE - HOP_SIZE,
        symmetric_win=False,
        fft_mode="onesided2X",
        mfft=FRAME_SIZE,
        scale_to="magnitude",
    )


def main() -> None:
    sample_count = round(SAMPLE_RATE * 2.25)
    stft = short_time_fft()
    impulse = np.zeros(sample_count, dtype=np.float64)
    impulse[0] = 1.0
    impulse_stft = stft.stft(impulse)

    pixels = np.array(
        [
            [[0, 0, 0], [255, 255, 255]],
            [[255, 0, 0], [0, 255, 0]],
        ],
        dtype=np.uint8,
    )
    grayscale = cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(grayscale, (5, 5), 0)
    resized = np.asarray(
        Image.fromarray(np.array([[1.0, 2.0], [3.0, 4.0]], dtype=np.float32)).resize(
            (3, 3), Image.Resampling.BILINEAR
        ),
        dtype=np.float64,
    )
    reduced = np.asarray(
        Image.fromarray(np.arange(1, 17, dtype=np.float32).reshape(4, 4)).resize(
            (2, 2), Image.Resampling.BILINEAR
        ),
        dtype=np.float64,
    )

    fixture = {
        "versions": {
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "opencv": cv2.__version__,
            "pillow": PIL.__version__,
        },
        "default_layout": {
            "sample_count": sample_count,
            "frame_count": int(stft.t(sample_count).size),
            "bin_count": int(stft.f.size),
            "first_time": float(stft.t(sample_count)[0]),
            "last_time": float(stft.t(sample_count)[-1]),
        },
        "periodic_hann_first_8": stft.win[:8].tolist(),
        "impulse_stft_first_frame_real": impulse_stft[:8, 0].real.tolist(),
        "impulse_stft_first_frame_imag": impulse_stft[:8, 0].imag.tolist(),
        "grayscale_2x2": grayscale.tolist(),
        "gaussian_2x2": blurred.tolist(),
        "bilinear_2x2_to_3x3": resized.tolist(),
        "bilinear_4x4_to_2x2": reduced.tolist(),
    }
    OUTPUT.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
