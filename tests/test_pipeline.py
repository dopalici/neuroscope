"""Unit and integration tests for NeuroScope signal processing and simulation."""
from __future__ import annotations

import unittest

import numpy as np

from backend import config
from backend.processing import artifacts, bandpower, filters, heart, indices, motion
from backend.processing.pipeline import Pipeline
from backend.sources.simulated import SimulatedSource


class TestFiltersAndBandpower(unittest.TestCase):
    def test_streaming_filter_matches_continuous_causal_filter(self) -> None:
        rng = np.random.default_rng(1)
        x = rng.standard_normal((512, 4)) * 20.0
        y_full, _ = filters.clean_eeg_stream(x, None)

        zi = None
        chunks = []
        for start in range(0, 512, 25):
            y_chunk, zi = filters.clean_eeg_stream(x[start:start + 25], zi)
            chunks.append(y_chunk)
        y_chunked = np.vstack(chunks)
        self.assertLess(float(np.max(np.abs(y_full - y_chunked))), 1e-10)

    def test_bandpower_parseval_on_pure_sinusoids(self) -> None:
        t = np.arange(config.WINDOW_SAMPLES) / config.EEG_SAMPLE_RATE
        amp = 20.0
        expected_power = (amp ** 2) / 2.0  # 200.0 uV^2

        # Interior frequency (10 Hz -> alpha)
        bp_alpha = bandpower.band_powers(amp * np.sin(2 * np.pi * 10.0 * t))
        self.assertAlmostEqual(sum(bp_alpha.values()), expected_power, places=3)
        self.assertAlmostEqual(bp_alpha["alpha"], expected_power, places=3)

        # Boundary frequency (8 Hz -> split evenly across theta [4,8] and alpha [8,13])
        bp_edge = bandpower.band_powers(amp * np.sin(2 * np.pi * 8.0 * t))
        self.assertAlmostEqual(sum(bp_edge.values()), expected_power, places=3)
        self.assertAlmostEqual(bp_edge["theta"], expected_power / 2.0, places=3)
        self.assertAlmostEqual(bp_edge["alpha"], expected_power / 2.0, places=3)

    def test_contact_quality_thresholds(self) -> None:
        self.assertEqual(bandpower.contact_quality(np.zeros(128))[0], "red")
        t = np.linspace(0, 1, 256)
        self.assertEqual(bandpower.contact_quality(20.0 * np.sin(2 * np.pi * 10 * t))[0], "green")
        self.assertEqual(bandpower.contact_quality(80.0 * np.sin(2 * np.pi * 10 * t))[0], "amber")
        self.assertEqual(bandpower.contact_quality(150.0 * np.sin(2 * np.pi * 10 * t))[0], "red")


class TestIndicesArtifactsHeartMotion(unittest.TestCase):
    def test_derived_indices(self) -> None:
        bands = {
            "TP9": {"delta": 40.0, "theta": 20.0, "alpha": 20.0, "beta": 15.0, "gamma": 5.0},
            "AF7": {"delta": 40.0, "theta": 20.0, "alpha": 10.0, "beta": 25.0, "gamma": 5.0},
            "AF8": {"delta": 40.0, "theta": 20.0, "alpha": 30.0, "beta": 5.0, "gamma": 5.0},
            "TP10": {"delta": 40.0, "theta": 20.0, "alpha": 20.0, "beta": 15.0, "gamma": 5.0},
        }
        out = indices.compute_indices(bands)
        self.assertAlmostEqual(out["focus"], 15.0 / 20.0, places=6)
        self.assertAlmostEqual(out["calm"], 0.20, places=6)
        self.assertGreater(out["faa"], 0.0)

    def test_artifact_detectors_respond_selectively(self) -> None:
        n = config.WINDOW_SAMPLES
        t = np.arange(n) / config.EEG_SAMPLE_RATE
        eeg = np.zeros((n, 4))

        # Frontal blink near the end of the window
        blink_sig = eeg.copy()
        pulse = 250.0 * np.exp(-((t - (t[-1] - 0.08)) ** 2) / (2 * 0.075 ** 2))
        blink_sig[:, 1] += pulse
        blink_sig[:, 2] += pulse
        self.assertGreater(artifacts.blink_magnitude(blink_sig), config.BLINK_THRESHOLD_UV)

        # Temporal jaw EMG burst near the end of the window
        jaw_sig = eeg.copy()
        rng = np.random.default_rng(7)
        jaw_sig[-64:, 0] += rng.standard_normal(64) * 95.0
        jaw_sig[-64:, 3] += rng.standard_normal(64) * 95.0
        self.assertGreater(artifacts.jaw_magnitude(jaw_sig), config.JAW_THRESHOLD_UV)

    def test_heart_metrics_robust_across_seeds(self) -> None:
        for seed in range(15):
            src = SimulatedSource(seed=seed)
            src.start()
            src._start_time -= 8.0
            batch = src.poll()
            m = heart.heart_metrics(batch.ppg)
            self.assertGreater(m["hr"], 55.0)
            self.assertLess(m["hr"], 85.0)
            self.assertGreater(m["hrv"], 5.0)
            self.assertLess(m["hrv"], 80.0)

    def test_motion_metrics_upright_vs_tilted(self) -> None:
        acc_still = np.tile([0.0, 0.0, 1.0], (52, 1))
        gyro_still = np.zeros((52, 3))
        m_still = motion.motion_metrics(acc_still, gyro_still)
        self.assertTrue(m_still["still"])
        self.assertAlmostEqual(m_still["posture"], 0.0, places=4)

        acc_tilted = np.tile([0.0, 1.0, 0.0], (52, 1))
        m_tilt = motion.motion_metrics(acc_tilted, gyro_still)
        self.assertAlmostEqual(m_tilt["posture"], 90.0, places=4)


class TestSimulationAndPipeline(unittest.TestCase):
    def test_simulated_pipeline_end_to_end(self) -> None:
        src = SimulatedSource(seed=42)
        pipe = Pipeline()
        src.start()

        now = 1000.0
        last_frame = None
        for _ in range(300):  # 30 s at 10 Hz
            src._start_time -= 0.1
            now += 0.1
            pipe.add(src.poll())
            last_frame = pipe.frame(now=now)

        assert last_frame is not None
        self.assertEqual(last_frame["type"], "frame")
        self.assertEqual(set(last_frame["bands_avg"].keys()), set(config.BANDS.keys()))
        self.assertGreater(last_frame["artifacts"]["blink_total"], 0)
        self.assertGreater(last_frame["artifacts"]["jaw_total"], 0)
        self.assertGreater(last_frame["heart"]["hr"], 0.0)
        for ch_samples in last_frame["eeg"]["new"]:
            for val in ch_samples:
                self.assertTrue(np.isfinite(val))


if __name__ == "__main__":
    unittest.main()
