import * as React from 'react'
import { cn } from '../lib/cn.js'

export interface FieldProps {
  label: string
  htmlFor: string
  children: React.ReactNode
  hint?: string
  className?: string
}

/** A label + control + optional hint, stacked. Promoted out of the `ai` and `events` feature
 * folders that each built this wrapper independently -- the signal that it belongs here rather
 * than a third time. */
export function Field({
  label,
  htmlFor,
  children,
  hint,
  className,
}: FieldProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-small font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
