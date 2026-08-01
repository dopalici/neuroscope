# NeuroScope

**Real-time consumer EEG dashboard for Muse 2** — live spectral analysis, cognitive-state heuristics, artifact detection, a simple neurofeedback loop, and **Mirror**: a full-screen self-video degraded by brain signal in real time. Built for learning, exploration, and personal trend-watching — not clinical use.

```
Muse 2 ──BT──► muselsl ──LSL──► Python (numpy / scipy) ──WebSocket──► React
                 (or SimulatedSource when no headband)
                                              └─ /mirror  (camera stays in-browser)
```

---

## Summary

NeuroScope is an open, end-to-end pipeline that turns a **Muse 2** headband into a live neuroscience dashboard — and, in vol0.2, into **Mirror**, a Terra-palette instrument that uses the same live indices to softly degrade your webcam image.

It streams four-channel EEG (TP9, AF7, AF8, TP10 at 256 Hz), optional PPG, and IMU over **Lab Streaming Layer (LSL)**, then runs a transparent signal-processing stack: bandpass filtering, **Welch** band-power estimates (δ–γ) on a ~2 s window, a short per-channel **RMS envelope**, contact-quality checks, blink/jaw artifact detectors, PPG **beat timestamps**, and a handful of widely used but **non-clinical** indices (β/α focus ratio, relative-α calm, frontal alpha asymmetry). A React frontend renders scrolling traces, band meters, heart/motion panels, an alpha-driven neurofeedback bloom, and the Mirror route. The WebSocket stream is owned by a shared `museBus` so the dashboard (~10 Hz React) and Mirror’s 60 fps GL loop can both read the newest frame without fighting over the socket.

A full **simulation mode** runs with no hardware, so the stack is demable and developable without a headband — including Mirror with a live camera and synthetic EEG.

| | |
|---|---|
| **Hardware** | Interaxon Muse 2 (4 dry EEG + PPG + IMU) |
| **Acquisition** | `muselsl` → LSL (`pylsl`) |
| **Processing** | Python 3.11/3.12 · NumPy · SciPy |
| **Serving** | FastAPI · async WebSocket (~10 Hz frames) |
| **UI** | React · TypeScript · Vite · WebGL Mirror · MediaPipe hands |

---

## What this is / what this is not

**This is**
- A reproducible real-time EEG visualization and teaching tool
- A clean reference pipeline: LSL in → filters / Welch / indices → WebSocket out
- An experimental Mirror: clean self-image as reward; signal degrades the picture
- Honest about consumer EEG limits (montage, SNR, dry electrodes)

**This is not**
- A medical device, diagnostic instrument, or clinical BCI
- A substitute for research-grade caps (64+ channels, wet electrodes, occipital coverage)
- A claim that focus / calm / FAA scores generalize across people
- A claim that Mirror “trains attention” or that photographic degradation equals cognitive state

Heuristic indices are for **within-session personal trends** only. The UI surfaces credibility notes next to each metric for that reason. Mirror’s slow effects are z-scores against **your** baseline for the same reason.

---

## Metrics & methods

| Module | Method | Notes |
|--------|--------|--------|
| Raw EEG display | 4th-order Butterworth bandpass 1–44 Hz | Matches Muse usable band; cuts DC drift & mains-adjacent noise |
| Band power | Welch PSD · ~2 s window · Simpson integration | δ 1–4 · θ 4–8 · α 8–13 · β 13–30 · γ 30–44 Hz |
| RMS envelope | ~100 ms per-channel RMS on cleaned EEG | Fast tier for Mirror shimmer; not a band estimate |
| Contact quality | Per-channel stddev (µV) thresholds | Flatline / rail → poor contact |
| Focus index | Mean β / mean α across channels | Engagement heuristic; not attention ground truth |
| Calm index | Relative α (α / total band power) | Eyes-closed α rise is the classic intuition |
| Frontal α asymmetry | `ln(α_AF8) − ln(α_AF7)` | Approach/withdrawal literature proxy; **very noisy** on 4 dry electrodes |
| Blink / jaw | Frontal low-freq deflection · temporal high-freq EMG | Artifact flags, not intended as primary features |
| Heart / HRV | PPG peak detection (64 Hz) + beat timestamps | Requires `muselsl stream --ppg`; beats drive Mirror pulse timing |
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

From the topbar you can also **Enter Mirror** (full-screen `/mirror`) or enable **Gesture control** (camera on with indicator) so the open-window hand gesture can pull Mirror open without leaving the dashboard first.

---

## Mirror

Mirror is a full-screen route at **`/mirror`**. Organizing rule: **a clean image is the reward**; live Muse-derived signal degrades your self-video. The look is soft photographic degradation (drift, soft focus, vignette, trail) — not a gamified glitch aesthetic. Heartbeat “zoom” is near-zero and vignette-led.

### Entering and leaving

| Path | How |
|------|-----|
| Button | Topbar **Enter Mirror** on the dashboard |
| Gesture | Enable **Gesture control** (shows **● camera on**), then pinch both hands and **pull apart** (open window). Pinch both and **push together** to close. |
| URL | Open `http://127.0.0.1:5173/mirror` directly |
| Leave | **← Dashboard**, open-window close gesture, or **Esc** |

Gesture control is an explicit opt-in: the project does not start a camera until you ask. On the dashboard, only the hand worker runs (no GL). Inside Mirror, hands stay available if you entered via the gesture.

### Baseline & mapping

Slow Mirror effects (drift, wander, ease, lean, …) are **z-scores against your own baseline**, not fixed cut-offs. Run **Baseline** (or press **c**): ~60 s in three phases — eyes-open rest, eyes-closed, arithmetic. Until you calibrate, Mirror uses a session estimate and shows **UNCALIBRATED · session baseline**.

**Artifact veto:** lost contact, head motion, jaw EMG, blinks, or a stale stream raise fog / “signal interrupted” and **freeze** coherence rather than treating noise as inattention. Fog means the signal is unusable — not that you are unfocused.

Two drive tiers:

- **Instant** (under 100 ms): blink → shutter · clench → soft radial push · RMS envelope → edge shimmer  
- **Slow** (1–3 s): drift · wander · ease · pulse · lean · tilt — structurally behind the person because band powers come from a **~2 s Welch** window. The HUD legend prints that window length on purpose.

### HUD (Terra instrument)

Same soil / moss / ochre / clay / rust language as the dashboard — hairline rules and mono readouts, not neon chrome:

- **Coherence arc** — engagement relative to your baseline  
- **Band strip** + **contact head** — rhythm share and pad quality  
- **Heart** — PPG rate / HRV when available  
- **Event ticker** — blink / clench markers  
- **Legend** — dominant effect ← driver (±σ) · **window latency stated in seconds**  
- Privacy line on the glass: camera and hand tracking stay in the tab; they never hit the Python backend

### Recording (client-side only)

**Record** (or **r**) captures the Mirror canvas in-browser via `MediaRecorder`, with a **JSONL sidecar** (indices, drives, params per frame). After stop, scrub-back lets you jump the timeline by the coherence ribbon and download video + JSONL. Nothing is uploaded; recordings write to your machine only.

### Hand gestures (five)

| # | Gesture | Action |
|---|---------|--------|
| 1 | Two-hand **open window** | Pinch both · pull apart → open Mirror · push together → close |
| 2 | **Pinch-drag** | One hand grabs / drags the nearest control (or XY pad axes) |
| 3 | Two-hand **rotate** | Turns grade hue (`[` / `]` on the keyboard) |
| 4 | **Open palm** ~800 ms | Toggles the HUD |
| 5 | **Index point** ~600 ms dwell | Clicks whatever is under the reticle |

### Param panel

**Params** (or **p**) opens a TouchDesigner-style graph: bind parameters to signal drives, gesture axes, or manual values; XY pad; presets. Optional **Sham** (**s**) plays delayed/scrambled scalars so the picture still moves but causality to your live brain is broken — useful for demos and for noticing placebo.

### Keyboard (Mirror)

`Esc` exit · `h` HUD · `p` params · `r` record · `c` baseline · `s` sham · `d` dev overlay · `g` hands · `[` `]` hue

### Without a headband

Start the backend in simulation (default) and the frontend as usual. Mirror still opens the camera; EEG/PPG/IMU are synthetic (**SIM**). Use **Sham** if you want motion without pretending the live stream is yours. Real Muse: same as the dashboard (`./run_backend.sh lsl` + `muselsl stream --ppg --acc --gyro`).

### Honest limits

- Muse montage and dry-electrode SNR still apply; Mirror does not invent occipital alpha.  
- Slow-tier latency is structural (~2 s Welch), not a bug the UI hides.  
- Hand tracking needs decent lighting, a front camera, and a secure context (localhost or HTTPS); models are fetched from `frontend/public/mediapipe/`.  
- Not medical; not a treatment; not evidence that looking clearer means “better focus.”

---

## Visual language

The interface is built as an instrument rather than a clinical readout. A neutral
earth-tone palette (soil, moss, ochre, clay, rust) is driven directly by the signal:
the background gradient and a single **state word** in the top right both express
whatever the section you're reading is measuring, and they crossfade as the signal
moves.

| Section | Reads | Words |
|---------|-------|-------|
| Signal | contact quality across the four pads | Drifting · Settling · Seated · Clear |
| Bands | which rhythm leads, vs a typical 1/f profile | Deep · Drift · Open · Sharp · Bright |
| Focus | β/α engagement against relative-α rest | Adrift · Soft · Even · Engaged · Charged |
| Body | blink and jaw EMG events | Still · Blink · Clench · Restless |
| Heart | PPG rate alongside head motion | Listening · Settled · Steady · Stirring · Racing |
| Feedback | the calm index driving the bloom | Quiet · Easing · Opening · Blooming |

Clicking the word opens a panel on the right — the page gives up that strip rather
than being covered — holding the state as it read *at the moment of the click*. It
shows the measure and its formula, the live numbers behind it, what is physically
happening to produce that ratio (thalamocortical alpha gating, alpha blocking,
ocular dipoles, jaw EMG, vagal modulation of the sinoatrial node), and what the
reading cannot tell you.

The words are **interpretive readings of the numbers already on screen** — a
different expression of the same values, never a substitute for them and never a
diagnosis. Weak or absent signal resolves to a genuinely neutral state rather than
inventing one.

Implementation notes: colour is interpolated in a single `requestAnimationFrame`
loop that writes CSS custom properties to a few registered elements, so the 10 Hz
data stream and scrolling never compete for React renders. Gradient layers are flat
colours pulled through static masks — recolouring repaints a solid fill instead of
re-rasterising a gradient — and the slow drift is transform-only. The active section
is tracked with an `IntersectionObserver`, not a scroll listener. Mirror reuses the
same atmosphere colours (focus section) on the instrument HUD.

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
Mirror: **Enter Mirror** or **http://127.0.0.1:5173/mirror** (allow the camera when prompted).  
Health check: `curl http://127.0.0.1:8000/api/health`

If hand models are missing under `frontend/public/mediapipe/`, run `frontend/scripts/fetch-mediapipe.sh` once.

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
- PPG + IMU need `--ppg --acc --gyro`; without them, heart/motion panels and Mirror pulse stay empty or flat.
- If `pylsl` can’t find `liblsl`, set `DYLD_LIBRARY_PATH=/opt/homebrew/lib` (`run_backend.sh` does this).

---

## Project structure

```
neuroscope/
├── backend/                 # FastAPI + WebSocket + signal processing
│   ├── server.py
│   ├── config.py            # sample rates, band edges, envelope, beat history
│   ├── sources/             # SimulatedSource | LSLSource
│   └── processing/          # filters, bands, indices, artifacts, heart, motion
├── frontend/
│   ├── public/mediapipe/    # WASM + hand / face models (fetched locally)
│   ├── scripts/             # fetch-mediapipe.sh, smoke checks
│   └── src/
│       ├── App.tsx          # dashboard + Enter Mirror / Gesture control
│       ├── Root.tsx         # / vs /mirror routing
│       ├── routes.ts
│       ├── state/
│       │   ├── museBus.ts   # shared WebSocket + ring buffers
│       │   └── mirror/      # baseline, mapping, params, recorder, aperture
│       └── mirror/          # MirrorRoute, GL, HUD, hands, calibrate, scrub
├── requirements.txt
├── run_backend.sh
└── run_frontend.sh
```

Official Interaxon LibMuse / MuseLab packages are **not** part of this repo and are not required. Live acquisition uses the open stack **muselsl + pylsl/LSL**. Camera frames never leave the browser.

---

## Configuration

| Knob | Where |
|------|--------|
| Sample rates, band edges, quality / blink / jaw thresholds | `backend/config.py` |
| Welch window, RMS envelope length, beat history | `backend/config.py` |
| Simulated band amplitudes | `SIM_ALPHA` / `SIM_BETA` env vars |
| Data source | `NEUROSCOPE_SOURCE=sim\|lsl` |

---

## Simulation vs hardware

| Feature | Simulation | Real Muse 2 |
|---------|------------|-------------|
| Raw EEG + quality | synthetic | live |
| Band powers / focus / calm / FAA | yes | yes |
| RMS envelope / PPG beats | synthetic | live (PPG needs `--ppg`) |
| Blink / jaw | injected events | yes |
| Heart rate / HRV | synthetic PPG | needs `--ppg` |
| Motion / posture | synthetic IMU | needs `--acc --gyro` |
| Neurofeedback bloom | drifting alpha | live alpha |
| Mirror (camera + mapping) | yes (SIM EEG) | yes (live EEG) |
| Mirror sham / client record | yes | yes |

---

## Citing

If you use NeuroScope in research, teaching, or derived work, please cite it.
GitHub’s “Cite this repository” button uses [`CITATION.cff`](./CITATION.cff).

```bibtex
@software{Ozkan_NeuroScope_2026,
  author  = {Ozkan, Enes},
  title   = {{NeuroScope}: Real-time Muse 2 EEG Dashboard},
  year    = {2026},
  version = {0.1.0},
  url     = {https://github.com/dopalici/neuroscope}
}
```

---

## Disclaimer

Educational and research-exploration tooling only. **Not a medical device.** Heuristic indices are for personal trends within a session, not diagnosis, screening, or between-subject comparison. Mirror is an experimental visualization, not a therapy or attention trainer.
