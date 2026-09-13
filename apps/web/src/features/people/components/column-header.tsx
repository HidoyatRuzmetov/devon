// One people-table column header: the label, the sort toggle and the column's own filter (v1.1
// SPEC §4.3 "per-column sort and filter (numeric ranges, enum sets, date ranges, text)").
//
// The operator offered is decided by the indicator's registry `type`, not by a per-column special
// case: a `count` or `percent` gets ">= / <=", a `date` gets "before / after", text gets "contains",
// and everything gets "boʻsh / toʻldirilgan" because "who has not told us yet" is the question a
// custom-field column exists to answer.
import * as React from 'react'
import { useT } from '@devon/i18n'
import type { PeopleColumnFilter, PeopleFilterOp } from '@devon/contracts'
import { columnDescription, columnLabel, type TableColumnSpec } from '../column-spec.js'
import {
  Button,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  cn,
} from '@devon/ui'
import { ArrowDown, ArrowUp, BellRing, ChevronsUpDown, Filter } from 'lucide-react'

export type ColumnHeaderProps = {
  spec: TableColumnSpec
  sort: 'asc' | 'desc' | null
  onSort: () => void
  filter: PeopleColumnFilter | null
  onFilter: (next: PeopleColumnFilter | null) => void
  /**
   * v1.1 critique SEV2 #6: "custom-field column headers are inert text with no menu", on the one
   * screen where a column of two dozen em dashes makes the gap visible. Present only for a
   * custom-field column, and only for a head: asks everybody still missing that field to fill it.
   */
  onAskToFill?: (() => void) | undefined
  askPending?: boolean | undefined
}

function opsFor(spec: TableColumnSpec): PeopleFilterOp[] {
  switch (spec.type) {
    case 'count':
    case 'percent':
    case 'duration':
      return ['gte', 'lte', 'eq', 'empty', 'filled']
    case 'date':
      return ['after', 'before', 'empty', 'filled']
    case 'enum':
      return ['eq', 'empty', 'filled']
    default:
      return ['contains', 'eq', 'empty', 'filled']
  }
}

function needsValue(op: PeopleFilterOp): boolean {
  return op !== 'empty' && op !== 'filled'
}

export function ColumnHeader({
  spec,
  sort,
  onSort,
  filter,
  onFilter,
  onAskToFill,
  askPending = false,
}: ColumnHeaderProps): React.JSX.Element {
  const t = useT()
  const label = columnLabel(spec, t)
  const description = columnDescription(spec, t)
  const ops = opsFor(spec)
  const [op, setOp] = React.useState<PeopleFilterOp>(filter?.op ?? ops[0]!)
  const [value, setValue] = React.useState<string>(
    filter?.value === null || filter?.value === undefined ? '' : String(filter.value),
  )

  React.useEffect(() => {
    setOp(filter?.op ?? ops[0]!)
    setValue(filter?.value === null || filter?.value === undefined ? '' : String(filter.value))
    // `ops` is derived from `spec`, which is the identity of this header.
  }, [filter, spec.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function apply(): void {
    if (needsValue(op) && value.trim() === '') {
      onFilter(null)
      return
    }
    const numeric = spec.type === 'count' || spec.type === 'percent' || spec.type === 'duration'
    onFilter({
      columnId: spec.id,
      op,
      value: needsValue(op) ? (numeric ? Number(value) : value.trim()) : null,
    })
  }

  const SortIcon = sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : ChevronsUpDown

  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={onSort}
        title={description}
        className={cn(
          'inline-flex min-h-9 items-center gap-1 rounded-sm px-1 text-left font-medium',
          'transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        aria-label={t('people.table.sortBy', { name: label })}
      >
        <span className="whitespace-nowrap">{label}</span>
        <SortIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      </button>

      <Popover>
        <PopoverTrigger asChild>
          <IconButton
            aria-label={t('people.table.filterBy', { name: label })}
            className={cn('size-7', filter && 'bg-primary/12 text-primary')}
          >
            <Filter aria-hidden="true" className="size-3.5" />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-72 flex-col gap-3">
          <p className="text-small font-medium">{label}</p>
          <Select
            value={op}
            aria-label={t('people.table.filter.operator')}
            onChange={(e) => setOp(e.target.value as PeopleFilterOp)}
            options={ops.map((id) => ({ value: id, label: t(`people.table.filter.op.${id}`) }))}
          />
          {needsValue(op) ? (
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={t('people.table.filter.value')}
              placeholder={
                spec.type === 'date'
                  ? t('people.table.filter.datePlaceholder')
                  : t('people.table.filter.valuePlaceholder')
              }
              inputMode={spec.type === 'count' || spec.type === 'percent' ? 'numeric' : 'text'}
            />
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => onFilter(null)}>
              {t('people.table.filter.clear')}
            </Button>
            <Button size="sm" onClick={apply}>
              {t('people.table.filter.apply')}
            </Button>
          </div>
          {/* SEV2 #6: the head is looking straight at the gap this column measures, so the ask
              lives here as well as in the field manager -- scoped to everybody still missing it. */}
          {onAskToFill ? (
            <Button
              variant="secondary"
              size="sm"
              loading={askPending}
              onClick={onAskToFill}
              className="w-full"
            >
              <BellRing aria-hidden="true" className="size-4" />
              {t('people.table.askToFill.column')}
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </span>
  )
}
