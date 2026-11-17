"""Heart rate and a basic HRV estimate from the PPG (optical) signal."""
from __future__ import annotations

import numpy as np
from scipy.signal import find_peaks

from .. import config
from .filters import bandpass


def heart_metrics(ppg_window: np.ndarray, fs: float = config.PPG_SAMPLE_RATE) -> dict:
    """Estimate heart rate (bpm) and HRV (ms) from a PPG window.

    Applies a 0.5-4.0 Hz bandpass filter (30-240 bpm) to remove respiratory
    baseline wander and high-frequency noise before systolic peak detection.
    HRV is reported as RMSSD across consecutive valid inter-beat intervals.
    """
    empty = {"hr": 0.0, "hrv": 0.0, "n_beats": 0}
    if ppg_window.size < int(fs * 2):
        return empty

    # Zero-phase bandpass removes slow respiratory drift that otherwise shifts
    # the dicrotic notch across the amplitude threshold.
    x = bandpass(np.asarray(ppg_window, dtype=float), 0.5, 4.0, fs=fs, order=3)
    sd = float(np.std(x))
    if sd <= 1e-9:
        return empty

    min_dist = max(1, int(fs * 60.0 / config.HR_MAX_BPM))
    peaks, _ = find_peaks(x, distance=min_dist, height=0.25 * sd, prominence=0.45 * sd)
    if len(peaks) < 3:
        return empty

    ibi = np.diff(peaks) / fs  # inter-beat intervals in seconds
    min_ibi = 60.0 / config.HR_MAX_BPM
    max_ibi = 60.0 / config.HR_MIN_BPM
    valid = (ibi >= min_ibi) & (ibi <= max_ibi)
    valid_ibi = ibi[valid]
    if len(valid_ibi) < 2:
        return empty

    hr = 60.0 / float(np.mean(valid_ibi))
    # Only difference adjacent valid intervals (never bridge across a rejected beat).
    pair_valid = valid[:-1] & valid[1:]
    diffs = np.diff(ibi)[pair_valid]
    if len(diffs) < 1:
        return empty

    rmssd_ms = float(np.sqrt(np.mean(diffs ** 2)) * 1000.0)
    return {"hr": hr, "hrv": rmssd_ms, "n_beats": int(len(peaks))}
