import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StateView, type StateKind } from './state-view.js'

const KEYS: Record<StateKind, { titleKey: string; bodyKey?: string; actionLabelKey: string }> = {
  empty: {
    titleKey: 'home.empty.member.title',
    bodyKey: 'home.empty.member.body',
    actionLabelKey: 'home.empty.action',
  },
  loading: { titleKey: 'state.loading', actionLabelKey: 'state.error.action' },
  error: {
    titleKey: 'state.error.title',
    bodyKey: 'state.error.body',
    actionLabelKey: 'state.error.action',
  },
  forbidden: {
    titleKey: 'state.denied.title',
    bodyKey: 'state.denied.body',
    actionLabelKey: 'state.denied.action',
  },
  offline: {
    titleKey: 'state.offline.banner',
    bodyKey: 'state.offline.body',
    actionLabelKey: 'state.error.action',
  },
}

describe('StateView', () => {
  it.each(Object.keys(KEYS) as StateKind[])(
    'renders exactly one [data-primary] element for kind="%s" when an action is given',
    (kind) => {
      const { titleKey, bodyKey, actionLabelKey } = KEYS[kind]
      const onAction = vi.fn()
      const { container } = render(
        <StateView
          kind={kind}
          titleKey={titleKey}
          bodyKey={bodyKey}
          action={{ labelKey: actionLabelKey, onAction }}
        />,
      )
      expect(container.querySelectorAll('[data-primary]')).toHaveLength(1)
    },
  )

  it('renders zero [data-primary] elements when no action is given', () => {
    const { container } = render(<StateView kind="empty" titleKey="home.empty.member.title" />)
    expect(container.querySelectorAll('[data-primary]')).toHaveLength(0)
  })

  it('never renders a second action -- there is no secondary-action prop to misuse', () => {
    render(
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: () => {} }}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('shows the error state as an alert with a copyable request id, never a raw status code', () => {
    render(
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        requestId="8f3a-c210"
      />,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    const requestLine = screen.getByText(/8f3a-c210/)
    expect(requestLine.textContent).not.toMatch(/\b[45]\d\d\b/)
    expect(requestLine).toHaveClass('select-text')
  })

  it('announces the loading kind via a polite live region with the title read to screen readers', () => {
    render(<StateView kind="loading" titleKey="state.loading" />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })
})
