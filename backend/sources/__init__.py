"""Data sources: where raw Muse samples come from.

Two implementations share one interface (`DataSource`):
  * `SimulatedSource`  - realistic synthetic data, needs no hardware.
  * `LSLSource`        - reads real Muse streams published by `muselsl`.

The rest of the backend only talks to the `DataSource` interface, so switching
between "sim" and "real" is a one-line change.
"""
from .base import DataSource, SampleBatch
from .simulated import SimulatedSource


def create_source(mode: str) -> DataSource:
    """Factory: build a data source from a mode string ("sim" or "lsl")."""
    mode = (mode or "sim").lower()
    if mode in ("sim", "simulated", "fake", "demo"):
        return SimulatedSource()
    if mode in ("lsl", "real", "muse", "device"):
        # Imported lazily so that simulation mode never needs the native
        # liblsl library (installed via Homebrew) to be present.
        from .lsl_source import LSLSource
        return LSLSource()
    raise ValueError(f"Unknown data source mode: {mode!r} (use 'sim' or 'lsl')")


__all__ = ["DataSource", "SampleBatch", "SimulatedSource", "create_source"]
