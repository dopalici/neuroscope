# NeuroScope

**Real-time consumer EEG dashboard for Muse 2** — live spectral analysis, cognitive-state heuristics, artifact detection, and a simple neurofeedback loop. Built for learning, exploration, and personal trend-watching — not clinical use.

```
Muse 2 ──BT──► muselsl ──LSL──► Python (numpy / scipy) ──WebSocket──► React
                 (or SimulatedSource when no headband)
```

---

## Summary

NeuroScope is an open, end-to-end pipeline that turns a **Muse 2** headband into a live neuroscience dashboard.

It streams four-channel EEG (TP9, AF7, AF8, TP10 at 256 Hz), optional PPG, and IMU over **Lab Streaming Layer (LSL)**, then runs a transparent signal-processing stack: bandpass filtering, **Welch** band-power estimates (δ–γ), contact-quality checks, blink/jaw artifact detectors, and a handful of widely used but **non-clinical** indices (β/α focus ratio, relative-α calm, frontal alpha asymmetry). A React frontend renders scrolling traces, band meters, heart/motion panels, and an alpha-driven neurofeedback bloom.

A full **simulation mode** runs with no hardware, so the stack is demable and developable without a headband.

| | |
|---|---|
| **Hardware** | Interaxon Muse 2 (4 dry EEG + PPG + IMU) |
| **Acquisition** | `muselsl` → LSL (`pylsl`) |
| **Processing** | Python 3.11/3.12 · NumPy · SciPy |
| **Serving** | FastAPI · async WebSocket (~10 Hz frames) |
| **UI** | React · TypeScript · Vite |

---

## What this is / what this is not

**This is**
- A reproducible real-time EEG visualization and teaching tool
- A clean reference pipeline: LSL in → filters / Welch / indices → WebSocket out
- Honest about consumer EEG limits (montage, SNR, dry electrodes)

**This is not**
- A medical device, diagnostic instrument, or clinical BCI
- A substitute for research-grade caps (64+ channels, wet electrodes, occipital coverage)
- A claim that focus / calm / FAA scores generalize across people

Heuristic indices are for **within-session personal trends** only. The UI surfaces credibility notes next to each metric for that reason.

---

## Metrics & methods

| Module | Method | Notes |
|--------|--------|--------|
| Raw EEG display | 4th-order Butterworth bandpass 1–44 Hz | Matches Muse usable band; cuts DC drift & mains-adjacent noise |
| Band power | Welch PSD · ~1 s segments · Simpson integration | δ 1–4 · θ 4–8 · α 8–13 · β 13–30 · γ 30–44 Hz |
| Contact quality | Per-channel stddev (µV) thresholds | Flatline / rail → poor contact |
| Focus index | Mean β / mean α across channels | Engagement heuristic; not attention ground truth |
| Calm index | Relative α (α / total band power) | Eyes-closed α rise is the classic intuition |
| Frontal α asymmetry | `ln(α_AF8) − ln(α_AF7)` | Approach/withdrawal literature proxy; **very noisy** on 4 dry electrodes |
| Blink / jaw | Frontal low-freq deflection · temporal high-freq EMG | Artifact flags, not intended as primary features |
| Heart / HRV | PPG peak detection (64 Hz) | Requires `muselsl stream --ppg` |
| Motion / posture | Accel + gyro (52 Hz) | Requires `--acc --gyro` |

**Muse 2 montage caveat:** there is no occipital electrode. Classic posterior resting-state alpha is weaker than on a research cap; frontal AF7/AF8 sit over eye and forehead muscle, so ocular and EMG contamination are expected and handled explicitly.

---

## Dashboard sections

1. **Signal Quality & Raw EEG** — contact lights + scrolling 4-channel traces  
2. **Brainwave Bands** — delta → gamma power meters  
3. **Focus & Relaxation** — β/α, relative-α, FAA  
4. **Body Signals from Noise** — blink & jaw (EMG) detectors  
5. **Heart & Motion** — PPG HR/HRV + IMU posture/motion  
6. **Neurofeedback Demo** — alpha/calm-driven visual bloom  

Each panel includes a short explainer and a credibility note.

---

## Quick start (simulation — no Muse)

Requires **Python 3.11 or 3.12** (not 3.14) and **Node.js 18+**.

```bash
# Backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
./run_backend.sh                  # or: .venv/bin/python -m backend.server

# Frontend (second terminal)
cd frontend && npm install && npm run dev
```

Open **http://127.0.0.1:5173** — you should see a **SIM** badge and live graphs.  
Health check: `curl http://127.0.0.1:8000/api/health`

---

## Real Muse 2 (macOS, Apple Silicon OK)

1. Put Muse 2 in pairing mode; enable Bluetooth.
2. Install native LSL: `brew install labstreaminglayer/tap/lsl`  
   Then: `export DYLD_LIBRARY_PATH=/opt/homebrew/lib`
3. Stream (venv activated, separate terminal):

   ```bash
   muselsl list
   muselsl stream --ppg --acc --gyro
   ```

4. Backend in LSL mode: `./run_backend.sh lsl`  
   (or `NEUROSCOPE_SOURCE=lsl .venv/bin/python -m backend.server`)
5. Start the frontend — status should show **Muse 2 (LSL)** without the SIM badge.

**Notes**
- Only one BLE client at a time (don’t also run Muse app / Muse Direct / MuseLab).
- PPG + IMU need `--ppg --acc --gyro`; without them, heart/motion panels stay empty.
- If `pylsl` can’t find `liblsl`, set `DYLD_LIBRARY_PATH=/opt/homebrew/lib` (`run_backend.sh` does this).

---

## Project structure

```
neuroscope/
├── backend/                 # FastAPI + WebSocket + signal processing
│   ├── server.py
│   ├── config.py            # sample rates, band edges, thresholds
│   ├── sources/             # SimulatedSource | LSLSource
│   └── processing/          # filters, bands, indices, artifacts, heart, motion
├── frontend/                # Vite + React + TypeScript
├── requirements.txt
├── run_backend.sh
└── run_frontend.sh
```

Official Interaxon LibMuse / MuseLab packages are **not** part of this repo and are not required. Live acquisition uses the open stack **muselsl + pylsl/LSL**.

---

## Configuration

| Knob | Where |
|------|--------|
| Sample rates, band edges, quality / blink / jaw thresholds | `backend/config.py` |
| Simulated band amplitudes | `SIM_ALPHA` / `SIM_BETA` env vars |
| Data source | `NEUROSCOPE_SOURCE=sim\|lsl` |

---

## Simulation vs hardware

| Feature | Simulation | Real Muse 2 |
|---------|------------|-------------|
| Raw EEG + quality | synthetic | live |
| Band powers / focus / calm / FAA | yes | yes |
| Blink / jaw | injected events | yes |
| Heart rate / HRV | synthetic PPG | needs `--ppg` |
| Motion / posture | synthetic IMU | needs `--acc --gyro` |
| Neurofeedback bloom | drifting alpha | live alpha |

---

## Disclaimer

Educational and research-exploration tooling only. **Not a medical device.** Heuristic indices are for personal trends within a session, not diagnosis, screening, or between-subject comparison.
