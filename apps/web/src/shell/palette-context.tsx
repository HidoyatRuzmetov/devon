// Lets a route's own content (e.g. Home's empty-state "Qidirishni ochish" button, design.md §6.1)
// open the command palette that `AppShell` owns, without prop-drilling a callback through every
// route and without a global DOM event bus. `AuthShell` renders no provider (`/login`/`/setup` mount
// no palette, per its own file comment), so `usePalette()` there is intentionally a no-op.
import * as React from 'react'

const PaletteContext = React.createContext<() => void>(() => {})

export function PaletteProvider({
  onOpen,
  children,
}: {
  onOpen: () => void
  children: React.ReactNode
}) {
  return <PaletteContext.Provider value={onOpen}>{children}</PaletteContext.Provider>
}

export function useOpenPalette(): () => void {
  return React.useContext(PaletteContext)
}
