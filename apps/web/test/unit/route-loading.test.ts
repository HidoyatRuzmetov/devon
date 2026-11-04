import { describe, expect, it } from 'vitest'
import { getFeatureRoutes } from '../../src/features/registry.js'
import { loadingViewForRoute } from '../../src/lib/route-loading.js'

describe('loading layouts follow the requested route and view', () => {
  it('covers every registered route without a generic fallback', () => {
    for (const route of getFeatureRoutes())
      expect(loadingViewForRoute(route.path), route.path).not.toBe('notFound')
  })
  it('keeps distinct settings, analytics, calendar and home layouts', () => {
    expect(loadingViewForRoute('/account/personnel')).toBe('personnel')
    expect(loadingViewForRoute('/account/professional')).toBe('resume')
    expect(loadingViewForRoute('/account/telegram')).toBe('telegram')
    expect(loadingViewForRoute('/analytics', new URLSearchParams('view=progress'))).toBe('progress')
    expect(loadingViewForRoute('/analytics')).toBe('checkin')
    expect(loadingViewForRoute('/personal', new URLSearchParams('tab=pomodoro'))).toBe('pomodoro')
    expect(loadingViewForRoute('/pages', new URLSearchParams('page=record'))).toBe('page')
    expect(loadingViewForRoute('/', undefined, true)).toBe('headHome')
    expect(loadingViewForRoute('/')).toBe('memberHome')
  })
})
