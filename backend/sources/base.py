"""The shared data-source interface used by both the simulated and real Muse.

A `SampleBatch` is "all the new samples that arrived since the last poll". The
server loop polls the active source ~10 times a second and feeds the batch into
the processing pipeline.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class SampleBatch:
    """A chunk of freshly-arrived samples from every sensor stream.

    All arrays may be empty if nothing new arrived for that stream. EEG values
    are in microvolts (uV). Accelerometer is in g, gyroscope in deg/s.
    """

    # EEG: shape (n_samples, 4) for the four channels TP9, AF7, AF8, TP10.
    eeg: np.ndarray = field(default_factory=lambda: np.empty((0, 4)))
    eeg_ts: np.ndarray = field(default_factory=lambda: np.empty((0,)))

    # PPG (heart): shape (m_samples,) - one representative optical channel.
    ppg: np.ndarray = field(default_factory=lambda: np.empty((0,)))
    ppg_ts: np.ndarray = field(default_factory=lambda: np.empty((0,)))

    # IMU: accelerometer and gyroscope, each shape (p_samples, 3) = x, y, z.
    acc: np.ndarray = field(default_factory=lambda: np.empty((0, 3)))
    gyro: np.ndarray = field(default_factory=lambda: np.empty((0, 3)))
    imu_ts: np.ndarray = field(default_factory=lambda: np.empty((0,)))


class DataSource:
    """Abstract base class. Both real and simulated sources implement this."""

    #: Human-readable name shown in the UI ("Simulated" or "Muse 2 (LSL)").
    name: str = "unknown"
    #: True when this source is synthetic (used to badge the UI honestly).
    is_simulated: bool = False

    def start(self) -> None:
        """Open the device / begin generating data. Called once."""
        raise NotImplementedError

    def poll(self) -> SampleBatch:
        """Return every sample that arrived since the previous call."""
        raise NotImplementedError

    def stop(self) -> None:
        """Release the device / stop generating data."""
        raise NotImplementedError
