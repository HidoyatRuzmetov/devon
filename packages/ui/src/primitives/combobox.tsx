import * as React from 'react'
import { Command } from 'cmdk'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '../lib/cn.js'
import { FIELD_TRANSITION } from '../lib/focus-ring.js'
import { Popover, PopoverContent, PopoverTrigger } from './popover.js'
import { Skeleton } from './skeleton.js'

/** Search normalisation for the four locales Devon ships (DESIGN.md §2.3, §5).
 *
 * Three things break a naive `toLowerCase().includes()` here:
 *  1. Uzbek Latin writes `Oʻ`/`Gʻ` with U+02BB and the glottal stop with U+02BC. A user types the
 *     ASCII `'` (or nothing at all) -- so every apostrophe-family character is stripped from both
 *     sides before comparing.
 *  2. Cyrillic Uzbek and Russian must compare case-insensitively without the Turkish-I trap, hence
 *     `toLocaleLowerCase('ru')` rather than the default locale of whatever machine is running.
 *  3. Combining diacritics (a pasted `й` as `и` + U+0306) must match their composed form: NFKD, then
 *     drop the combining block.
 */
// Escapes, not literal characters: a combining-mark range typed literally is invisible in a
// diff, and one stray editor normalisation silently changes what it matches.
const COMBINING_MARKS = /[̀-ͯ]/g
const APOSTROPHE_FAMILY = /[ʻʼ‘’`´']/g

export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(APOSTROPHE_FAMILY, '')
    .toLocaleLowerCase('ru')
    .trim()
}

/** cmdk's `filter` contract: > 0 means "keep, ranked by this score". Prefix matches rank above
 * substring matches so typing "Ali" puts "Alisher" before "Nodira Alieva". */
export function comboboxScore(value: string, search: string): number {
  if (!search) return 1
  const haystack = normalizeForSearch(value)
  const needle = normalizeForSearch(search)
  if (!needle) return 1
  if (haystack.startsWith(needle)) return 1
  if (haystack.includes(needle)) return 0.6
  // Word-start match ("Karimova A" finding "Aziza Karimova").
  if (haystack.split(/\s+/).some((word) => word.startsWith(needle))) return 0.8
  return 0
}

export interface ComboboxOption {
  value: string
  label: string
  /** Second line, e.g. a job title under a person's name. */
  description?: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  disabled?: boolean
}

export interface ComboboxProps {
  options: readonly ComboboxOption[]
  value: string | null
  onValueChange: (value: string) => void
  /** Shown on the trigger when nothing is selected. */
  placeholder: string
  /** The search field's placeholder. */
  searchPlaceholder: string
  emptyMessage: string
  /** Accessible name for the trigger button. */
  label: string
  /** Async sources (people, cards) tell the combobox to render three skeleton rows instead of
   * "nothing found" while a request is in flight -- spec.md §5's rule, never a spinner. */
  loading?: boolean
  /** Called on every keystroke so a caller can fetch. Omit for a purely local list. */
  onSearchChange?: (search: string) => void
  disabled?: boolean
  invalid?: boolean
  className?: string
  contentClassName?: string
}

/** DESIGN.md §3: "Select/Combobox (async, keyboard, Uzbek/Cyrillic search)". Built on `cmdk` (the
 * same engine as the command palette, so keyboard behaviour is identical everywhere in the product)
 * inside a Radix Popover for focus management and outside-click.
 *
 * When `onSearchChange` is given the caller owns filtering (an async source already returns the
 * matches) and cmdk's own filter is switched off -- otherwise a server-side match would be filtered
 * out a second time on the client. */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  label,
  loading = false,
  onSearchChange,
  disabled = false,
  invalid = false,
  className,
  contentClassName,
}: ComboboxProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  // `role="combobox"` owes ARIA an `aria-controls` pointing at the list it opens; Radix's Popover
  // does not expose the content id, so the pair is minted here and set on both ends.
  const listId = React.useId()
  const selected = options.find((o) => o.value === value) ?? null
  const isAsync = typeof onSearchChange === 'function'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          className={cn(
            'inline-flex h-11 w-full items-center justify-between gap-2 rounded-sm border border-border',
            'bg-card px-3 text-body text-foreground',
            FIELD_TRANSITION,
            'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            invalid && 'border-destructive focus-visible:ring-destructive',
            className,
          )}
        >
          <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-(--radix-popover-trigger-width) p-0', contentClassName)}
      >
        <Command
          shouldFilter={!isAsync}
          filter={comboboxScore}
          loop
          className="flex max-h-72 flex-col"
        >
          <Command.Input
            value={search}
            onValueChange={(next) => {
              setSearch(next)
              onSearchChange?.(next)
            }}
            placeholder={searchPlaceholder}
            className="h-11 w-full border-0 border-b border-border bg-transparent px-3 text-body text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Command.List id={listId} className="flex-1 overflow-y-auto p-1">
            {loading ? (
              <div className="flex flex-col gap-1 p-1">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <Command.Empty className="p-4 text-center text-small text-muted-foreground">
                  {emptyMessage}
                </Command.Empty>
                {options.map((option) => (
                  <Command.Item
                    key={option.value}
                    value={option.label}
                    disabled={option.disabled ?? false}
                    onSelect={() => {
                      onValueChange(option.value)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-body',
                      'text-foreground data-[selected=true]:bg-accent',
                      'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
                    )}
                  >
                    {option.icon ? <option.icon className="size-4" aria-hidden="true" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block">{option.label}</span>
                      {option.description ? (
                        <span className="block text-caption text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {option.value === value ? (
                      <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    ) : null}
                  </Command.Item>
                ))}
              </>
            )}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
