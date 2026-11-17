# NeuroScope Frontend

React + TypeScript + Vite client for the [NeuroScope](../README.md) real-time EEG dashboard.

## Scripts

```bash
npm install
npm run dev      # Vite dev server on :5173 (proxies /api and /ws to :8000)
npm run lint     # Oxlint static checks
npm run build    # TypeScript type-check (tsc -b) + production bundle
```

See the root [`README.md`](../README.md) for the signal-processing pipeline, neurophysiological scope, and full setup instructions.
