import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function getSnapshot(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

/** design.md §4(g), §8.6. `navigator.onLine` is the real, live signal `OfflineBanner` and the
 * per-route offline `<StateView>` render from -- `?__state=offline` (behind `DEVON_E2E`) overrides it
 * for forced screenshots, it does not replace it. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}
