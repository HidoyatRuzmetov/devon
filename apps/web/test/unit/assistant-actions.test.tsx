import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import type { AiChatProposal } from '@devon/contracts'
import { ChatProposal, ProposalArguments } from '../../src/features/ai/components/chat-proposal.js'
import { useChatFiles } from '../../src/features/ai/components/chat-files.js'
import { ApiError } from '../../src/lib/api-client.js'
import { chatFailure } from '../../src/features/ai/chat-failure.js'

const calls = vi.hoisted(() => ({ execute: vi.fn(), discard: vi.fn(), upload: vi.fn() }))
vi.mock('../../src/features/ai/conversations.js', () => ({
  useConversationProposalMutation: (kind: string) => ({
    mutate: kind === 'execute' ? calls.execute : calls.discard,
    mutateAsync: kind === 'execute' ? calls.execute : calls.discard,
    isPending: false,
    error: null,
  }),
  useConversationUploadMutation: () => ({ mutateAsync: calls.upload }),
}))
const conversationId = 'be36011e-1198-454b-8b21-fb20763b126f'
const targetId = '6afab574-4ec3-4e36-b49b-fc58b459216b'
const proposal: AiChatProposal = {
  id: '4a558181-6e63-4bb7-b332-0fc00a10daa1',
  kind: 'card.update',
  title: 'Complete the evidence review',
  summary: 'Mark the requested card as completed.',
  arguments: { id: targetId, body: { status: 'done', version: 3 } },
  status: 'pending',
}
const sources = [
  {
    ref: `card:${targetId}`,
    title: 'Canonical evidence review',
    href: `/work/card?id=${targetId}`,
  },
]
beforeEach(() => {
  vi.clearAllMocks()
  setLocale('en')
})

describe('assistant action review', () => {
  it.each([
    ['personal.task.create', 'Create private to-do'],
    ['personal.task.update', 'Update private to-do'],
    ['personal.sprint.create', 'Create planning period'],
    ['personal.sprint.update', 'Update planning period'],
  ] as const)('labels %s without exposing its backend identifier', (kind, label) => {
    render(
      <ChatProposal
        proposal={{ ...proposal, kind }}
        conversationId={conversationId}
        sources={sources}
        attachments={[]}
        onEdit={vi.fn()}
        disabled={false}
      />,
    )
    expect(screen.getByText(label)).toBeVisible()
    expect(screen.queryByText(kind)).toBeNull()
  })
  it('distinguishes an empty AI answer from a service outage without losing the retry', () => {
    expect(chatFailure('empty_response')).toEqual({
      key: 'assistantActions.emptyResponse',
      retryable: true,
      newConversation: false,
    })
    expect(chatFailure('provider_unavailable').key).not.toBe(chatFailure('empty_response').key)
  })
  it('shows actual target and changes and executes only after confirmation', async () => {
    render(
      <ChatProposal
        proposal={proposal}
        conversationId={conversationId}
        sources={sources}
        attachments={[]}
        onEdit={vi.fn()}
        disabled={false}
      />,
    )
    expect(screen.getByRole('link', { name: 'Canonical evidence review' })).toHaveAttribute(
      'href',
      expect.stringContaining(targetId),
    )
    expect(screen.getByText('Done')).toBeVisible()
    expect(screen.getByText('3')).toBeVisible()
    expect(screen.getByText('Update card')).toBeVisible()
    expect(calls.execute).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and apply' }))
    expect(calls.execute).toHaveBeenCalledWith({ conversationId, proposalId: proposal.id })
  })
  it('invalidates the old proposal before putting a revision in the composer', async () => {
    let finish!: () => void
    calls.discard.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const edit = vi.fn()
    render(
      <ChatProposal
        proposal={proposal}
        conversationId={conversationId}
        sources={sources}
        attachments={[]}
        onEdit={edit}
        disabled={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit request' }))
    expect(edit).not.toHaveBeenCalled()
    await act(async () => finish())
    expect(edit).toHaveBeenCalledWith(proposal)
    expect(calls.execute).not.toHaveBeenCalled()
  })
  it('keeps a partial result reachable without offering a duplicate execution', () => {
    render(
      <ChatProposal
        proposal={{
          ...proposal,
          status: 'failed',
          error: 'attachment_failed',
          result: { href: '/pages?page=created-page', label: 'Created page' },
        }}
        conversationId={conversationId}
        sources={sources}
        attachments={[]}
        onEdit={vi.fn()}
        disabled={false}
      />,
    )
    expect(screen.getByRole('link', { name: 'Created page' })).toBeVisible()
    expect(screen.getByText(/not all files were attached/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Confirm and apply' })).toBeNull()
  })
  it('renders full proposed page text as inert output with no model HTML or executable links', () => {
    const { container } = render(
      <ProposalArguments
        value={{
          body: {
            title: 'Phonebook',
            blocks: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'Find staff contacts' }],
                },
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: '<script>unsafe()</script>',
                      marks: [{ type: 'link', attrs: { href: 'javascript:unsafe()' } }],
                    },
                  ],
                },
              ],
            },
          },
        }}
        sources={[]}
        attachments={[]}
        conversationId={conversationId}
      />,
    )
    expect(screen.getByText('Find staff contacts')).toBeVisible()
    expect(screen.getByText('<script>unsafe()</script>')).toBeVisible()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })
})

describe('conversation file staging', () => {
  it('does not upload a queued file removed while an earlier file is transferring', async () => {
    let finish!: (value: { id: string; name: string; mime: string; size: number }) => void
    calls.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { result } = renderHook(() => useChatFiles(conversationId, async () => conversationId))
    let pending!: Promise<void>
    act(() => {
      pending = result.current.add([
        new File(['first'], 'first.txt'),
        new File(['second'], 'second.txt'),
      ])
    })
    await waitFor(() => expect(result.current.files).toHaveLength(2))
    act(() => result.current.remove(result.current.files[1]!.localId))
    await act(async () => {
      finish({ id: targetId, name: 'first.txt', mime: 'text/plain', size: 5 })
      await pending
    })
    expect(calls.upload).toHaveBeenCalledOnce()
    expect(result.current.ready).toHaveLength(1)
    expect(result.current.blocked).toBe(false)
  })
  it('retries a failed scanner using the same uploaded file and keeps it out of messages until ready', async () => {
    calls.upload.mockImplementationOnce(async (input: { onScanning: (id: string) => void }) => {
      input.onScanning(targetId)
      throw new ApiError(503, 'unavailable', null)
    })
    calls.upload.mockResolvedValueOnce({
      id: targetId,
      name: 'report.txt',
      mime: 'text/plain',
      size: 6,
    })
    const { result } = renderHook(() => useChatFiles(conversationId, async () => conversationId))
    await act(async () => result.current.add([new File(['report'], 'report.txt')]))
    expect(result.current.blocked).toBe(true)
    expect(result.current.ready).toHaveLength(0)
    expect(result.current.files[0]?.error).toBe('attachments.scanUnavailable')
    act(() => result.current.retry(result.current.files[0]!.localId))
    await waitFor(() => expect(result.current.ready).toHaveLength(1))
    expect(calls.upload.mock.calls[1]?.[0]).toMatchObject({ finalizeId: targetId })
  })
  it('keeps staged files with their originating conversation', async () => {
    calls.upload.mockResolvedValue({
      id: targetId,
      name: 'report.txt',
      mime: 'text/plain',
      size: 6,
    })
    const { result, rerender } = renderHook(
      ({ id }) => useChatFiles(id, async () => conversationId),
      { initialProps: { id: conversationId } },
    )
    await act(async () => result.current.add([new File(['report'], 'report.txt')]))
    rerender({ id: 'other-conversation' })
    expect(result.current.ready).toHaveLength(0)
    expect(result.current.files).toHaveLength(0)
    rerender({ id: conversationId })
    expect(result.current.ready[0]?.id).toBe(targetId)
  })
})
