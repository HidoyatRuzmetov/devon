// One people-table column header: the label, the sort toggle and the column's own filter (v1.1
// SPEC §4.3 "per-column sort and filter (numeric ranges, enum sets, date ranges, text)").
//
// The operator offered is decided by the indicator's registry `type`, not by a per-column special
// case: a `count` or `percent` gets ">= / <=", a `date` gets "before / after", text gets "contains",
// and everything gets "boʻsh / toʻldirilgan" because "who has not told us yet" is the question a
// custom-field column exists to answer.
import * as React from 'react'
import { useT } from '@devon/i18n'
import type { IndicatorSpec, PeopleColumnFilter, PeopleFilterOp } from '@devon/contracts'
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
import { ArrowDown, ArrowUp, ChevronsUpDown, Filter } from 'lucide-react'

export type ColumnHeaderProps = {
  spec: IndicatorSpec
  sort: 'asc' | 'desc' | null
  onSort: () => void
  filter: PeopleColumnFilter | null
  onFilter: (next: PeopleColumnFilter | null) => void
}

function opsFor(spec: IndicatorSpec): PeopleFilterOp[] {
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
}: ColumnHeaderProps): React.JSX.Element {
  const t = useT()
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
        title={t(spec.descriptionKey)}
        className={cn(
          'inline-flex min-h-9 items-center gap-1 rounded-sm px-1 text-left font-medium',
          'transition-colors duration-(--dur-micro) ease-out hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        aria-label={t('people.table.sortBy', { name: t(spec.labelKey) })}
      >
        <span className="whitespace-nowrap">{t(spec.labelKey)}</span>
        <SortIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      </button>

      <Popover>
        <PopoverTrigger asChild>
          <IconButton
            aria-label={t('people.table.filterBy', { name: t(spec.labelKey) })}
            className={cn('size-7', filter && 'bg-primary/12 text-primary')}
          >
            <Filter aria-hidden="true" className="size-3.5" />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-72 flex-col gap-3">
          <p className="text-small font-medium">{t(spec.labelKey)}</p>
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
        </PopoverContent>
      </Popover>
    </span>
  )
}
