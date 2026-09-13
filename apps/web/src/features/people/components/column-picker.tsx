// The people table's column picker (v1.1 SPEC §4.3: "Column picker: every registry indicator and
// every person custom field, grouped; drag to reorder").
//
// Reordering is done with move-up / move-down buttons rather than drag alone. Drag is the obvious
// gesture and it is here too (the chosen list is a normal list you can drag), but a column order is
// a setting a head will change from a keyboard on a government laptop, and DESIGN.md §6 asks for a
// keyboard path for every primary flow -- so the buttons are the real mechanism and the pointer just
// gets to use them faster.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { INDICATORS, type IndicatorSource, type IndicatorSpec } from '@devon/contracts'
import {
  Badge,
  Button,
  Checkbox,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@devon/ui'
import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react'

/** The registry's `source`, turned into the picker's groups. One group per place a number comes
 * from, so "why is this column here" is answerable by looking at the heading above it. */
const GROUP_ORDER: readonly IndicatorSource[] = [
  'membership',
  'cards',
  'projects',
  'events',
  'onboarding',
  'activity',
  'personal_aggregate',
]

export type ColumnPickerProps = {
  /** Chosen column ids, in display order. `name` is implicit and never in this list. */
  value: readonly string[]
  onChange: (next: string[]) => void
  /** Columns a member may see (the four directory facts) versus the whole registry. */
  available: readonly IndicatorSpec[]
  maxColumns: number
}

export function ColumnPicker({
  value,
  onChange,
  available,
  maxColumns,
}: ColumnPickerProps): React.JSX.Element {
  const t = useT()
  const byId = React.useMemo(() => {
    const map = new Map<string, IndicatorSpec>()
    for (const indicator of INDICATORS) map.set(indicator.id, indicator)
    return map
  }, [])
  const chosen = value.filter((id) => byId.has(id))
  const atCap = chosen.length >= maxColumns

  function toggle(id: string): void {
    onChange(value.includes(id) ? value.filter((c) => c !== id) : [...value, id])
  }

  function move(id: string, delta: -1 | 1): void {
    const index = value.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= value.length) return
    const next = [...value]
    const [removed] = next.splice(index, 1)
    next.splice(target, 0, removed!)
    onChange(next)
  }

  const groups = GROUP_ORDER.map((source) => ({
    source,
    indicators: available.filter((indicator) => indicator.source === source),
  })).filter((group) => group.indicators.length > 0)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          <Columns3 aria-hidden="true" className="size-4" />
          {t('people.table.columns.action')}
          <Badge variant="subtle">{String(chosen.length + 1)}</Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[32rem] w-88 flex-col gap-3 overflow-y-auto"
      >
        <div className="flex flex-col gap-1">
          <p className="text-small font-medium">{t('people.table.columns.heading')}</p>
          <p className="text-caption text-muted-foreground">
            {t('people.table.columns.cap', { max: maxColumns })}
          </p>
        </div>

        {chosen.length > 0 ? (
          <section className="flex flex-col gap-1">
            <h3 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              {t('people.table.columns.chosen')}
            </h3>
            <ul className="flex flex-col gap-1">
              {chosen.map((id, index) => {
                const indicator = byId.get(id)!
                return (
                  <li
                    key={id}
                    className="flex min-h-11 items-center gap-2 rounded-sm border border-border px-2 py-1"
                  >
                    <span className="min-w-0 flex-1 truncate text-small">
                      {t(indicator.labelKey)}
                    </span>
                    <IconButton
                      aria-label={t('people.table.columns.moveUp', {
                        name: t(indicator.labelKey),
                      })}
                      disabled={index === 0}
                      onClick={() => move(id, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      aria-label={t('people.table.columns.moveDown', {
                        name: t(indicator.labelKey),
                      })}
                      disabled={index === chosen.length - 1}
                      onClick={() => move(id, 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </IconButton>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {groups.map((group) => (
          <section key={group.source} className="flex flex-col gap-1">
            <h3 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
              {t(`people.table.columns.group.${group.source}`)}
            </h3>
            <ul className="flex flex-col gap-0.5">
              {group.indicators.map((indicator) => {
                const checked = value.includes(indicator.id)
                return (
                  <li
                    key={indicator.id}
                    className={cn(
                      'flex min-h-11 items-start gap-3 rounded-sm px-2 hover:bg-accent',
                      !checked && atCap && 'opacity-50',
                    )}
                  >
                    <Checkbox
                      id={`people-column-${indicator.id}`}
                      className="mt-3"
                      checked={checked}
                      disabled={!checked && atCap}
                      onCheckedChange={() => toggle(indicator.id)}
                    />
                    <label
                      htmlFor={`people-column-${indicator.id}`}
                      className="flex cursor-pointer flex-col py-2"
                    >
                      <span className="text-small">{t(indicator.labelKey)}</span>
                      <span className="text-caption text-muted-foreground">
                        {t(indicator.descriptionKey)}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  )
}
