import { describe, expect, it, vi } from 'vitest'
import { isMacPlatform, modKeyLabel } from './platform.js'

describe('isMacPlatform / modKeyLabel', () => {
  it('reads userAgentData.platform when available', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' } })
    expect(isMacPlatform()).toBe(true)
    expect(modKeyLabel()).toBe('⌘')
    vi.unstubAllGlobals()
  })

  it('falls back to navigator.platform when userAgentData is absent', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' })
    expect(isMacPlatform()).toBe(false)
    expect(modKeyLabel()).toBe('Ctrl')
    vi.unstubAllGlobals()
  })
})
