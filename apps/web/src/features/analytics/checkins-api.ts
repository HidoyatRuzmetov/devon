import {
  checkinBoardSchema,
  checkinSourceCardSchema,
  type CheckinEntry,
  type CheckinSelection,
  type CheckinLayoutWrite,
} from '@devon/contracts'
import { useT } from '@devon/i18n'
import { toast } from '@devon/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { apiClient } from '../../lib/api-client.js'
import { useDepartment, useMeQuery } from '../../lib/session.js'

const BASE = '/api/v1/checkins'
export function useCheckins(cycleId?: string) {
  const { departmentId } = useDepartment()
  return useQuery({
    queryKey: ['checkins', departmentId, cycleId ?? 'current'],
    enabled: !!departmentId,
    queryFn: () =>
      apiClient.get(
        `${BASE}/${cycleId ? `?cycleId=${encodeURIComponent(cycleId)}` : ''}`,
        checkinBoardSchema,
      ),
  })
}
type Change =
  | { kind: 'selection'; cycleId: string; memberUserId: string; body: CheckinSelection }
  | { kind: 'layout'; cycleId: string; memberUserId: string; body: CheckinLayoutWrite }
  | { kind: 'add'; cycleId: string; itemId: string }
  | { kind: 'remove'; id: string }
  | { kind: 'update'; id: string; version: number; text?: string; state?: CheckinEntry['state'] }
  | { kind: 'lock'; cycleId: string; phase: 'checkin' | 'checkout'; memberUserId: string }
export function useCheckinChange() {
  const qc = useQueryClient(),
    t = useT(),
    me = useMeQuery().data
  return useMutation<unknown, Error, Change>({
    mutationFn: (change: Change) => {
      const csrf = me?.csrfToken ?? ''
      if (change.kind === 'selection' || change.kind === 'layout')
        return apiClient.put(
          `${BASE}/cycles/${change.cycleId}/members/${change.memberUserId}/${change.kind}`,
          change.body,
          z.void(),
          csrf,
        )
      if (change.kind === 'add')
        return apiClient.post(
          `${BASE}/cycles/${change.cycleId}/entries`,
          { checklistItemId: change.itemId },
          z.object({ id: z.string().uuid() }),
          csrf,
        )
      if (change.kind === 'remove') return apiClient.delete(`${BASE}/entries/${change.id}`, csrf)
      if (change.kind === 'lock')
        return apiClient.post(
          `${BASE}/cycles/${change.cycleId}/lock`,
          { phase: change.phase, memberUserId: change.memberUserId },
          z.void(),
          csrf,
        )
      const { kind: _, id, ...body } = change
      return apiClient.patch(`${BASE}/entries/${id}`, body, z.void(), csrf)
    },
    onSuccess: (_, change) => {
      if (change.kind === 'add' || change.kind === 'remove')
        toast(t(`checkins.${change.kind === 'add' ? 'added' : 'removed'}`))
    },
    onError: () => toast.error(t('checkins.saveError')),
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['checkins'] }),
        qc.invalidateQueries({ queryKey: ['work'] }),
      ])
    },
  })
}

export function useCheckinCandidates(cycleId: string, memberUserId: string, enabled: boolean) {
  const { departmentId } = useDepartment()
  return useQuery({
    queryKey: ['checkins', departmentId, 'candidates', cycleId, memberUserId],
    enabled: !!departmentId && enabled,
    queryFn: () =>
      apiClient.get(
        `${BASE}/cycles/${cycleId}/members/${memberUserId}/candidates`,
        z.array(checkinSourceCardSchema),
      ),
  })
}
