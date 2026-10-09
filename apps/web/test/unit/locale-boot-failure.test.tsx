import { expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type * as I18n from '@devon/i18n'
import type * as React from 'react'
vi.mock('@devon/ui', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))
vi.mock('@devon/i18n', async (original) => ({
  ...(await original<typeof I18n>()),
  loadCatalogue: vi.fn().mockRejectedValue(new Error('local boot catalogue refusal')),
}))
vi.mock('../../src/app.js', () => ({ App: () => <div data-testid="application-mounted" /> }))
vi.mock('../../src/lib/theme.js', () => ({ bootTheme: vi.fn() }))
vi.mock('../../src/lib/locale-boot.js', () => ({ resolveBootLocale: () => 'ru' }))

it('failed boot language leaves an explicit recovery screen instead of mounting the app or staying blank', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  await import('../../src/main.js')
  expect(await screen.findByRole('alert')).toHaveTextContent('Русский')
  expect(screen.getByRole('button')).toBeEnabled()
  expect(screen.queryByTestId('application-mounted')).not.toBeInTheDocument()
})
