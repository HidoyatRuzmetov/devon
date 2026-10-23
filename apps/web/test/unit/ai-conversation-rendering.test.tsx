import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnswerMarkdown } from '../../src/features/ai/components/answer-markdown.js'
import { chatSourceHref } from '../../src/features/ai/chat-source-href.js'
import { chatFailure } from '../../src/features/ai/chat-failure.js'

describe('department conversation answers', () => {
  it('offers a new conversation for a full history instead of a futile retry', () => {
    expect(chatFailure('context_limit')).toMatchObject({ retryable: false, newConversation: true })
    expect(chatFailure('budget_exceeded').retryable).toBe(false)
    expect(chatFailure('feature_disabled').retryable).toBe(false)
    expect(chatFailure('timeout').retryable).toBe(true)
    expect(chatFailure('provider_unavailable').retryable).toBe(true)
    expect(chatFailure('interrupted').key).toBe('overviewChat.errors.interrupted')
  })
  it('renders readable headings, emphasis and lists without executing model HTML or URLs', () => {
    const { container } = render(
      <AnswerMarkdown
        content={
          '## Progress\n**Six projects** are active.\n- Review the milestones\n- Ask the owners\n\n<script>alert(1)</script>\n[Click me](javascript:alert(1))'
        }
      />,
    )
    expect(screen.getByRole('heading', { name: 'Progress' })).toBeInTheDocument()
    expect(container.querySelector('strong')).toHaveTextContent('Six projects')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
  })

  it('keeps code literal and supports ordered steps', () => {
    const { container } = render(
      <AnswerMarkdown
        content={'1. First\n2. Second\n\n```html\n<img src=x onerror=alert(1)>\n```'}
      />,
    )
    expect(container.querySelector('ol')).toHaveTextContent('FirstSecond')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('code')).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('renders inline citations only when they match a verified same-origin source', () => {
    render(
      <AnswerMarkdown
        content={
          'See [the milestone](/projects/view?id=123), [unverified](/work/card?id=999) and [external](https://evil.test).'
        }
        sources={['/projects/view?id=123', 'https://evil.test']}
      />,
    )
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'the milestone' })).toHaveAttribute(
      'href',
      '/projects/view?id=123&from=assistant',
    )
  })

  it('only links internal citation paths and preserves a route back to the overview', () => {
    expect(chatSourceHref('/projects/view?id=123')).toBe('/projects/view?id=123&from=assistant')
    expect(chatSourceHref('/pages?page=123#detail')).toBe('/pages?page=123&from=assistant#detail')
    const conversation = 'bfbf5d9b-1ae7-4a2c-9da8-415639821045'
    expect(chatSourceHref('/work/card?id=123', conversation)).toBe(
      `/work/card?id=123&from=assistant&conversation=${conversation}`,
    )
    expect(chatSourceHref('/work/card?id=123', '//evil.test')).toBe(
      '/work/card?id=123&from=assistant',
    )
    for (const href of [
      '//evil.test',
      '/\\evil.test',
      '/\n/evil.test',
      'javascript:alert(1)',
      'https://evil.test',
    ])
      expect(chatSourceHref(href)).toBeNull()
  })
})
