import * as React from 'react'
import { cn } from '../lib/cn.js'
import { Collapsible } from '../motion/collapsible.js'
import { Shake } from '../motion/shake.js'
import { AnimatedCheck } from '../motion/animated-check.js'

export interface FieldProps {
  label: string
  htmlFor: string
  children: React.ReactNode
  hint?: string
  className?: string
  /** The inline validation message. Passing it slides the message in under the control and shakes
   * the control once — the two halves of "no, not that" (DESIGN.md §10, and `<Shake>`'s own doc).
   * A new message while one is already showing shakes again: two rejected attempts in a row are two
   * refusals, not one. */
  error?: string | null | undefined
  /** Flip on for a beat after this one field saves (an inline-edited property, an autosaving
   * setting) to draw a check beside the label. The caller resets it — a field does not decide how
   * long "saved" is true. */
  saved?: boolean
}

/** A label + control + optional hint, stacked. Promoted out of the `ai` and `events` feature
 * folders that each built this wrapper independently -- the signal that it belongs here rather
 * than a third time.
 *
 * v1.1 motion pass: the error and success states moved *into* it. Every form in the product was
 * rendering its own `<p className="text-small text-destructive">` that simply appeared, pushing the
 * rest of the form down by a line with no transition and no signal that the field itself was the
 * one at fault. Here the message has a height animation, the control has the product's one refusal
 * gesture, and `aria-describedby`/`role="alert"` are wired once instead of per form. */
export function Field({
  label,
  htmlFor,
  children,
  hint,
  className,
  error,
  saved = false,
}: FieldProps): React.JSX.Element {
  const hintId = `${htmlFor}-hint`
  const errorId = `${htmlFor}-error`
  const [shake, setShake] = React.useState(false)

  // Fire on every *new* message, including a second rejection carrying the same text as the first
  // (a retry that failed identically still deserves an answer) -- so the effect keys on the message
  // transitioning from absent to present, and on the text changing.
  const previousError = React.useRef<string | null | undefined>(error)
  React.useEffect(() => {
    const had = previousError.current
    previousError.current = error
    if (error && (!had || had !== error)) {
      setShake(false)
      const raf = requestAnimationFrame(() => setShake(true))
      return () => cancelAnimationFrame(raf)
    }
    return undefined
  }, [error])

  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 text-small font-medium text-foreground"
      >
        {label}
        {saved ? <AnimatedCheck checked className="size-3.5 text-success" /> : null}
      </label>
      <Shake play={shake} onDone={() => setShake(false)}>
        {/* `aria-describedby` is applied to the wrapper rather than cloned onto the control: the
            control is whatever the caller passed (an Input, a Combobox, a group of radios), and
            reaching into it would break every one of those that already sets its own. Callers that
            need the association on the control itself pass `aria-describedby` there too; this id is
            stable and derived from `htmlFor`. */}
        <div {...(described ? { 'aria-describedby': described } : {})}>{children}</div>
      </Shake>
      {hint ? (
        <p id={hintId} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <Collapsible open={Boolean(error)} id={errorId}>
        <p role="alert" className="pt-0.5 text-small text-destructive">
          {error}
        </p>
      </Collapsible>
    </div>
  )
}
