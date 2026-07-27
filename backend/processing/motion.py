"""Posture and motion from the accelerometer / gyroscope (IMU)."""
from __future__ import annotations

import numpy as np

from .. import config


def motion_metrics(acc_window: np.ndarray, gyro_window: np.ndarray) -> dict:
    """Summarise head motion and posture from recent IMU samples.

    * motion  - how much the head is moving right now (std of acceleration,
                in milli-g). ~0 when still, spikes when you move.
    * posture - head tilt angle from upright, in degrees, from the direction of
                the gravity vector.
    """
    out = {"motion": 0.0, "posture": 0.0, "still": True}
    if acc_window.shape[0] < 2:
        return out

    # Motion: variability of the acceleration magnitude (remove gravity offset).
    mag = np.linalg.norm(acc_window, axis=1)
    out["motion"] = float(np.std(mag) * 1000.0)  # milli-g

    # Posture: angle between the mean acceleration vector and "up" (+Z).
    mean_acc = np.mean(acc_window, axis=0)
    norm = np.linalg.norm(mean_acc)
    if norm > 1e-6:
        cos_tilt = np.clip(mean_acc[2] / norm, -1.0, 1.0)
        out["posture"] = float(np.degrees(np.arccos(cos_tilt)))

    if gyro_window is not None and gyro_window.shape[0] >= 2:
        rot = float(np.mean(np.linalg.norm(gyro_window, axis=1)))
        out["still"] = bool(out["motion"] < 25.0 and rot < 15.0)
    else:
        out["still"] = bool(out["motion"] < 25.0)
    return out
