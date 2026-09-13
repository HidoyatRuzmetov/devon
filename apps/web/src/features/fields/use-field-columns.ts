// Person custom fields as people-table columns (v1.1 SPEC §5: "fields appear as columns in the people
// table"), expressed as one hook so the table does not need to know anything about this module beyond
// "give me the extra columns".
//
// The people table (`features/people/people-table-screen.tsx`) belongs to the head-console package,
// so this package ships the hook rather than the column edit -- see `index.ts`'s merge note. The hook
// is real and tested against the live API: it is what `/fields` itself uses to preview what a column
// will look like before the head asks anyone to fill it.
//
// One request for the whole cohort, keyed by user id, never one per person (I-14): the endpoint takes
// `userIds` and resolves them to memberships server-side, which is where a person value actually
// hangs (SPEC §5).
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '@devon/i18n'
import { fetchDefs, fetchValues, type FieldDefDto, type WireFieldValue } from './api.js'
import { fieldLabel } from './format.js'

export type FieldColumn = {
  def: FieldDefDto
  /** Column heading in the viewer's locale, falling back through the other three. */
  label: string
  /** `userId -> that person's answer`. Absent means "not filled" (or not visible to this viewer:
   * a head-only field's answers are removed by RLS for everyone else, never blanked in the client). */
  values: ReadonlyMap<string, WireFieldValue>
}

export function useFieldColumns(userIds: readonly string[]): {
  columns: FieldColumn[]
  isPending: boolean
  isError: boolean
} {
  const locale = useLocale()
  const key = [...userIds].sort().join(',')

  const defsQuery = useQuery({
    queryKey: ['fields', 'defs', 'person'],
    queryFn: () => fetchDefs('person'),
  })

  const valuesQuery = useQuery({
    queryKey: ['fields', 'values', 'person', key],
    queryFn: () => fetchValues({ subjectType: 'person', userIds }),
    enabled: userIds.length > 0,
  })

  const columns = React.useMemo<FieldColumn[]>(() => {
    const defs = (defsQuery.data?.defs ?? [])
      .filter((d) => d.archivedAt === null && d.showInTable)
      .sort((a, b) => a.order - b.order)
    const byDef = new Map<string, Map<string, WireFieldValue>>()
    for (const record of valuesQuery.data?.values ?? []) {
      if (!record.subjectUserId) continue
      const map = byDef.get(record.defId) ?? new Map<string, WireFieldValue>()
      map.set(record.subjectUserId, record.value)
      byDef.set(record.defId, map)
    }
    return defs.map((def) => ({
      def,
      label: fieldLabel(def, locale),
      values: byDef.get(def.id) ?? new Map<string, WireFieldValue>(),
    }))
  }, [defsQuery.data, valuesQuery.data, locale])

  return {
    columns,
    isPending: defsQuery.isPending || (userIds.length > 0 && valuesQuery.isPending),
    isError: defsQuery.isError || valuesQuery.isError,
  }
}
