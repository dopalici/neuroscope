import { Suspense, lazy } from 'react'
import App from './App'
import { useRoute } from './routes'

// The mirror pulls in a WebGL chain and, once gestures are on, a few megabytes
// of hand-tracking model. None of that should land on someone who only opened
// the dashboard.
const MirrorRoute = lazy(() =>
  import('./mirror/MirrorRoute').then((m) => ({ default: m.MirrorRoute })),
)

export function Root() {
  const route = useRoute()
  if (route !== 'mirror') return <App />
  return (
    <Suspense fallback={<div className="mirror-boot">opening mirror…</div>}>
      <MirrorRoute />
    </Suspense>
  )
}
