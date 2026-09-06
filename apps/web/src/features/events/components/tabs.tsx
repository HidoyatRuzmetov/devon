// A minimal, dependency-free tab strip for the event detail dialog (`@devon/ui` ships no `Tabs`
// primitive yet -- same "keep it local until it's shared" call `form-controls.tsx` already makes).
// Roving-tabindex keyboard behaviour per WAI-ARIA APG: arrow left/right moves focus and selection,
// Home/End jump to the first/last tab.
import * as React from 'react'
import { cn } from '@devon/ui'

export type TabItem = { id: string; label: string; badge?: number | undefined }

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: readonly TabItem[]
  value: string
  onChange: (id: string) => void
}) {
  const refs = React.useRef(new Map<string, HTMLButtonElement>())

  const focusAndSelect = (id: string) => {
    onChange(id)
    refs.current.get(id)?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusAndSelect(items[(index + 1) % items.length]!.id)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusAndSelect(items[(index - 1 + items.length) % items.length]!.id)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAndSelect(items[0]!.id)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAndSelect(items[items.length - 1]!.id)
    }
  }

  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border pb-0">
      {items.map((item, index) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            ref={(el) => {
              if (el) refs.current.set(item.id, el)
              else refs.current.delete(item.id)
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-t-sm border-b-2 px-3 py-2 text-small font-medium',
              'transition-colors duration-(--dur-micro) ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              selected
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.badge ? (
              <span className="ml-1.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-muted px-1 text-caption text-muted-foreground">
                {item.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
