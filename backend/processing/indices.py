"""Derived cognitive indices: focus, calm, and frontal alpha asymmetry.

These are POPULAR heuristics, not clinical measures. They are useful for
watching *trends in yourself over time*, not for comparing people or diagnosing
anything. The dashboard says this plainly.
"""
from __future__ import annotations

import math

import numpy as np

from .. import config


def _avg_band(bands_by_ch: dict[str, dict[str, float]], band: str, channels) -> float:
    vals = [bands_by_ch[ch][band] for ch in channels if ch in bands_by_ch]
    return float(np.mean(vals)) if vals else 0.0


def focus_index(bands_by_ch: dict[str, dict[str, float]]) -> float:
    """Beta / Alpha ratio, averaged over all channels.

    Higher beta relative to alpha loosely tracks alert, engaged processing.
    """
    beta = _avg_band(bands_by_ch, "beta", config.EEG_CHANNELS)
    alpha = _avg_band(bands_by_ch, "alpha", config.EEG_CHANNELS)
    if alpha <= 1e-9:
        return 0.0
    return beta / alpha


def calm_index(bands_by_ch: dict[str, dict[str, float]]) -> float:
    """Relative alpha power (alpha / total), averaged over all channels.

    Eyes-closed relaxation classically boosts alpha, so more alpha (relative to
    the rest of the spectrum) loosely tracks a calm, relaxed state.
    """
    alphas, totals = [], []
    for ch in config.EEG_CHANNELS:
        b = bands_by_ch.get(ch)
        if not b:
            continue
        total = sum(b.values())
        if total > 1e-9:
            alphas.append(b["alpha"])
            totals.append(total)
    if not totals:
        return 0.0
    return float(np.mean([a / t for a, t in zip(alphas, totals)]))


def frontal_alpha_asymmetry(bands_by_ch: dict[str, dict[str, float]]) -> float:
    """FAA = ln(alpha_right AF8) - ln(alpha_left AF7).

    In the research literature, relatively LESS left-frontal alpha (more left
    activity) is associated with approach/positive affect. On a 4-electrode
    consumer headband this is very noisy - treat it as a fun trend only.
    Positive = more right-alpha (less right activity); negative = the reverse.
    """
    left = bands_by_ch.get("AF7", {}).get("alpha", 0.0)
    right = bands_by_ch.get("AF8", {}).get("alpha", 0.0)
    eps = 1e-9
    return math.log(right + eps) - math.log(left + eps)


def compute_indices(bands_by_ch: dict[str, dict[str, float]]) -> dict[str, float]:
    return {
        "focus": focus_index(bands_by_ch),
        "calm": calm_index(bands_by_ch),
        "faa": frontal_alpha_asymmetry(bands_by_ch),
        "alpha_abs": _avg_band(bands_by_ch, "alpha", config.EEG_CHANNELS),
    }
