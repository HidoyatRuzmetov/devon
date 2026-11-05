/** All department celebrations use the same civil date as check-in: Asia/Tashkent. */
export function birthdayClock(now = new Date()) {
  const local = new Date(now.getTime() + 5 * 60 * 60 * 1000)
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() }
}

/** February 29 birthdays are celebrated on February 28 in non-leap years. */
export function birthdayInYear(birthDate: string, year: number): string {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const suffix = birthDate.slice(5) === '02-29' && !leap ? '02-28' : birthDate.slice(5)
  return `${year}-${suffix}`
}

export function nextDay(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
}

export function validBirthDate(value: string, now = new Date()) {
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value >= '1900-01-01' &&
    value <= birthdayClock(now).date
  )
}
