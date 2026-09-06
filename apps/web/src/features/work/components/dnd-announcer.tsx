// One shared `aria-live="polite"` region for every drag-and-drop move on the People board (TECH-SPEC
// §5: "drag between columns works with mouse and keyboard with live announcements"), mounted once by
// `BoardScreen` so a mouse drop and a keyboard "Move to" both funnel through the same
// `announce(message)` call -- a screen-reader user hears the identical sentence regardless of which
// input method moved the card.
import * as React from 'react'

const AnnounceContext = React.createContext<(message: string) => void>(() => {})

export function DndAnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState('')

  const announce = React.useCallback((next: string) => {
    // Clearing first, then setting on the next frame, guarantees a screen reader re-announces even
    // when two consecutive moves produce the exact same sentence (e.g. two cards moved to the same
    // column back to back) -- a live region only fires on a genuine text change.
    setMessage('')
    requestAnimationFrame(() => setMessage(next))
  }, [])

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>
    </AnnounceContext.Provider>
  )
}

export function useAnnounce(): (message: string) => void {
  return React.useContext(AnnounceContext)
}
