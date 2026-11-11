import { setLocale } from '@devon/i18n'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationTitle } from '../../src/features/ai/components/conversation-title.js'

describe('Assistant conversation names', () => {
  beforeEach(() => {
    setLocale('en')
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the pending line, then types a title once while exposing its complete accessible name', () => {
    const row = (title: string, titleStatus: 'pending' | 'ready') => (
      <button>
        <ConversationTitle title={title} titleStatus={titleStatus} animate />
      </button>
    )
    const { container, rerender } = render(row('', 'pending'))
    expect(screen.getByRole('button', { name: 'Naming conversation…' })).toBeInTheDocument()
    expect(container.querySelector('.devon-shimmer')).toBeInTheDocument()
    const name = 'Weekly priorities'
    rerender(row(name, 'ready'))
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(78))
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent(/^Wee$/)
    rerender(row(name, 'ready'))
    act(() => vi.advanceTimersByTime(1_000))
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(screen.getByRole('button', { name })).toHaveTextContent(name)
    rerender(row('Updated priorities', 'ready'))
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('keeps old titles readable during backfill and renders an already-named history immediately', () => {
    const { container, rerender } = render(
      <ConversationTitle title="Earlier question" titleStatus="pending" animate />,
    )
    expect(screen.getByText('Earlier question')).toBeVisible()
    expect(container.querySelector('.devon-shimmer')).toBeNull()
    rerender(<ConversationTitle title="Project deadlines" titleStatus="ready" animate />)
    expect(screen.getByText('Project deadlines')).toBeVisible()
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('honors reduced motion and distinguishes an unsent chat from a pending title', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    const { container, rerender } = render(
      <ConversationTitle title="" titleStatus="empty" animate />,
    )
    expect(screen.getByText('New conversation')).toBeVisible()
    rerender(<ConversationTitle title="" titleStatus="pending" animate />)
    rerender(<ConversationTitle title="People directory" titleStatus="ready" animate />)
    expect(screen.getByText('People directory')).toBeVisible()
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
