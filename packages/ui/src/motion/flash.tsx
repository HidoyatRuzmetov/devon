import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotion } from '../lib/use-reduced-motion.js'
import { cn } from '../lib/cn.js'
import { S_STANDARD, S_PAGE, EASE_OUT, EASE_STANDARD } from './tokens.js'

// Named for what the wash *means* at the call site, not for the token behind it: `saved` is the
// receipt for a write that landed (which is exactly the success/on-track meaning DESIGN.md §2.1
// reserves green for), `changed` is a neutral "this moved", `attention` is "and it needs a look".
const TONE_CLASS = {
  changed: 'bg-primary/18',
  saved: 'bg-success/20',
  attention: 'bg-attention/25',
} as const

export interface FlashOnChangeProps {
  /** The value being watched. When it changes to something different, the wash plays once. The very
   * first render never flashes — arriving is not a change. */
  value: string | number | boolean | null | undefined
  children: React.ReactNode
  className?: string
  tone?: keyof typeof TONE_CLASS
  /** Off while a screen is still filling in (a query settling, a form resetting), so a batch of
   * values landing at once does not read as a batch of edits. */
  enabled?: boolean
}

/** An optimistic write's *receipt*: the property that just changed lights for a beat, so the person
 * can see which of the twelve things on the card actually moved. Paired with `<Shake>` — the flash
 * says "taken", the shake says "put back" — which is the whole optimistic contract in two gestures.
 *
 * The wash is an absolutely-positioned, pointer-transparent overlay animating **opacity only**, so
 * it costs no layout and no paint of the content beneath it. It never changes the element's size,
 * which is why a value that grows from `3` to `11` does not jump while it flashes.
 *
 * **Reduced motion keeps the wash** — it is a colour change, not travel — but holds it longer and
 * fades it out gently, so it registers without ever reading as movement. */
export function FlashOnChange({
  value,
  children,
  className,
  tone = 'changed',
  enabled = true,
}: FlashOnChangeProps): React.JSX.Element {
  const reduced = useReducedMotion()
  const [flashId, setFlashId] = React.useState(0)
  const previous = React.useRef(value)
  const mounted = React.useRef(false)

  React.useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      previous.current = value
      return
    }
    if (!enabled) {
      previous.current = value
      return
    }
    if (!Object.is(previous.current, value)) {
      previous.current = value
      setFlashId((n) => n + 1)
    }
  }, [value, enabled])

  return (
    <span className={cn('relative inline-flex', className)}>
      {children}
      <AnimatePresence>
        {flashId > 0 ? (
          <motion.span
            key={flashId}
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute -inset-x-1 -inset-y-0.5 rounded-sm',
              TONE_CLASS[tone],
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{
              duration: reduced ? S_PAGE * 2 : S_STANDARD * 2.5,
              ease: reduced ? EASE_STANDARD : EASE_OUT,
              times: [0, 0.18, 1],
            }}
          />
        ) : null}
      </AnimatePresence>
    </span>
  )
}
