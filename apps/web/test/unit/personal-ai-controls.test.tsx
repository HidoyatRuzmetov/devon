import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale, t } from '@devon/i18n'
import { useAiFeatureEnabled } from '../../src/features/ai/use-ai.js'
import {
  PersonalQuickAddPreview,
  personalQuickAddNotes,
} from '../../src/features/personal/lib/personal-quick-add-preview.js'
import type { QuickAddOutput } from '../../src/features/ai/outputs.js'

const fixture = vi.hoisted(() => ({
  fetchSettings: vi.fn(),
  me: {
    user: { id: 'member' },
    activeDepartmentId: 'first',
    memberships: [],
    actingForUserId: null,
  },
}))
vi.mock('../../src/features/ai/api.js', () => ({ fetchAiSettings: fixture.fetchSettings }))
vi.mock('../../src/lib/session.js', () => ({ useMeQuery: () => ({ data: fixture.me }) }))
const output: QuickAddOutput = {
  title: 'Prepare the evidence pack',
  dueDate: '2026-10-30',
  priority: 'urgent',
  assigneeUserId: null,
  labelIds: [],
  projectId: null,
  confidence: { assignee: 'high', dueDate: 'high', priority: 'high' },
  ambiguous: [],
  notes: '',
}
beforeEach(() => {
  setLocale('en')
  fixture.me.activeDepartmentId = 'first'
  fixture.fetchSettings.mockReset()
})

describe('private task AI promises', () => {
  it('previews and preserves dates and priority as notes instead of pretending to schedule a private task', () => {
    const request = 'Prepare the evidence pack by Friday, urgent'
    const notes = personalQuickAddNotes(output, request, t, 'en')
    expect(notes).toContain('Requested date:')
    expect(notes).toContain('Requested priority: Urgent')
    expect(notes).toContain(`Original request: ${request}`)
    render(<PersonalQuickAddPreview output={output} request={request} />)
    expect(screen.getByText('Saved in notes')).toBeVisible()
    expect(screen.getByText(/Private tasks keep dates and priority in notes/)).toBeVisible()
    expect(screen.getByText(/Requested date:/)).toHaveTextContent(notes!.replace(/\n/g, ' '))
  })
  it('keeps a simple title simple and retains uncertainty notes when present', () => {
    const plain = { ...output, dueDate: null, priority: 'none' as const }
    expect(personalQuickAddNotes(plain, plain.title, t, 'en')).toBeNull()
    expect(
      personalQuickAddNotes(
        { ...plain, notes: 'Check which report was intended.' },
        plain.title,
        t,
        'en',
      ),
    ).toBe('Check which report was intended.')
  })
  it('hides unavailable helpers, responds to hard budget stops, and never leaks another department’s availability', async () => {
    fixture.fetchSettings.mockResolvedValue({
      flags: { quick_add_parse: true },
      budgetStatus: 'ok',
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result, rerender } = renderHook(() => useAiFeatureEnabled('quick_add_parse'), {
      wrapper,
    })
    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
    act(() =>
      client.setQueryData(['ai', 'settings', 'member', 'first', null], {
        flags: { quick_add_parse: true },
        budgetStatus: 'hard_stop',
      }),
    )
    await waitFor(() => expect(result.current).toBe(false))
    fixture.fetchSettings.mockResolvedValue({
      flags: { quick_add_parse: false },
      budgetStatus: 'ok',
    })
    fixture.me.activeDepartmentId = 'second'
    rerender()
    expect(result.current).toBe(false)
    await waitFor(() => expect(fixture.fetchSettings).toHaveBeenCalledTimes(2))
    expect(result.current).toBe(false)
    client.clear()
  })
})
