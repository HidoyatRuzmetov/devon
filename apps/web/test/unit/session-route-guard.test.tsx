import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteOutlet } from '../../src/app.js'
import { useMeQuery } from '../../src/lib/session.js'
import { navigate } from '../../src/lib/router.js'
import type { Me } from '../../src/lib/api-schemas.js'
import type * as ApiClient from '../../src/lib/api-client.js'

const mocks = vi.hoisted(() => ({ fetchMe: vi.fn(), mounted: vi.fn() }))
vi.mock('../../src/lib/api-client.js', async (original) => ({
  ...(await original<typeof ApiClient>()),
  fetchMe: mocks.fetchMe,
}))
vi.mock('../../src/lib/page-meta.js', () => ({ usePageHead: () => {} }))
vi.mock('../../src/shell/app-shell.js', () => ({
  AppShell: ({ children }: React.PropsWithChildren) => <main>{children}</main>,
}))
vi.mock('../../src/shell/auth-shell.js', () => ({
  AuthShell: ({ children }: React.PropsWithChildren) => <main>{children}</main>,
}))
vi.mock('../../src/shell/forced-state-block.js', () => ({
  ForcedStateBlock: ({ kind }: { kind: string }) => <div>forced-{kind}</div>,
}))
vi.mock('../../src/routes/login.js', () => ({ LoginRoute: () => <h1>Login form</h1> }))
vi.mock('../../src/routes/not-found.js', () => ({ NotFoundRoute: () => <h1>Not found</h1> }))
vi.mock('../../src/features/registry.js', () => {
  function PrivateTimeline() {
    const { data } = useMeQuery()
    if (!data) throw new Error('private mutation hook mounted without session')
    mocks.mounted()
    return <h1>Private timeline</h1>
  }
  return {
    matchFeatureRoute: (path: string) => {
      if (path === '/register')
        return { titleKey: 'register.title', component: () => <h1>Registration</h1> }
      if (path !== '/work/timeline') return null
      return {
        titleKey: 'work.title',
        component: PrivateTimeline,
      }
    },
  }
})

let client: QueryClient
const me = { user: { id: 'user', role: 'member' }, csrfToken: 'csrf' } as Me
function mount() {
  return render(
    <QueryClientProvider client={client}>
      <RouteOutlet />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } })
  navigate('/work/timeline')
})
afterEach(() => {
  client.clear()
  vi.unstubAllEnvs()
})

describe('private route session gate', () => {
  it('does not mount the private feature until a delayed session succeeds', async () => {
    let resolve!: (value: Me) => void
    mocks.fetchMe.mockImplementation(
      () =>
        new Promise<Me>((done) => {
          resolve = done
        }),
    )
    mount()
    expect(mocks.mounted).not.toHaveBeenCalled()
    await act(async () => resolve(me))
    expect(await screen.findByText('Private timeline')).toBeInTheDocument()
  })

  it('offers retry on a failed session and recovers without an error-boundary reload', async () => {
    mocks.fetchMe.mockRejectedValueOnce(new Error('upstream 502')).mockResolvedValue(me)
    mount()
    const retry = await screen.findByRole('button')
    expect(mocks.mounted).not.toHaveBeenCalled()
    fireEvent.click(retry)
    expect(await screen.findByText('Private timeline')).toBeInTheDocument()
  })

  it('sends a signed-out private visit to login without mounting the private feature', async () => {
    mocks.fetchMe.mockResolvedValue(null)
    mount()
    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(await screen.findByText('Login form')).toBeInTheDocument()
    expect(mocks.mounted).not.toHaveBeenCalled()
  })

  it.each([
    ['/register', 'Registration'],
    ['/missing-route', 'Not found'],
  ])('preserves public or unknown route %s during a pending session', async (path, text) => {
    mocks.fetchMe.mockImplementation(() => new Promise(() => {}))
    navigate(path)
    mount()
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(mocks.mounted).not.toHaveBeenCalled()
  })

  it('preserves test-only forced states without executing private hooks', async () => {
    vi.stubEnv('DEVON_E2E', '1')
    mocks.fetchMe.mockResolvedValue(null)
    navigate('/work/timeline?__state=offline')
    mount()
    expect(await screen.findByText('forced-offline')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/work/timeline')
    expect(mocks.mounted).not.toHaveBeenCalled()
  })
})
