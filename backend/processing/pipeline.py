"""Ties every processing step together and produces one JSON-ready frame.

The pipeline keeps rolling buffers of recent samples. `add()` is called with
each new `SampleBatch`; `frame()` computes all metrics over the current buffers
and returns a plain dict ready to be sent over the WebSocket.
"""
from __future__ import annotations

import time
from collections import deque

import numpy as np

from .. import config
from ..sources.base import SampleBatch
from . import artifacts, bandpower, heart, indices, motion
from .filters import clean_eeg


class _Ring:
    """A simple fixed-length rolling buffer for 1-D or 2-D sample arrays."""

    def __init__(self, maxlen: int, width: int | None = None):
        self.maxlen = maxlen
        self.width = width
        shape = (0,) if width is None else (0, width)
        self.data = np.empty(shape)

    def push(self, x: np.ndarray) -> None:
        if x.size == 0:
            return
        self.data = np.concatenate([self.data, x], axis=0)
        if self.data.shape[0] > self.maxlen:
            self.data = self.data[-self.maxlen:]

    def full_enough(self, n: int) -> bool:
        return self.data.shape[0] >= n


class Pipeline:
    def __init__(self):
        self.eeg = _Ring(int(config.EEG_SAMPLE_RATE * 3), width=4)      # ~3 s
        self.ppg = _Ring(int(config.PPG_SAMPLE_RATE * 8))               # ~8 s
        self.acc = _Ring(int(config.IMU_SAMPLE_RATE * 3), width=3)      # ~3 s
        self.gyro = _Ring(int(config.IMU_SAMPLE_RATE * 3), width=3)

        # Buffer of newly-cleaned EEG samples to ship to the browser each frame.
        self._pending_display: list[np.ndarray] = []

        # Artifact edge-detection state.
        self._blink_refractory_until = 0.0
        self._jaw_refractory_until = 0.0
        self.blink_total = 0
        self.jaw_total = 0
        self._blink_events: deque[float] = deque()
        self._jaw_events: deque[float] = deque()

    # -- ingest ------------------------------------------------------------
    def add(self, batch: SampleBatch) -> None:
        if batch.eeg.size:
            self.eeg.push(batch.eeg)
            # Clean the *newly appended* portion for display. We filter over a
            # short context window to avoid edge transients, then keep only the
            # new tail.
            n_new = batch.eeg.shape[0]
            ctx = self.eeg.data[-min(self.eeg.data.shape[0], config.WINDOW_SAMPLES):]
            cleaned = clean_eeg(ctx)
            self._pending_display.append(cleaned[-n_new:])
        if batch.ppg.size:
            self.ppg.push(batch.ppg)
        if batch.acc.size:
            self.acc.push(batch.acc)
        if batch.gyro.size:
            self.gyro.push(batch.gyro)

    # -- artifact edge counting -------------------------------------------
    def _update_artifacts(self, now: float, window: np.ndarray) -> dict:
        blink_mag = artifacts.blink_magnitude(window)
        jaw_mag = artifacts.jaw_magnitude(window)

        blink_active = blink_mag > config.BLINK_THRESHOLD_UV
        jaw_active = jaw_mag > config.JAW_THRESHOLD_UV

        if blink_active and now >= self._blink_refractory_until:
            self.blink_total += 1
            self._blink_events.append(now)
            self._blink_refractory_until = now + 0.5  # ignore the same blink
        if jaw_active and now >= self._jaw_refractory_until:
            self.jaw_total += 1
            self._jaw_events.append(now)
            self._jaw_refractory_until = now + 0.6

        # Drop events older than 60 s to get a per-minute rate.
        for dq in (self._blink_events, self._jaw_events):
            while dq and now - dq[0] > 60.0:
                dq.popleft()

        return {
            "blink": bool(blink_active),
            "jaw": bool(jaw_active),
            "blink_mag": round(blink_mag, 1),
            "jaw_mag": round(jaw_mag, 1),
            "blink_threshold": config.BLINK_THRESHOLD_UV,
            "jaw_threshold": config.JAW_THRESHOLD_UV,
            "blink_total": self.blink_total,
            "jaw_total": self.jaw_total,
            "blink_rate": len(self._blink_events),  # per last 60 s
            "jaw_rate": len(self._jaw_events),
        }

    # -- short-window amplitude -------------------------------------------
    def _envelope(self, win_clean: np.ndarray) -> dict:
        """Per-channel RMS (uV) over the newest ~100 ms of cleaned EEG."""
        n = config.ENVELOPE_SAMPLES
        if win_clean.shape[0] < n:
            return {ch: 0.0 for ch in config.EEG_CHANNELS}
        tail = win_clean[-n:]
        rms = np.sqrt(np.mean(tail ** 2, axis=0))
        return {ch: round(float(rms[ci]), 2) for ci, ch in enumerate(config.EEG_CHANNELS)}

    # -- frame -------------------------------------------------------------
    def frame(self) -> dict:
        now = time.time()

        # Collect and clear the pending raw-display samples.
        if self._pending_display:
            new_eeg = np.concatenate(self._pending_display, axis=0)
            self._pending_display = []
        else:
            new_eeg = np.empty((0, 4))

        # Analysis window: the most recent WINDOW_SAMPLES samples.
        have = self.eeg.data.shape[0]
        win = self.eeg.data[-config.WINDOW_SAMPLES:] if have else np.empty((0, 4))
        win_clean = clean_eeg(win) if win.shape[0] else win

        # Band power + quality per channel.
        bands = {ch: {b: 0.0 for b in config.BANDS} for ch in config.EEG_CHANNELS}
        quality = {}
        if win_clean.shape[0] >= 64:
            bands = bandpower.all_channel_band_powers(win_clean)
            for ci, ch in enumerate(config.EEG_CHANNELS):
                label, sd = bandpower.contact_quality(win_clean[:, ci])
                quality[ch] = {"label": label, "uv": round(sd, 1)}
        else:
            for ch in config.EEG_CHANNELS:
                quality[ch] = {"label": "red", "uv": 0.0}

        bands_avg = {b: float(np.mean([bands[ch][b] for ch in config.EEG_CHANNELS]))
                     for b in config.BANDS}

        idx = indices.compute_indices(bands)
        art = self._update_artifacts(now, win_clean if win_clean.shape[0] else win)
        hr = heart.heart_metrics(self.ppg.data, now=now)
        mot = motion.motion_metrics(self.acc.data, self.gyro.data)
        env = self._envelope(win_clean)

        # New raw EEG per channel (rounded to keep the payload small).
        eeg_new = [np.round(new_eeg[:, ci], 1).tolist() for ci in range(4)] \
            if new_eeg.size else [[] for _ in range(4)]

        return {
            "type": "frame",
            "t": now,
            "eeg": {"channels": config.EEG_CHANNELS,
                     "fs": config.EEG_SAMPLE_RATE,
                     "new": eeg_new},
            "bands": {ch: {b: round(v, 2) for b, v in bands[ch].items()} for ch in bands},
            "bands_avg": {b: round(v, 2) for b, v in bands_avg.items()},
            "quality": quality,
            "indices": {k: round(v, 4) for k, v in idx.items()},
            "artifacts": art,
            "envelope": env,
            "heart": {k: round(v, 1) if isinstance(v, float) else v for k, v in hr.items()},
            "motion": {"motion": round(mot["motion"], 1),
                        "posture": round(mot["posture"], 1),
                        "still": mot["still"]},
        }

    def meta(self, source_name: str, is_simulated: bool) -> dict:
        """The one-off descriptor sent to a client when it connects."""
        return {
            "type": "meta",
            "source": source_name,
            "simulated": is_simulated,
            "channels": config.EEG_CHANNELS,
            "eeg_fs": config.EEG_SAMPLE_RATE,
            "ppg_fs": config.PPG_SAMPLE_RATE,
            "imu_fs": config.IMU_SAMPLE_RATE,
            "bands": {b: list(v) for b, v in config.BANDS.items()},
            "window_seconds": config.WINDOW_SECONDS,
            "update_rate_hz": config.UPDATE_RATE_HZ,
            "raw_display_seconds": config.RAW_DISPLAY_SECONDS,
        }
