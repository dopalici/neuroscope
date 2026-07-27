"""Heart rate and a basic HRV estimate from the PPG (optical) signal."""
from __future__ import annotations

import numpy as np
from scipy.signal import find_peaks

from .. import config


def heart_metrics(ppg_window: np.ndarray, fs: float = config.PPG_SAMPLE_RATE) -> dict:
    """Estimate heart rate (bpm) and HRV (ms) from a PPG window.

    HRV here is RMSSD: the root-mean-square of successive differences between
    heartbeats, the standard short-window HRV metric. Both need several seconds
    of PPG to be meaningful, so we return NaN-ish zeros until enough beats are
    seen and let the frontend show "--".
    """
    empty = {"hr": 0.0, "hrv": 0.0, "n_beats": 0}
    if ppg_window.size < int(fs * 2):
        return empty

    x = ppg_window - np.mean(ppg_window)
    # A beat is roughly >= 0.33 s apart (<=180 bpm). Height gate rejects noise.
    min_dist = int(fs * 60.0 / config.HR_MAX_BPM)
    height = 0.4 * np.std(x)
    peaks, _ = find_peaks(x, distance=max(1, min_dist), height=height)
    if len(peaks) < 3:
        return empty

    ibi = np.diff(peaks) / fs  # inter-beat intervals in seconds
    # Keep only physiologically plausible intervals.
    ibi = ibi[(ibi >= 60.0 / config.HR_MAX_BPM) & (ibi <= 60.0 / config.HR_MIN_BPM)]
    if len(ibi) < 2:
        return empty

    hr = 60.0 / float(np.mean(ibi))
    rmssd_ms = float(np.sqrt(np.mean(np.diff(ibi) ** 2)) * 1000.0)
    return {"hr": hr, "hrv": rmssd_ms, "n_beats": int(len(peaks))}
