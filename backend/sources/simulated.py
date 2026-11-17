"""A realistic synthetic Muse 2 data source (no hardware required).

The goal is not a perfect biophysical model, but a signal that *behaves* like
real Muse data closely enough that the whole processing + dashboard pipeline is
exercised end-to-end:

  * EEG with a 1/f background plus tunable oscillations in every band.
  * A slowly drifting alpha level (so the neurofeedback demo has something to
    respond to) and an independent beta level.
  * Occasional eye BLINKS (big slow deflections on the frontal AF7/AF8) and
    JAW CLENCHES (high-frequency EMG bursts, strongest on temporal TP9/TP10).
  * A PPG waveform built from real heartbeats with beat-to-beat variability, so
    the heart-rate / HRV code has genuine peaks to find.
  * An IMU that mostly reads gravity with small sway plus occasional posture
    shifts.

Everything is generated against an absolute clock so phases stay continuous
across polls.
"""
from __future__ import annotations

import os
import time

import numpy as np
from scipy.signal import lfilter, lfilter_zi

from .. import config
from .base import DataSource, SampleBatch

# Paul Kellet 3-pole/3-zero IIR pinking filter (1/f PSD over 1-80 Hz at 256 Hz).
# Output std for unit white-noise input is ~0.088.
_PINK_B = np.array([0.049922035, -0.095993537, 0.050612699, -0.004408786])
_PINK_A = np.array([1.0, -2.494956002, 2.017265875, -0.522189400])
_PINK_GAIN = 0.088


class SimulatedSource(DataSource):
    name = "Simulated"
    is_simulated = True

    def __init__(self, seed: int | None = None):
        self.rng = np.random.default_rng(seed)
        self._start_time = 0.0
        # Absolute count of samples already emitted per stream (for continuity).
        self._eeg_n = 0
        self._ppg_n = 0
        self._imu_n = 0

        # Tunable "brain state". These drift over time to make the dashboard
        # feel alive; they can also be nudged via env vars for demos/tests.
        self.alpha_level = float(os.environ.get("SIM_ALPHA", 1.0))
        self.beta_level = float(os.environ.get("SIM_BETA", 1.0))

        # Fixed initial phases per (channel, band) so sinusoids stay phase-continuous
        # across 10 Hz poll chunks.
        self._phases: dict[tuple[str, str], tuple[float, float]] = {
            (ch, band): (
                float(self.rng.uniform(0, 2 * np.pi)),
                float(self.rng.uniform(0, 2 * np.pi)),
            )
            for ch in config.EEG_CHANNELS
            for band in config.BANDS
        }
        # Stateful 1/f filter memory per EEG channel.
        self._pink_zi: list[np.ndarray] = [
            lfilter_zi(_PINK_B, _PINK_A) * 0.0 for _ in config.EEG_CHANNELS
        ]

        # Scheduled event clocks (absolute seconds since start).
        self._blink_events: list[tuple[float, float, float]] = []
        self._next_blink = 1.5 + float(self.rng.exponential(3.5))
        self._next_jaw = 5.0 + float(self.rng.exponential(12.0))
        # Absolute times (s since start) of every scheduled heartbeat, extended
        # forward as needed and pruned once safely in the past.
        self._beat_times: list[float] = []
        self._last_beat = 0.4
        self._jaw_active_until = -1.0
        # Posture: a slowly changing tilt vector (unit-ish) plus base gravity.
        self._tilt = np.zeros(3)
        self._next_posture = float(self.rng.exponential(8.0))

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> None:
        self._start_time = time.time()
        self._eeg_n = self._ppg_n = self._imu_n = 0
        self._pink_zi = [lfilter_zi(_PINK_B, _PINK_A) * 0.0 for _ in config.EEG_CHANNELS]

    def stop(self) -> None:  # nothing to release
        pass

    # -- helpers -----------------------------------------------------------
    def _pink_noise(self, ch_idx: int, n: int, amp: float) -> np.ndarray:
        """Continuous 1/f background noise via stateful IIR filtering."""
        if n <= 0:
            return np.zeros(0)
        white = self.rng.standard_normal(n)
        pink, self._pink_zi[ch_idx] = lfilter(_PINK_B, _PINK_A, white, zi=self._pink_zi[ch_idx])
        return pink * (amp / _PINK_GAIN)

    def _osc(self, ch: str, band: str, t: np.ndarray, amp: float) -> np.ndarray:
        """Phase-continuous narrow-band oscillation inside a configured band."""
        f_lo, f_hi = config.BANDS[band]
        p1, p2 = self._phases[(ch, band)]
        f1 = f_lo + 0.3 * (f_hi - f_lo)
        f2 = f_lo + 0.7 * (f_hi - f_lo)
        return (np.sin(2 * np.pi * f1 * t + p1) + np.sin(2 * np.pi * f2 * t + p2)) * amp

    # -- main generators ---------------------------------------------------
    def _gen_eeg(self, n: int) -> tuple[np.ndarray, np.ndarray]:
        fs = config.EEG_SAMPLE_RATE
        idx = np.arange(self._eeg_n, self._eeg_n + n)
        t = idx / fs
        self._eeg_n += n
        if n == 0:
            return np.empty((0, 4)), self._start_time + t

        # Slow drift of alpha/beta levels (~20 s cycle) so the dashboard traverses
        # resting and engaged states during a live demonstration.
        drift = 0.65 + 0.45 * np.sin(2 * np.pi * 0.05 * t)
        alpha_amp = 6.5 * self.alpha_level * drift
        beta_amp = 2.6 * self.beta_level * (1.05 - 0.35 * np.sin(2 * np.pi * 0.05 * t))

        out = np.zeros((n, 4))
        for ci, ch in enumerate(config.EEG_CHANNELS):
            sig = self._pink_noise(ci, n, amp=22.0)
            sig += self._osc(ch, "delta", t, 5.5)
            sig += self._osc(ch, "theta", t, 5.0)
            # Temporal/posterior channels carry slightly stronger resting alpha.
            a_scale = 1.25 if ch in config.TEMPORAL_CHANNELS else 0.85
            sig += a_scale * self._osc(ch, "alpha", t, 1.0) * alpha_amp
            sig += self._osc(ch, "beta", t, 1.0) * beta_amp
            sig += self._osc(ch, "gamma", t, 1.5)
            out[:, ci] = sig

        self._inject_blinks(out, t)
        self._inject_jaw(out, t)
        eeg_ts = self._start_time + t
        return out, eeg_ts

    def _inject_blinks(self, eeg: np.ndarray, t: np.ndarray) -> None:
        """Render smooth frontal blink deflections without chunk-edge truncation."""
        t0, t1 = float(t[0]), float(t[-1])
        while self._next_blink <= t1 + 0.5:
            amp = float(self.rng.uniform(220.0, 320.0))
            sigma_s = float(self.rng.uniform(0.065, 0.085))
            self._blink_events.append((self._next_blink, amp, sigma_s))
            self._next_blink += float(self.rng.exponential(3.5))
        self._blink_events = [b for b in self._blink_events if b[0] >= t0 - 0.5]

        frontal_idx = [config.EEG_CHANNELS.index(ch) for ch in config.FRONTAL_CHANNELS]
        temporal_idx = [config.EEG_CHANNELS.index(ch) for ch in config.TEMPORAL_CHANNELS]
        for peak_t, amp, sigma_s in self._blink_events:
            if t0 - 0.5 <= peak_t <= t1 + 0.5:
                dt = t - peak_t
                shape = np.exp(-(dt ** 2) / (2 * sigma_s ** 2))
                for ci in frontal_idx:
                    eeg[:, ci] += amp * shape
                for ci in temporal_idx:
                    eeg[:, ci] += 0.2 * amp * shape

    def _inject_jaw(self, eeg: np.ndarray, t: np.ndarray) -> None:
        """Add high-frequency EMG bursts, strongest on temporal channels."""
        t0, t1 = float(t[0]), float(t[-1])
        while self._next_jaw <= t1:
            if self._next_jaw >= t0:
                self._jaw_active_until = self._next_jaw + float(self.rng.uniform(0.45, 0.9))
            self._next_jaw += 5.0 + float(self.rng.exponential(12.0))
        if self._jaw_active_until > t0:
            mask = t <= self._jaw_active_until
            n_active = int(mask.sum())
            if n_active:
                for ci, ch in enumerate(config.EEG_CHANNELS):
                    # Broadband scale chosen so 20-44 Hz RMS reliably clears JAW_THRESHOLD_UV (28 uV).
                    scale = 95.0 if ch in config.TEMPORAL_CHANNELS else 45.0
                    emg = self.rng.standard_normal(n_active) * scale
                    eeg[mask, ci] += emg

    def _gen_ppg(self, n: int) -> tuple[np.ndarray, np.ndarray]:
        fs = config.PPG_SAMPLE_RATE
        idx = np.arange(self._ppg_n, self._ppg_n + n)
        t = idx / fs
        self._ppg_n += n
        # Baseline + respiration wander.
        sig = 500.0 + 8.0 * np.sin(2 * np.pi * 0.25 * t)
        sig += self.rng.standard_normal(n) * 1.5
        if n == 0:
            return sig, self._start_time + t
        t0, t1 = float(t[0]), float(t[-1])

        # Make sure the beat schedule extends a bit past the current chunk.
        base_ibi = 60.0 / 68.0  # ~68 bpm
        while self._last_beat <= t1 + 1.0:
            # Beat-to-beat variability (~35 ms resting RMSSD).
            self._last_beat += base_ibi + float(self.rng.normal(0, 0.025))
            self._beat_times.append(self._last_beat)
        # Drop beats that can no longer affect any future chunk.
        self._beat_times = [b for b in self._beat_times if b >= t0 - 1.0]

        # Render every beat whose pulse overlaps this chunk: systolic upstroke +
        # smaller dicrotic notch.
        for beat_t in self._beat_times:
            if t0 - 0.5 <= beat_t <= t1 + 0.5:
                dt = t - beat_t
                sig += np.exp(-(dt ** 2) / (2 * 0.055 ** 2)) * 45.0
                sig += np.exp(-((dt - 0.22) ** 2) / (2 * 0.07 ** 2)) * 10.0
        ppg_ts = self._start_time + t
        return sig, ppg_ts

    def _gen_imu(self, n: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        fs = config.IMU_SAMPLE_RATE
        idx = np.arange(self._imu_n, self._imu_n + n)
        t = idx / fs
        self._imu_n += n
        if n == 0:
            empty = np.empty((0, 3))
            return empty, empty, self._start_time + t
        # Occasional posture change: shift the tilt vector.
        while self._next_posture <= t[-1]:
            self._tilt = self.rng.uniform(-0.15, 0.15, size=3)
            self._next_posture += float(self.rng.exponential(8.0))
        acc = np.zeros((n, 3))
        acc[:, 2] = 1.0  # gravity on Z (head upright)
        acc += self._tilt[None, :]
        # Small head sway + sensor noise.
        acc[:, 0] += 0.02 * np.sin(2 * np.pi * 0.3 * t) + self.rng.standard_normal(n) * 0.01
        acc[:, 1] += 0.02 * np.sin(2 * np.pi * 0.2 * t) + self.rng.standard_normal(n) * 0.01
        acc[:, 2] += self.rng.standard_normal(n) * 0.01
        gyro = self.rng.standard_normal((n, 3)) * 1.5  # deg/s, mostly still
        imu_ts = self._start_time + t
        return acc, gyro, imu_ts

    # -- poll --------------------------------------------------------------
    def poll(self) -> SampleBatch:
        now = time.time()
        elapsed = now - self._start_time

        want_eeg = max(0, int(elapsed * config.EEG_SAMPLE_RATE) - self._eeg_n)
        want_ppg = max(0, int(elapsed * config.PPG_SAMPLE_RATE) - self._ppg_n)
        want_imu = max(0, int(elapsed * config.IMU_SAMPLE_RATE) - self._imu_n)

        eeg, eeg_ts = self._gen_eeg(want_eeg)
        ppg, ppg_ts = self._gen_ppg(want_ppg)
        acc, gyro, imu_ts = self._gen_imu(want_imu)

        return SampleBatch(
            eeg=eeg, eeg_ts=eeg_ts,
            ppg=ppg, ppg_ts=ppg_ts,
            acc=acc, gyro=gyro, imu_ts=imu_ts,
        )
