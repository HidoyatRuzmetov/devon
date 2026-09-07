// The floating card preview a touch drag renders while it is in progress (item 9's touch path --
// `card-tile.tsx`'s pointer handlers, `lib/touch-drag.ts`'s shared state). Portalled straight to
// `document.body` so no ancestor's `overflow`/`transform` can clip or misplace it, and driven by
// `motion`'s `springDrag` token (DESIGN.md's own "pointer-following drag" spring) so the preview
// visibly trails the finger instead of snapping to it -- the same physics the enhanced desktop
// native-drag-image gets via the browser's own pointer tracking.
import * as React from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { springDrag, useReducedMotion } from '@devon/ui'
import { useTouchDragState } from '../lib/touch-drag.js'

export function TouchDragPreviewLayer() {
  const state = useTouchDragState()
  const reduced = useReducedMotion()
  if (typeof document === 'undefined' || !state) return null
  return createPortal(
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-50 max-w-56 rounded-md border border-border bg-card px-3 py-2 text-small font-medium text-foreground opacity-90 shadow-2"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ x: state.pointerX + 16, y: state.pointerY + 16, opacity: 0.92, scale: 1 }}
      transition={reduced ? { duration: 0 } : springDrag}
    >
      <span className="block truncate">{state.title}</span>
    </motion.div>,
    document.body,
  )
}
