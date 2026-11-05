import { describe, expect, it, vi } from 'vitest'
vi.mock('../../src/modules/ai/service.js', () => ({ runDepartmentChatForActor: vi.fn() }))
import {
  birthdayClock,
  birthdayInYear,
  nextDay,
  validBirthDate,
} from '../../src/modules/birthdays/calendar.js'
import { familyContext, publicBirthdayContext } from '../../src/modules/birthdays/message.js'
import { birthdaySendDisposition } from '../../src/modules/birthdays/worker.js'

describe('birthday calendar and disclosure boundaries', () => {
  it('uses the Tashkent civil day across UTC midnight and year rollover', () => {
    expect(birthdayClock(new Date('2026-12-31T20:01:00Z'))).toEqual({ date: '2027-01-01', hour: 1 })
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
    expect(birthdayClock(new Date('2026-11-04T03:59:00Z')).hour).toBe(8)
    expect(birthdayClock(new Date('2026-11-04T04:00:00Z')).hour).toBe(9)
  })
  it('has a single February 29 celebration under an explicit leap-year policy', () => {
    expect(birthdayInYear('2000-02-29', 2027)).toBe('2027-02-28')
    expect(birthdayInYear('2000-02-29', 2028)).toBe('2028-02-29')
    expect(birthdayInYear('2000-02-29', 2100)).toBe('2100-02-28')
    expect(validBirthDate('2025-02-29')).toBe(false)
    expect(validBirthDate('2100-01-01', new Date('2026-11-05T00:00:00Z'))).toBe(false)
  })
  it('reduces the private record to coarse confirmed flags, with no names or bereavement inference', () => {
    const context = familyContext({
      fio: 'Sensitive name',
      relatives: [
        { rel: 'Отаси', status: 'dead', name: 'Private parent', deathYear: '2020' },
        { rel: 'Ўғли', status: 'work', name: 'Private child', address: 'Private home' },
        { rel: 'Турмуш ўртоғи', status: '', name: 'Unconfirmed person' },
      ],
    })
    expect(context).toEqual({ children: true, family: true, livingParent: false })
    expect(familyContext({ relatives: [{ rel: 'Отаси', status: 'dead' }] })).toEqual({
      children: false,
      family: false,
      livingParent: false,
    })
    expect(familyContext({ relatives: [{ rel: 'Ўғли', status: '' }] })).toEqual({
      children: false,
      family: false,
      livingParent: false,
    })
  })
  it('retries only known no-send results and never repeats an ambiguous delivery', () => {
    expect(birthdaySendDisposition('telegram_unavailable')).toBe('pending')
    expect(birthdaySendDisposition('429: Too Many Requests')).toBe('pending')
    expect(birthdaySendDisposition('403: bot was blocked')).toBe('failed')
    expect(birthdaySendDisposition('ETIMEDOUT')).toBe('uncertain')
    expect(birthdaySendDisposition('delivery_uncertain')).toBe('uncertain')
  })
  it('bounds published interests without forwarding dates, biography, identity or contacts', () => {
    const context = publicBirthdayContext({
      position: 'chief_specialist',
      headline: 'Software engineer',
      skills: Array(12).fill('A'.repeat(100)),
      hobbies: ['Hiking', 'name@example.com', 'https://example.com', '998901234567'],
      fields: ['Computer science'],
      currentRoles: ['Engineer'],
      name: 'Private name',
      dateOfBirth: '2000-01-01',
      about: 'Private story',
      phone: 'Private number',
    })
    expect(context.role).toBe('Chief specialist')
    expect(context.skills).toHaveLength(6)
    expect(context.skills[0]).toHaveLength(60)
    expect(context.hobbies).toEqual(['Hiking'])
    expect(JSON.stringify(context)).not.toMatch(/Private|2000|example/)
  })
})
