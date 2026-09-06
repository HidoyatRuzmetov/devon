// Bootstraps "which department(s) am I in" for this feature's screens. Not `useDepartment()` from
// `src/lib/session.ts`: that hook reads `Me['memberships']`, which `apps/api/src/modules/me/index.ts`
// still hard-codes to `[]` (a different module's file -- see this item's report for the full story),
// so it can never resolve a real department yet. `GET /departments/mine` is this module's own,
// self-contained answer to the same question in the meantime; once `/me` is fixed, `useDepartment()`
// and this hook read the same underlying data and either can be swapped for the other.
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchMyDepartments, type MyDepartment } from './api.js'

const STORAGE_KEY = 'devon.structure.activeDepartmentId'

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function storeChoice(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage disabled -- the picker still works for the rest of this session.
  }
}

export type MyDepartmentsState = {
  isLoading: boolean
  isError: boolean
  departments: MyDepartment[]
  activeDepartmentId: string | null
  active: MyDepartment | null
  setActiveDepartmentId(id: string): void
}

export function useMyDepartments(): MyDepartmentsState {
  const query = useQuery({
    queryKey: ['structure', 'departments-mine'],
    queryFn: fetchMyDepartments,
  })
  const [override, setOverride] = React.useState<string | null>(readStored)

  const departments = query.data ?? []
  const overrideIsValid = override !== null && departments.some((d) => d.departmentId === override)
  const activeDepartmentId = overrideIsValid ? override : (departments[0]?.departmentId ?? null)
  const active = departments.find((d) => d.departmentId === activeDepartmentId) ?? null

  const setActiveDepartmentId = React.useCallback((id: string) => {
    setOverride(id)
    storeChoice(id)
  }, [])

  return {
    isLoading: query.isPending,
    isError: query.isError,
    departments,
    activeDepartmentId,
    active,
    setActiveDepartmentId,
  }
}
