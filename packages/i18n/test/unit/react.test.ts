import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useT, useLocale } from '../../src/react.js'
import { setLocale, resetLocaleForTests } from '../../src/store.js'

describe('useLocale() / useT() (React binding)', () => {
  afterEach(() => {
    cleanup()
    resetLocaleForTests()
  })

  it('useLocale() reflects the store and re-renders on setLocale()', () => {
    const { result } = renderHook(() => useLocale())
    expect(result.current).toBe('uz-Latn')
    act(() => setLocale('ru'))
    expect(result.current).toBe('ru')
  })

  it('useT() translates using the currently active locale and updates after a switch (spec.md §4.3: "no page reload")', () => {
    const { result } = renderHook(() => useT())
    expect(result.current('shell.nav.home')).toBe('Bosh sahifa')
    act(() => setLocale('ru'))
    expect(result.current('shell.nav.home')).toBe('Главная')
  })

  it('useT() passes params through', () => {
    setLocale('en')
    const { result } = renderHook(() => useT())
    expect(result.current('home.greeting.day', { name: 'Malika' })).toBe('Good afternoon, Malika')
  })

  it('the function returned by useT() is referentially stable across re-renders while the locale is unchanged', () => {
    const { result, rerender } = renderHook(() => useT())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('the function returned by useT() changes identity when the locale changes', () => {
    const { result } = renderHook(() => useT())
    const first = result.current
    act(() => setLocale('ru'))
    expect(result.current).not.toBe(first)
  })
})
