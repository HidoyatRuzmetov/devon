import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import { ProjectPractice } from '../../src/features/onboarding/practice.js'

beforeEach(() => {
  setLocale('en')
})
it('teaches project → task → checklist without making network writes', () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const done = vi.fn()
  render(<ProjectPractice onDone={done} onClose={vi.fn()} />)
  expect(screen.getByText(/No real project, card, or notification/)).toBeVisible()
  fireEvent.change(screen.getByLabelText('Project name'), {
    target: { value: 'Example workshop' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create example' }))
  fireEvent.change(screen.getByLabelText('Add an individual card'), {
    target: { value: 'Prepare agenda' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  fireEvent.change(screen.getByLabelText('Checklist item'), {
    target: { value: 'List topics' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add checklist item' }))
  expect(screen.getByRole('button', { name: 'Done — continue guide' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'List topics' }))
  // A checklist update does not complete the card or a project milestone.
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  fireEvent.click(screen.getByRole('button', { name: 'Done — continue guide' }))
  expect(done).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockRestore()
})
