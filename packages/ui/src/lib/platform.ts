/** DESIGN.md §4.2 / spec.md §4.2: the search trigger prints "Ctrl K" on Windows/Linux and "⌘ K" on
 * macOS -- platform-detected, never both. `navigator.userAgentData` is preferred where available
 * (Client Hints); `navigator.platform` is a deprecated but still-necessary fallback for browsers
 * (Safari) that never shipped it. Defaults to the non-Mac form when neither is available (SSR/tests). */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData
  if (uaData?.platform) return uaData.platform.toLowerCase().includes('mac')
  return /mac/i.test(navigator.platform ?? navigator.userAgent ?? '')
}

/** The two glyphs used by `<Kbd>` for the primary shortcut, per platform (spec.md §4.2). */
export function modKeyLabel(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl'
}
