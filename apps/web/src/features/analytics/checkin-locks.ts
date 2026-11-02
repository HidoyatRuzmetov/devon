import type { CheckinBoard, CheckinCycle } from '@devon/contracts'

export function memberLock(data: CheckinBoard, cycle: CheckinCycle, memberUserId: string) {
  const lock = data.memberLocks.find(
    (l) => l.cycleId === cycle.id && l.memberUserId === memberUserId,
  )
  return {
    checkinLockedAt: lock?.checkinLockedAt ?? cycle.checkinLockedAt,
    checkoutLockedAt: lock?.checkoutLockedAt ?? cycle.checkoutLockedAt,
  }
}

export function cycleLockState(data: CheckinBoard, cycle: CheckinCycle) {
  const locks = data.members.map((member) => memberLock(data, cycle, member.userId))
  if (cycle.checkoutLockedAt || (locks.length && locks.every((lock) => lock.checkoutLockedAt)))
    return 'closed'
  if (cycle.checkinLockedAt || (locks.length && locks.every((lock) => lock.checkinLockedAt)))
    return 'agreed'
  return 'draft'
}
