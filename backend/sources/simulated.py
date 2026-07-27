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

from .. import config
from .base import DataSource, SampleBatch


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

        # Scheduled event clocks (absolute seconds since start).
        self._next_blink = self.rng.exponential(3.0)
        self._next_jaw = 6.0 + self.rng.exponential(15.0)
        # Absolute times (s since start) of every scheduled heartbeat, extended
        # forward as needed and pruned once safely in the past.
        self._beat_times: list[float] = []
        self._last_beat = 0.4
        self._jaw_active_until = -1.0
        # Posture: a slowly changing tilt vector (unit-ish) plus base gravity.
        self._tilt = np.zeros(3)
        self._next_posture = self.rng.exponential(8.0)

    # -- lifecycle ---------------------------------------------------------
    def start(self) -> None:
        self._start_time = time.time()
        self._eeg_n = self._ppg_n = self._imu_n = 0

    def stop(self) -> None:  # nothing to release
        pass

    # -- helpers -----------------------------------------------------------
    def _pink_noise(self, n: int, amp: float) -> np.ndarray:
        """Cheap 1/f-ish noise via cumulative-sum of white noise, detrended."""
        if n <= 0:
            return np.zeros(0)
        white = self.rng.standard_normal(n)
        pink = np.cumsum(white)
        pink -= np.linspace(pink[0], pink[-1], n)  # remove the random walk drift
        std = pink.std()
        if std > 0:
            pink /= std
        return pink * amp

    def _osc(self, t: np.ndarray, f_lo: float, f_hi: float, amp: float) -> np.ndarray:
        """A narrow-band oscillation: a couple of sinusoids inside a band."""
        out = np.zeros_like(t)
        for f in (f_lo + 0.3 * (f_hi - f_lo), f_lo + 0.7 * (f_hi - f_lo)):
            phase = self.rng.uniform(0, 2 * np.pi)
            out += np.sin(2 * np.pi * f * t + phase)
        return out * amp

    # -- main generators ---------------------------------------------------
    def _gen_eeg(self, n: int) -> tuple[np.ndarray, np.ndarray]:
        fs = config.EEG_SAMPLE_RATE
        idx = np.arange(self._eeg_n, self._eeg_n + n)
        t = idx / fs
        self._eeg_n += n
        if n == 0:
            return np.empty((0, 4)), self._start_time + t

        # Slow drift of the alpha level so the neurofeedback bar visibly moves.
        drift = 0.6 + 0.4 * np.sin(2 * np.pi * 0.05 * t)  # ~20 s cycle
        alpha_amp = 18.0 * self.alpha_level * drift
        beta_amp = 7.0 * self.beta_level * (1.1 - 0.3 * np.sin(2 * np.pi * 0.05 * t))

        out = np.zeros((n, 4))
        for ci, ch in enumerate(config.EEG_CHANNELS):
            sig = self._pink_noise(n, amp=14.0)
            sig += self._osc(t, *config.BANDS["delta"], 10.0)
            sig += self._osc(t, *config.BANDS["theta"], 6.0)
            # Posterior (temporal) channels carry a bit more alpha, like real life.
            a_scale = 1.25 if ch in config.TEMPORAL_CHANNELS else 0.85
            sig += a_scale * self._osc(t, *config.BANDS["alpha"], 1.0) * alpha_amp
            sig += self._osc(t, *config.BANDS["beta"], 1.0) * beta_amp
            sig += self._osc(t, *config.BANDS["gamma"], 2.0)
            out[:, ci] = sig

        self._inject_blinks(out, t)
        self._inject_jaw(out, t)
        eeg_ts = self._start_time + t
        return out, eeg_ts

    def _inject_blinks(self, eeg: np.ndarray, t: np.ndarray) -> None:
        """Add slow, large positive deflections on the frontal channels."""
        t0, t1 = t[0], t[-1]
        fs = config.EEG_SAMPLE_RATE
        while self._next_blink <= t1:
            if self._next_blink >= t0:
                peak_i = int((self._next_blink - t0) * fs)
                width = int(0.20 * fs)  # ~200 ms
                lo = max(0, peak_i - width)
                hi = min(len(t), peak_i + width)
                k = np.arange(lo, hi) - peak_i
                shape = np.exp(-(k ** 2) / (2 * (width / 3) ** 2))
                amp = self.rng.uniform(110, 190)
                for ch in config.FRONTAL_CHANNELS:
                    ci = config.EEG_CHANNELS.index(ch)
                    eeg[lo:hi, ci] += amp * shape
                # Temporal channels see a smaller echo.
                for ch in config.TEMPORAL_CHANNELS:
                    ci = config.EEG_CHANNELS.index(ch)
                    eeg[lo:hi, ci] += 0.2 * amp * shape
            self._next_blink += self.rng.exponential(3.0)

    def _inject_jaw(self, eeg: np.ndarray, t: np.ndarray) -> None:
        """Add high-frequency EMG bursts, strongest on temporal channels."""
        t0, t1 = t[0], t[-1]
        # Possibly start a new clench.
        while self._next_jaw <= t1:
            if self._next_jaw >= t0:
                self._jaw_active_until = self._next_jaw + self.rng.uniform(0.4, 0.9)
            self._next_jaw += 6.0 + self.rng.exponential(15.0)
        # Fill any samples that fall inside an active clench with EMG noise.
        if self._jaw_active_until > t0:
            mask = t <= self._jaw_active_until
            n_active = int(mask.sum())
            if n_active:
                for ch in config.EEG_CHANNELS:
                    ci = config.EEG_CHANNELS.index(ch)
                    scale = 40.0 if ch in config.TEMPORAL_CHANNELS else 22.0
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
            # Beat-to-beat variability -> genuine HRV to measure.
            self._last_beat += base_ibi + self.rng.normal(0, 0.04)
            self._beat_times.append(self._last_beat)
        # Drop beats that can no longer affect any future chunk.
        self._beat_times = [b for b in self._beat_times if b >= t0 - 1.0]

        # Render every beat whose pulse overlaps this chunk. A broad systolic
        # upstroke plus a small, well-separated dicrotic bump; widths are kept
        # realistic for 64 Hz so peak detection locks onto one peak per beat.
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
            self._next_posture += self.rng.exponential(8.0)
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
