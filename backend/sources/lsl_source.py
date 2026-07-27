"""Real Muse 2 data source: reads the LSL streams published by `muselsl`.

Pipeline reminder:
    Muse 2  --Bluetooth-->  muselsl stream --ppg --acc --gyro  --LSL-->  here

Before this works you must, in a separate terminal, run:
    export DYLD_LIBRARY_PATH=/opt/homebrew/lib   # so pylsl finds liblsl
    muselsl stream --ppg --acc --gyro

`pylsl` is imported lazily inside `start()` so that simulation mode never
requires the native liblsl library to be installed.
"""
from __future__ import annotations

import numpy as np

from .. import config
from .base import DataSource, SampleBatch


class LSLSource(DataSource):
    name = "Muse 2 (LSL)"
    is_simulated = False

    def __init__(self, resolve_timeout: float = 15.0):
        self.resolve_timeout = resolve_timeout
        self._eeg_inlet = None
        self._ppg_inlet = None
        self._acc_inlet = None
        self._gyro_inlet = None

    def _resolve(self, stype: str):
        """Find the first LSL stream of a given type, or return None."""
        from pylsl import resolve_byprop, StreamInlet

        streams = resolve_byprop("type", stype, timeout=self.resolve_timeout)
        if not streams:
            return None
        # max_chunklen=0 lets us pull whatever is buffered each poll.
        return StreamInlet(streams[0], max_chunklen=0, recover=True)

    def start(self) -> None:
        # Importing here surfaces a clear error if liblsl is missing.
        try:
            import pylsl  # noqa: F401
        except Exception as exc:  # pragma: no cover - depends on native lib
            raise RuntimeError(
                "Could not import pylsl. Install the native LSL library first:\n"
                "  brew install labstreaminglayer/tap/lsl\n"
                "  export DYLD_LIBRARY_PATH=/opt/homebrew/lib\n"
                f"Original error: {exc}"
            ) from exc

        self._eeg_inlet = self._resolve("EEG")
        if self._eeg_inlet is None:
            raise RuntimeError(
                "No EEG LSL stream found. In another terminal run:\n"
                "  export DYLD_LIBRARY_PATH=/opt/homebrew/lib\n"
                "  muselsl stream --ppg --acc --gyro\n"
                "and wait for 'Streaming EEG...' before starting the backend."
            )
        # PPG / ACC / GYRO are optional; the dashboard degrades gracefully.
        self._ppg_inlet = self._resolve("PPG")
        self._acc_inlet = self._resolve("ACC")
        self._gyro_inlet = self._resolve("GYRO")

    def stop(self) -> None:
        for inlet in (self._eeg_inlet, self._ppg_inlet, self._acc_inlet, self._gyro_inlet):
            if inlet is not None:
                try:
                    inlet.close_stream()
                except Exception:
                    pass

    @staticmethod
    def _pull(inlet):
        """Pull all buffered samples from an inlet -> (data, timestamps)."""
        if inlet is None:
            return np.empty((0, 0)), np.empty((0,))
        samples, timestamps = inlet.pull_chunk(timeout=0.0, max_samples=1024)
        if not samples:
            return np.empty((0, 0)), np.empty((0,))
        return np.asarray(samples, dtype=float), np.asarray(timestamps, dtype=float)

    def poll(self) -> SampleBatch:
        batch = SampleBatch()

        eeg, eeg_ts = self._pull(self._eeg_inlet)
        if eeg.size:
            # muselsl EEG channel order is TP9, AF7, AF8, TP10, (Right AUX).
            batch.eeg = eeg[:, :4]
            batch.eeg_ts = eeg_ts

        ppg, ppg_ts = self._pull(self._ppg_inlet)
        if ppg.size:
            # Muse PPG has 3 channels; the middle (index 1) is the usable one.
            col = 1 if ppg.shape[1] > 1 else 0
            batch.ppg = ppg[:, col]
            batch.ppg_ts = ppg_ts

        acc, acc_ts = self._pull(self._acc_inlet)
        if acc.size:
            batch.acc = acc[:, :3]
            batch.imu_ts = acc_ts

        gyro, _ = self._pull(self._gyro_inlet)
        if gyro.size:
            batch.gyro = gyro[:, :3]

        return batch
