"""Band power via Welch's method, plus contact-quality estimation."""
from __future__ import annotations

import numpy as np
from scipy.signal import welch

from .. import config


def band_powers(window: np.ndarray, fs: float = config.EEG_SAMPLE_RATE) -> dict[str, float]:
    """Absolute power (uV^2) in each frequency band for a single-channel window.

    Uses Welch's method (averaged Hann-windowed periodograms) and trapezoidal
    integration across contiguous band edges so shared boundary bins split
    evenly and summed band powers match the total 1-44 Hz integrated PSD.
    """
    n = len(window)
    if n < 32:
        return {b: 0.0 for b in config.BANDS}
    # nperseg ~1 s gives ~1 Hz resolution and 3 overlapping averages per 2 s win.
    nperseg = min(n, int(fs))
    freqs, psd = welch(window, fs=fs, nperseg=nperseg, noverlap=nperseg // 2,
                       detrend="constant")
    out: dict[str, float] = {}
    for band, (lo, hi) in config.BANDS.items():
        mask = (freqs >= lo) & (freqs <= hi)
        if mask.sum() >= 2:
            out[band] = float(np.trapezoid(psd[mask], x=freqs[mask]))
        elif mask.any():
            out[band] = float(psd[mask].mean())
        else:
            out[band] = 0.0
    return out


def all_channel_band_powers(windows: np.ndarray) -> dict[str, dict[str, float]]:
    """Band power per channel. `windows` is shape (samples, 4)."""
    result: dict[str, dict[str, float]] = {}
    for ci, ch in enumerate(config.EEG_CHANNELS):
        result[ch] = band_powers(windows[:, ci])
    return result


def contact_quality(window: np.ndarray) -> tuple[str, float]:
    """Classify one channel's electrode contact as green/amber/red.

    Heuristic based on the signal's standard deviation (in uV):
      * near-flat  -> the electrode is not touching skin (dead channel)
      * moderate   -> good contact
      * huge       -> railing / motion / very poor contact
    Returns (label, stddev_uV).
    """
    sd = float(np.std(window))
    if sd < config.QUALITY_FLAT_MIN_UV:
        return "red", sd
    if sd <= config.QUALITY_GOOD_MAX_UV:
        return "green", sd
    if sd <= config.QUALITY_OK_MAX_UV:
        return "amber", sd
    return "red", sd
