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
import {
  columnLabel,
  columnDescription,
  FIELD_COLUMN_SOURCE,
  type TableColumnSource,
  type TableColumnSpec,
} from '../column-spec.js'
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
 * from, so "why is this column here" is answerable by looking at the heading above it.
 *
 * v1.1 critique SEV2 #7: `field` is last on purpose. It is the department's own group -- the columns
 * a boshqarma boshligʻi created rather than the ones the product derived -- and until this round it
 * was not in the picker at all, which is why Taʼlim, Chet tillari and Sertifikatlar rendered as
 * columns that could not be hidden, reordered, sorted, filtered or resized. */
const GROUP_ORDER: readonly TableColumnSource[] = [
  'membership',
  'cards',
  'projects',
  'events',
  'onboarding',
  'activity',
  'personal_aggregate',
  FIELD_COLUMN_SOURCE,
]

export type ColumnPickerProps = {
  /** Chosen column ids, in display order. `name` is implicit and never in this list. */
  value: readonly string[]
  onChange: (next: string[]) => void
  /** Every column this head may choose from -- registry indicators *and* the department's own
   * person fields (SEV2 #7), in one list, so "which columns exist" has one answer. */
  available: readonly TableColumnSpec[]
  maxColumns: number
  /**
   * SEV2 #7: "the 'Ustunlar 4' badge matches neither the 3 selected indicators nor the 6 rendered
   * columns". The badge now counts what is actually on screen, which the table knows and this
   * component does not (Ism and Vazifalar are always there; a chosen id whose definition has since
   * been archived is not).
   */
  renderedCount: number
}

export function ColumnPicker({
  value,
  onChange,
  available,
  maxColumns,
  renderedCount,
}: ColumnPickerProps): React.JSX.Element {
  const t = useT()
  // Built from `available` rather than from `INDICATORS`: a custom field is not in the registry, and
  // building the lookup from the registry is precisely why the chosen-columns list used to silently
  // drop every field column.
  const byId = React.useMemo(() => {
    const map = new Map<string, TableColumnSpec>()
    for (const column of available) map.set(column.id, column)
    return map
  }, [available])
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
          <Badge variant="subtle">{String(renderedCount)}</Badge>
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
                      {columnLabel(indicator, t)}
                    </span>
                    <IconButton
                      aria-label={t('people.table.columns.moveUp', {
                        name: columnLabel(indicator, t),
                      })}
                      disabled={index === 0}
                      onClick={() => move(id, -1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      aria-label={t('people.table.columns.moveDown', {
                        name: columnLabel(indicator, t),
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
                      <span className="text-small">{columnLabel(indicator, t)}</span>
                      <span className="text-caption text-muted-foreground">
                        {columnDescription(indicator, t) ||
                          (indicator.source === FIELD_COLUMN_SOURCE
                            ? t('people.table.columns.fieldDescription')
                            : '')}
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
