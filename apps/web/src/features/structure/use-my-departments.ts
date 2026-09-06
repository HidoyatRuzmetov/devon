// Bootstraps "which department(s) am I in" for this feature's screens. `GET /api/v1/me` (fixed by
// EPIC-002, `apps/api/src/modules/me/index.ts`) now returns real memberships, so this hook is a thin
// adapter over the shared `useDepartment()`/`useSession()` (`src/lib/session.ts`) rather than a
// second, duplicate `/departments/mine` endpoint of its own -- integrating this module alongside
// `accounts-departments` surfaced the exact duplication this file's previous revision predicted
// ("once `/me` is fixed, `useDepartment()` and this hook read the same underlying data and either can
// be swapped for the other").
import { useDepartment, useSession } from '../../lib/session.js'
import type { MyDepartment } from './api.js'

export type MyDepartmentsState = {
  isLoading: boolean
  isError: boolean
  departments: MyDepartment[]
  activeDepartmentId: string | null
  active: MyDepartment | null
  setActiveDepartmentId(id: string): void
}

export function useMyDepartments(): MyDepartmentsState {
  const { isLoading } = useSession()
  const { department, departmentId, memberships, setDepartmentId } = useDepartment()

  return {
    isLoading,
    // `useSession()`/`useMeQuery()` model "nobody is signed in" as `data: undefined, isError: false`
    // (session.ts's own comment) -- this feature is never reachable while signed out, so there is no
    // separate error condition to surface here beyond the shared query's own.
    isError: false,
    departments: [...memberships],
    activeDepartmentId: departmentId,
    active: department,
    setActiveDepartmentId: setDepartmentId,
  }
}
