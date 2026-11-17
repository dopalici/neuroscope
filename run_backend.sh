#!/usr/bin/env bash
# Start the NeuroScope backend.
#   ./run_backend.sh          -> simulation mode (no hardware needed)
#   ./run_backend.sh lsl      -> real Muse 2 via muselsl / LSL
set -euo pipefail
cd "$(dirname "$0")"

SOURCE="${1:-${NEUROSCOPE_SOURCE:-sim}}"

# So pylsl can find the native liblsl installed by Homebrew (real mode only).
export DYLD_LIBRARY_PATH="${DYLD_LIBRARY_PATH:+$DYLD_LIBRARY_PATH:}/opt/homebrew/lib"

exec .venv/bin/python -m backend.server --source "$SOURCE"
