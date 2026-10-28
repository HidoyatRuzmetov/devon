import type { AiChatProposal } from '@devon/contracts'
import { setLocale } from '@devon/i18n'
import { TooltipProvider } from '@devon/ui'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chatFailure } from '../../src/features/ai/chat-failure.js'
import { useChatFiles } from '../../src/features/ai/components/chat-files.js'
import {
  ChatProposalBatch,
  ProposalArguments,
} from '../../src/features/ai/components/chat-proposal.js'
import { ApiError } from '../../src/lib/api-client.js'

const calls = vi.hoisted(() => ({
  execute: vi.fn(),
  discard: vi.fn(),
  upload: vi.fn(),
  batch: vi.fn(),
  edit: vi.fn(),
}))
vi.mock('../../src/features/ai/conversations.js', () => ({
  useConversationProposalMutation: (kind: string) => ({
    mutate: kind === 'execute' ? calls.execute : calls.discard,
    mutateAsync: kind === 'execute' ? calls.execute : calls.discard,
    isPending: false,
    error: null,
  }),
  useProposalBatchMutation: () => ({ mutate: calls.batch, isPending: false, isError: false }),
  useEditProposalMutation: () => ({ mutate: calls.edit, isPending: false, isError: false }),
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

const messageId = '0b606c97-1f5e-4514-8909-b3491d556b5d'
function Review({
  proposals = [proposal],
  onEdit = vi.fn(),
}: {
  proposals?: AiChatProposal[]
  onEdit?: (p: AiChatProposal) => void
}) {
  return (
    <TooltipProvider>
      <ChatProposalBatch
        proposals={proposals}
        messageId={messageId}
        conversationId={conversationId}
        sources={sources}
        attachments={[]}
        onEdit={onEdit}
        disabled={false}
      />
    </TooltipProvider>
  )
}
describe('assistant action review', () => {
  it('distinguishes an empty AI answer from a service outage without losing the retry', () => {
    expect(chatFailure('empty_response')).toEqual({
      key: 'assistantActions.emptyResponse',
      retryable: true,
      newConversation: false,
    })
    expect(chatFailure('provider_unavailable').key).not.toBe(chatFailure('empty_response').key)
  })
  it('shows the actual target and change without expanding implementation details', () => {
    render(<Review />)
    expect(screen.getByRole('link', { name: 'Canonical evidence review' })).toHaveAttribute(
      'href',
      expect.stringContaining(targetId),
    )
    expect(screen.getByText('Done')).toBeVisible()
    expect(screen.getByText(/Update card/)).toBeVisible()
    expect(screen.queryByText('3')).toBeNull()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(calls.batch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
    expect(screen.getByText('3')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm selected' }))
    expect(calls.batch).toHaveBeenCalledWith({
      conversationId,
      messageId,
      proposals: [{ id: proposal.id, revision: 0, selected: true }],
    })
  })
  it('confirms a reviewed selection once and discards unchecked changes', () => {
    const other = { ...proposal, id: targetId, title: 'Another change', revision: 2 }
    render(<Review proposals={[proposal, other]} />)
    const checks = screen.getAllByRole('checkbox')
    expect(checks.every((c) => c.getAttribute('aria-checked') === 'true')).toBe(true)
    fireEvent.click(checks[1]!)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm selected' }))
    expect(calls.batch).toHaveBeenCalledOnce()
    expect(calls.batch).toHaveBeenCalledWith({
      conversationId,
      messageId,
      proposals: [
        { id: proposal.id, revision: 0, selected: true },
        { id: other.id, revision: 2, selected: false },
      ],
    })
    expect(calls.execute).not.toHaveBeenCalled()
  })
  it('unchecks dependent changes when their prerequisite is unchecked and restores them together', () => {
    const parent = { ...proposal, key: 'parent', kind: 'project.create', title: 'Create project' }
    const child = {
      ...proposal,
      id: targetId,
      title: 'Create assignment',
      bindings: [{ path: 'body.projectId', from: 'parent' }],
    }
    render(<Review proposals={[parent, child]} />)
    const checks = screen.getAllByRole('checkbox')
    fireEvent.click(checks[0]!)
    expect(checks[1]).not.toBeChecked()
    expect(checks[1]).toBeDisabled()
    fireEvent.click(checks[0]!)
    expect(checks[1]).toBeChecked()
    expect(checks[1]).not.toBeDisabled()
    expect(screen.getByText('Uses: Create project')).toBeVisible()
  })
  it('allows discarding the entire selection without executing anything', () => {
    render(<Review />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Discard all' }))
    expect(calls.batch).toHaveBeenCalledWith({
      conversationId,
      messageId,
      proposals: [{ id: proposal.id, revision: 0, selected: false }],
    })
  })
  it('edits the proposed values with a revision guard and blocks confirmation until saved', () => {
    render(<Review />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit request' }))
    expect(screen.getByRole('button', { name: 'Confirm selected' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'archived' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(calls.edit).toHaveBeenCalledWith(
      {
        conversationId,
        proposalId: proposal.id,
        revision: 0,
        arguments: { id: targetId, body: { status: 'archived', version: 3 } },
      },
      expect.any(Object),
    )
    expect(calls.execute).not.toHaveBeenCalled()
  })
  it('invalidates the old proposal before requesting a revision in chat', () => {
    const edit = vi.fn()
    render(<Review onEdit={edit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask assistant to revise' }))
    expect(edit).not.toHaveBeenCalled()
    act(() => calls.discard.mock.calls[0]![1].onSuccess())
    expect(edit).toHaveBeenCalledWith(proposal)
    expect(calls.execute).not.toHaveBeenCalled()
  })
  it('keeps a partial result reachable without offering a duplicate execution', () => {
    render(
      <Review
        proposals={[
          {
            ...proposal,
            status: 'failed',
            error: 'attachment_failed',
            result: { href: '/pages?page=created-page', label: 'Created page' },
          },
        ]}
      />,
    )
    expect(screen.getByRole('link', { name: 'Open result' })).toHaveAttribute(
      'href',
      expect.stringContaining('created-page'),
    )
    expect(screen.getByText(/not all files were attached/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Confirm selected' })).toBeNull()
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
