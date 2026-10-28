// Fortnights are calendar dates in Tashkent, not host-local weekdays or elapsed DST hours.
export const FIRST_CHECKIN = '2026-11-02'
const DAY = 86_400_000
export function addDays(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10)
}
export function tashkentDay(now: Date): string {
  return new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10)
}
export function currentCheckinStart(now = new Date()): string {
  const days = Math.floor(
    (Date.parse(`${tashkentDay(now)}T00:00:00Z`) - Date.parse(`${FIRST_CHECKIN}T00:00:00Z`)) / DAY,
  )
  // The weekend after checkout belongs to the next draft, ready for Monday.
  return addDays(FIRST_CHECKIN, Math.max(0, Math.floor((days + 2) / 14)) * 14)
}
export function cycleDates(startsOn: string) {
  return {
    startsOn,
    endsOn: addDays(startsOn, 11),
    checkinDeadline: new Date(`${addDays(startsOn, 1)}T00:00:00+05:00`),
    checkoutDeadline: new Date(`${addDays(startsOn, 12)}T00:00:00+05:00`),
  }
}
