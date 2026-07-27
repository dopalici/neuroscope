"""Reusable digital filters (thin wrappers around scipy.signal)."""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt

from .. import config


def _bandpass_sos(low: float, high: float, fs: float, order: int):
    nyq = 0.5 * fs
    return butter(order, [low / nyq, high / nyq], btype="band", output="sos")


# Pre-compute the main display/analysis bandpass once (it never changes).
_MAIN_SOS = _bandpass_sos(config.FILTER_LOW, config.FILTER_HIGH,
                          config.EEG_SAMPLE_RATE, config.FILTER_ORDER)

# sosfiltfilt needs the signal to be comfortably longer than its edge padding.
# 48 samples (~0.19 s at 256 Hz) is safely above the padlen for a 4th-order SOS.
_MIN_FILT_LEN = 48


def bandpass(x: np.ndarray, low: float, high: float,
             fs: float = config.EEG_SAMPLE_RATE, order: int = config.FILTER_ORDER) -> np.ndarray:
    """Zero-phase Butterworth bandpass along axis 0.

    Falls back to the raw signal if the window is too short to filter safely.
    """
    if x.shape[0] < _MIN_FILT_LEN:
        return x - np.mean(x, axis=0, keepdims=True)
    sos = _bandpass_sos(low, high, fs, order)
    return sosfiltfilt(sos, x, axis=0)


def clean_eeg(x: np.ndarray) -> np.ndarray:
    """Apply the standard 1-44 Hz analysis bandpass to raw EEG."""
    if x.shape[0] < _MIN_FILT_LEN:
        return x - np.mean(x, axis=0, keepdims=True)
    return sosfiltfilt(_MAIN_SOS, x, axis=0)
