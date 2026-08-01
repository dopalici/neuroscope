/**
 * Path routing, ~one screenful of it.
 *
 * Hash routing would have been smaller still, but the dashboard already spends
 * the hash on section anchors (`#signal`, `#bands`, …), so a hash router would
 * fight the nav. Vite's dev server and `vite preview` both do SPA fallback, so
 * a real path works without any server change.
 */
import { useEffect, useState } from 'react'

export type Route = 'dashboard' | 'mirror'

const PATHS: Record<Route, string> = {
  dashboard: '/',
  mirror: '/mirror',
}

export function routeOf(pathname: string): Route {
  return pathname.replace(/\/+$/, '') === '/mirror' ? 'mirror' : 'dashboard'
}

export function navigate(route: Route): void {
  const path = PATHS[route]
  if (window.location.pathname === path) return
  // Section anchors are per-page state; carrying one across a route would scroll
  // the new page to an element that does not exist on it.
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.pathname))

  useEffect(() => {
    const sync = () => setRoute(routeOf(window.location.pathname))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  return route
}
