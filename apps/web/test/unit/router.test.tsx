import { afterEach, describe, expect, it } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Link,
  navigate,
  replaceSearchParam,
  routeNameForPath,
  useRouteName,
  useSearchParams,
} from '../../src/lib/router.js'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('routeNameForPath (design.md §6: /, /login, /setup, /admin, /404)', () => {
  it('maps every shipped path to its route name', () => {
    expect(routeNameForPath('/')).toBe('home')
    expect(routeNameForPath('/login')).toBe('login')
    expect(routeNameForPath('/setup')).toBe('setup')
    expect(routeNameForPath('/admin')).toBe('admin')
  })

  it('maps any unmatched path to not-found (design.md §6.5)', () => {
    expect(routeNameForPath('/404')).toBe('not-found')
    expect(routeNameForPath('/nonexistent')).toBe('not-found')
  })
})

describe('navigate()', () => {
  it('pushes a new history entry and updates useRouteName()', () => {
    const { result } = renderHook(() => useRouteName())
    expect(result.current).toBe('home')
    act(() => navigate('/admin'))
    expect(result.current).toBe('admin')
    expect(window.location.pathname).toBe('/admin')
  })

  it('is a no-op when already at the target path+search', () => {
    act(() => navigate('/login'))
    const before = window.history.length
    act(() => navigate('/login'))
    expect(window.history.length).toBe(before)
  })
})

describe('replaceSearchParam (the ?__state= forcing param, design.md §8)', () => {
  it('sets and clears a param without touching the path', () => {
    act(() => navigate('/'))
    const { result } = renderHook(() => useSearchParams())
    act(() => replaceSearchParam('__state', 'error'))
    expect(result.current.get('__state')).toBe('error')
    expect(window.location.pathname).toBe('/')
    act(() => replaceSearchParam('__state', null))
    expect(result.current.get('__state')).toBeNull()
  })
})

describe('Link / RouterLink', () => {
  it('navigates on a plain left click without a full page load', async () => {
    const user = userEvent.setup()
    render(<Link to="/admin">Go</Link>)
    await user.click(screen.getByRole('link', { name: 'Go' }))
    expect(window.location.pathname).toBe('/admin')
  })

  it('does not intercept a modified click (open-in-new-tab shortcuts)', async () => {
    render(<Link to="/admin">Go</Link>)
    const anchor = screen.getByRole('link', { name: 'Go' })
    const before = window.location.pathname
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    const prevented = !anchor.dispatchEvent(event)
    expect(prevented).toBe(false)
    expect(window.location.pathname).toBe(before)
  })
})
