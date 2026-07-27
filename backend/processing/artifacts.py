"""Turning 'noise' into signal: blink and jaw-clench detection.

On the Muse the frontal electrodes (AF7/AF8) sit right over the eyes, so an eye
BLINK produces a big, slow voltage swing. The temporal electrodes (TP9/TP10)
sit over the jaw muscles, so clenching produces a burst of high-frequency EMG.

These simple threshold detectors are intentionally transparent - the exact
thresholds live in config.py and are documented as such.
"""
from __future__ import annotations

import numpy as np

from .. import config
from .filters import bandpass

# We filter over the whole window (needed for a clean low-frequency estimate)
# but only INSPECT the newest slice. Otherwise a single blink would keep
# tripping the detector for as long as it lingers inside the 2 s window, and we
# would count one blink many times over. ~0.2 s matches a real blink's duration.
_RECENT_SECONDS = 0.2
_RECENT_N = max(1, int(_RECENT_SECONDS * config.EEG_SAMPLE_RATE))


def blink_magnitude(eeg_window: np.ndarray) -> float:
    """Peak low-frequency amplitude (uV) on the frontal channels, newest slice."""
    if eeg_window.shape[0] < 64:
        return 0.0
    idx = [config.EEG_CHANNELS.index(c) for c in config.FRONTAL_CHANNELS]
    frontal = eeg_window[:, idx]
    # 1-6 Hz isolates the slow blink shape from ongoing rhythms.
    slow = bandpass(frontal, 1.0, 6.0)
    return float(np.max(np.abs(slow[-_RECENT_N:])))


def jaw_magnitude(eeg_window: np.ndarray) -> float:
    """RMS high-frequency (EMG) amplitude (uV) on temporal channels, newest slice."""
    if eeg_window.shape[0] < 64:
        return 0.0
    idx = [config.EEG_CHANNELS.index(c) for c in config.TEMPORAL_CHANNELS]
    temporal = eeg_window[:, idx]
    # 20-44 Hz is where jaw/muscle EMG dominates over real brain rhythms.
    emg = bandpass(temporal, 20.0, 44.0)
    return float(np.sqrt(np.mean(emg[-_RECENT_N:] ** 2)))
