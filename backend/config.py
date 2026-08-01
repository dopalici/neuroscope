"""Central configuration and hardware facts for the Muse 2 headband.

These constants are the single source of truth for the whole backend. They are
deliberately verbose and commented because they encode real hardware facts that
are easy to get wrong.
"""

# --- Muse 2 EEG electrodes ------------------------------------------------
# The Muse 2 has exactly FOUR EEG electrodes, sampled at 256 Hz.
# Their names follow the international 10-20 system:
#   TP9  - behind the LEFT ear   (temporal/parietal)
#   AF7  - LEFT forehead         (frontal, sits over eye muscles)
#   AF8  - RIGHT forehead        (frontal, sits over eye muscles)
#   TP10 - behind the RIGHT ear  (temporal/parietal)
# The reference electrode sits near Fpz (center forehead).
# There is NO occipital (back-of-head) electrode, so "classic" resting alpha
# is weaker than on a research cap. The frontal electrodes sit right over the
# eye and forehead muscles, so blinks and jaw clenches show up strongly.
EEG_CHANNELS = ["TP9", "AF7", "AF8", "TP10"]
EEG_SAMPLE_RATE = 256.0  # Hz

# Which channels are "frontal" (used for blink detection & alpha asymmetry)
FRONTAL_CHANNELS = ["AF7", "AF8"]
# Which channels are "temporal" (used for jaw-clench / muscle detection)
TEMPORAL_CHANNELS = ["TP9", "TP10"]

# --- PPG (heart) and IMU (motion) ----------------------------------------
PPG_SAMPLE_RATE = 64.0   # Hz  (optical blood-flow sensor -> heart rate / HRV)
IMU_SAMPLE_RATE = 52.0   # Hz  (accelerometer + gyroscope)

# --- Frequency bands (Hz) -------------------------------------------------
# Standard clinical band edges. Gamma on the Muse is capped at 44 Hz because
# above that it is dominated by muscle noise and the 60 Hz mains line.
BANDS = {
    "delta": (1.0, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 13.0),
    "beta": (13.0, 30.0),
    "gamma": (30.0, 44.0),
}

# --- Signal-processing windows -------------------------------------------
# We compute band power with Welch's method on a sliding window.
# 2 seconds at 256 Hz = 512 samples -> ~0.5 Hz frequency resolution.
WINDOW_SECONDS = 2.0
WINDOW_SAMPLES = int(WINDOW_SECONDS * EEG_SAMPLE_RATE)  # 512

# How often we recompute metrics and push a frame to the browser.
UPDATE_RATE_HZ = 10.0

# How many seconds of raw EEG the frontend scrolling traces show.
RAW_DISPLAY_SECONDS = 4.0

# Welch over 2 s cannot describe anything faster than about half a second, so a
# short RMS envelope is computed alongside it. 100 ms is long enough to average
# out a single 44 Hz cycle and short enough to still contain a blink's rising
# edge, which is what a 60 fps consumer needs.
ENVELOPE_SECONDS = 0.1
ENVELOPE_SAMPLES = int(ENVELOPE_SECONDS * EEG_SAMPLE_RATE)  # 25

# How far back PPG beat timestamps are reported. The PPG ring is 8 s long, so
# anything older than this has already fallen out of the detection window.
BEAT_HISTORY_SECONDS = 8.0

# --- Bandpass filter for the raw display / processing ---------------------
FILTER_LOW = 1.0    # Hz  (removes slow drift / DC)
FILTER_HIGH = 44.0  # Hz  (removes high-frequency muscle noise & mains)
FILTER_ORDER = 4

# --- Contact-quality thresholds (in microvolts of stddev) -----------------
# A well-seated electrode on a resting person sits roughly in the tens of uV.
# A floating / off-head electrode either flat-lines (near 0) or rails (huge).
QUALITY_GOOD_MAX_UV = 45.0    # <= this stddev  -> green
QUALITY_OK_MAX_UV = 90.0      # <= this stddev  -> amber, else red
QUALITY_FLAT_MIN_UV = 0.3     # < this stddev   -> red (dead / disconnected)

# --- Artifact detection thresholds ---------------------------------------
# Blinks are large, slow (<4 Hz) deflections on the frontal electrodes.
BLINK_THRESHOLD_UV = 90.0
# Jaw clenches are bursts of high-frequency (>20 Hz) EMG on temporal channels.
JAW_THRESHOLD_UV = 28.0

# --- Heart-rate bounds (sanity clamp for PPG peak detection) --------------
HR_MIN_BPM = 40.0
HR_MAX_BPM = 180.0

# --- WebSocket server -----------------------------------------------------
SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8000
