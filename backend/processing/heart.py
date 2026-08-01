"""Heart rate and a basic HRV estimate from the PPG (optical) signal."""
from __future__ import annotations

import time

import numpy as np
from scipy.signal import find_peaks

from .. import config


def heart_metrics(ppg_window: np.ndarray, fs: float = config.PPG_SAMPLE_RATE,
                  now: float | None = None) -> dict:
    """Estimate heart rate (bpm) and HRV (ms) from a PPG window.

    HRV here is RMSSD: the root-mean-square of successive differences between
    heartbeats, the standard short-window HRV metric. Both need several seconds
    of PPG to be meaningful, so we return NaN-ish zeros until enough beats are
    seen and let the frontend show "--".

    `beats` carries the wall-clock time of each detected peak. An average bpm
    can only drive a free-running oscillator; actual beat times let a consumer
    phase-lock to the heart it is watching. The newest sample in the ring is
    assumed to have arrived at `now`, which is true to within one poll period.
    """
    empty = {"hr": 0.0, "hrv": 0.0, "n_beats": 0, "beats": []}
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

    t_end = time.time() if now is None else now
    newest = ppg_window.shape[0] - 1
    beats = [round(t_end - (newest - int(p)) / fs, 3) for p in peaks]
    beats = [t for t in beats if t_end - t <= config.BEAT_HISTORY_SECONDS]

    return {"hr": hr, "hrv": rmssd_ms, "n_beats": int(len(peaks)), "beats": beats}
