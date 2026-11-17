"""Reusable digital filters (thin wrappers around scipy.signal)."""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi, sosfiltfilt

from .. import config


def _bandpass_sos(low: float, high: float, fs: float, order: int):
    nyq = 0.5 * fs
    return butter(order, [low / nyq, high / nyq], btype="band", output="sos")


# Pre-compute the main display/analysis bandpass once (it never changes).
_MAIN_SOS = _bandpass_sos(config.FILTER_LOW, config.FILTER_HIGH,
                          config.EEG_SAMPLE_RATE, config.FILTER_ORDER)
_BASE_ZI = sosfilt_zi(_MAIN_SOS)

# sosfiltfilt needs the signal to be comfortably longer than its edge padding.
# 48 samples (~0.19 s at 256 Hz) is safely above the padlen for a 4th-order SOS.
_MIN_FILT_LEN = 48


def bandpass(x: np.ndarray, low: float, high: float,
             fs: float = config.EEG_SAMPLE_RATE, order: int = config.FILTER_ORDER) -> np.ndarray:
    """Zero-phase Butterworth bandpass along axis 0.

    Falls back to mean-centered signal if the window is too short to filter safely.
    """
    if x.shape[0] < _MIN_FILT_LEN:
        return x - np.mean(x, axis=0, keepdims=True)
    sos = _bandpass_sos(low, high, fs, order)
    return sosfiltfilt(sos, x, axis=0)


def clean_eeg(x: np.ndarray) -> np.ndarray:
    """Apply the standard 1-44 Hz zero-phase analysis bandpass to a finite EEG window."""
    if x.shape[0] < _MIN_FILT_LEN:
        return x - np.mean(x, axis=0, keepdims=True)
    return sosfiltfilt(_MAIN_SOS, x, axis=0)


def init_eeg_stream_zi(first_sample: np.ndarray) -> np.ndarray:
    """Initialize steady-state causal SOS filter state for a multi-channel EEG stream."""
    return _BASE_ZI[:, :, None] * np.asarray(first_sample, dtype=float)[None, None, :]


def clean_eeg_stream(x: np.ndarray, zi: np.ndarray | None) -> tuple[np.ndarray, np.ndarray | None]:
    """Causal 1-44 Hz Butterworth bandpass for chunked real-time display streaming.

    Preserves filter state `zi` across chunks so consecutive batches stitch
    continuously without the reflection-edge transients of blockwise `sosfiltfilt`.
    """
    if x.shape[0] == 0:
        return x, zi
    if zi is None:
        zi = init_eeg_stream_zi(x[0])
    y, next_zi = sosfilt(_MAIN_SOS, x, axis=0, zi=zi)
    return y, next_zi
