import { Globe } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../primitives/dropdown-menu.js'
import { cn } from '../lib/cn.js'

export interface LocaleOption {
  value: string
  /** The autonym, rendered in its own script -- never translated (spec.md §4.3). */
  autonym: string
}

export interface LocaleMenuProps {
  /** Accessible name for the trigger, e.g. `t('shell.locale.aria')` = "Interfeys tili". */
  triggerLabel: string
  /** The chip text next to the globe, e.g. "OʻZ" -- a deliberate glyph canary (spec.md §4.3): if the
   * font falls back, `Oʻ` shows up in the chrome of every screenshot. */
  chip: string
  options: readonly LocaleOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

/** spec.md §4.3 (AC-4): click 1 opens, click 2 selects -- two clicks, from every shell screen. Four
 * `menuitemradio` items via Radix's `RadioGroup`/`RadioItem` (native `role="menu"` + `menuitemradio`
 * semantics, `aria-checked` on the current item). */
export function LocaleMenu({
  triggerLabel,
  chip,
  options,
  value,
  onChange,
  className,
}: LocaleMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={triggerLabel}
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-sm px-2 text-small text-foreground hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className,
        )}
      >
        <Globe className="size-4" aria-hidden="true" />
        <span data-shell-label>{chip}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-58">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span data-shell-label>{option.autonym}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
