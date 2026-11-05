import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import type { Card } from '../../src/features/work/api.js'
import { ApiError } from '../../src/lib/api-client.js'
import { RestoreCardButton } from '../../src/features/work/components/restore-card-button.js'

const state = vi.hoisted(() => ({ error: null as unknown, allowed: true, recover: vi.fn() }))
vi.mock('../../src/features/work/hooks.js', () => ({
  useRestoreCardMutation: () => ({
    isPending: false,
    mutate: (_id: string, options: { onError: (error: unknown) => void }) =>
      options.onError(state.error),
  }),
}))
vi.mock('../../src/features/projects/hooks.js', () => ({
  useProjectRestoreDetails: () => ({
    isPending: false,
    isError: false,
    data: { id: 'project', title: 'Annual review', cardCount: 3, canRestore: state.allowed },
  }),
  useRestoreProjectAndCardMutation: () => ({
    isPending: false,
    isError: false,
    mutate: state.recover,
  }),
}))
beforeEach(() => {
  setLocale('en')
  state.allowed = true
  state.error = new ApiError(409, 'conflict', null, [
    { path: 'project', code: 'restore_project_first' },
  ])
  state.recover.mockClear()
})
function show() {
  render(
    <RestoreCardButton
      card={{ id: 'card', title: 'Brief', projectId: 'project', canEdit: true } as Card}
    />,
  )
  return userEvent.setup()
}
it('requires explicit consent after showing the wider project recovery scope', async () => {
  const user = show()
  await user.click(screen.getByRole('button', { name: 'Restore Brief' }))
  expect(
    await screen.findByRole('dialog', { name: 'Restore the group project?' }),
  ).toBeInTheDocument()
  expect(screen.getByText(/3 cards deleted with it/)).toBeInTheDocument()
  expect(state.recover).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Restore project and cards' }))
  expect(state.recover).toHaveBeenCalledWith(
    { projectId: 'project', cardId: 'card' },
    expect.any(Object),
  )
})
it('tells a card owner without project authority who can restore the group', async () => {
  state.allowed = false
  const user = show()
  await user.click(screen.getByRole('button', { name: 'Restore Brief' }))
  expect(await screen.findByText(/Ask its owner or your department head/)).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Restore project and cards' }),
  ).not.toBeInTheDocument()
  expect(state.recover).not.toHaveBeenCalled()
})
it('never offers broader recovery for an unrelated conflict', async () => {
  state.error = new ApiError(409, 'conflict', null)
  const user = show()
  await user.click(screen.getByRole('button', { name: 'Restore Brief' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(state.recover).not.toHaveBeenCalled()
})
