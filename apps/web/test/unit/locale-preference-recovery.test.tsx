import { beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import type * as React from 'react'
import { setLocale } from '@devon/i18n'
import type { Me } from '../../src/lib/api-schemas.js'
import { useLocalePreferenceRecovery } from '../../src/lib/session.js'
import {
  readLocalePreferenceRecovery,
  persistLocalePreferenceRecovery,
} from '../../src/lib/locale-preference-recovery.js'
vi.mock('@devon/ui', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode
    onClick: () => void
    disabled: boolean
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))
import { LocalePreferenceNotice } from '../../src/shell/locale-preference-notice.js'

const receipt = { ownerUserId: 'owner', locale: 'ru', status: 'failed', showNotice: true } as const
beforeEach(() => localStorage.clear())

it('hydrates the exact owner last choice after reload and clears it on account replacement', async () => {
  persistLocalePreferenceRecovery(receipt)
  const client = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const me = { user: { id: 'owner' } } as Me
  const { result, rerender, unmount } = renderHook(
    ({ current }) => useLocalePreferenceRecovery(current),
    { wrapper, initialProps: { current: me } },
  )
  expect(result.current).toEqual(receipt)
  rerender({ current: { user: { id: 'replacement' } } as Me })
  expect(result.current).toBeNull()
  await waitFor(() => expect(readLocalePreferenceRecovery()).toBeNull())
  unmount()
  client.clear()
})

it('ignores malformed stored receipts and remains usable when storage is unavailable', () => {
  localStorage.setItem(
    'devon_unsaved_locale',
    JSON.stringify({ ownerUserId: 'owner', locale: 'unknown' }),
  )
  expect(readLocalePreferenceRecovery()).toBeNull()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
    throw new Error('Disabled storage')
  })
  expect(readLocalePreferenceRecovery()).toBeNull()
})

it.each(['en', 'ru', 'uz-Latn', 'uz-Cyrl'] as const)(
  'renders localized actionable recovery in %s and protects an in-flight retry',
  (locale) => {
    setLocale(locale)
    const retry = vi.fn()
    const { rerender } = render(<LocalePreferenceNotice recovery={receipt} onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Русский')
    expect(screen.getByRole('alert').textContent).not.toContain('locale.preferenceFailed')
    expect(screen.getByRole('button').textContent).not.toContain('locale.retrySave')
    screen.getByRole('button').click()
    expect(retry).toHaveBeenCalledOnce()
    rerender(
      <LocalePreferenceNotice recovery={{ ...receipt, status: 'pending' }} onRetry={retry} />,
    )
    expect(screen.getByRole('button')).toBeDisabled()
    rerender(<LocalePreferenceNotice recovery={null} onRetry={retry} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  },
)
