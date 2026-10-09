import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '@devon/i18n'
import type { AutomationRuleBody } from '@devon/contracts'
import { RuleBuilder } from '../../src/features/automations/components/rule-builder.js'
import { groupRuns } from '../../src/features/automations/components/automations-screen.js'
import type { AutomationRun } from '../../src/features/automations/api.js'

beforeEach(() => setLocale('en'))
const initial: AutomationRuleBody = {
  name: 'Paused rule',
  trigger: 'card_field_changed',
  triggerConfig: { filter: 'label:request' },
  actions: [{ kind: 'notify_head' }],
  enabled: false,
}
function show(
  options: { initial?: AutomationRuleBody; triggerLocked?: boolean; busy?: boolean } = {},
) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const props = { members: [], labels: [], submitLabel: 'Save', onSubmit, onCancel, ...options }
  const view = render(<RuleBuilder {...props} />)
  return { ...view, props, onSubmit, onCancel, user: userEvent.setup() }
}
describe('automation builder state and semantics', () => {
  it.each(['set_priority', 'set_status'] as const)(
    'shows the real missing value in a legacy %s action and allows explicit repair',
    async (kind) => {
      const rule = { ...initial, trigger: 'card_created' as const, actions: [{ kind }] }
      const { user, onSubmit } = show({ initial: rule })
      const control = screen.getByRole('combobox', {
        name: kind === 'set_priority' ? 'Priority' : 'Status',
      })
      expect(control).toHaveValue('')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(screen.getByText('Choose or fill in the value for this action.')).toBeVisible(),
      )
      await user.selectOptions(control, kind === 'set_priority' ? 'high' : 'done')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(onSubmit).toHaveBeenCalledOnce()
    },
  )
  it('preserves an undated follow-up and distinguishes no deadline from zero days', async () => {
    const rule = {
      ...initial,
      trigger: 'card_created' as const,
      actions: [{ kind: 'create_followup' as const, title: 'Next step', dueInDays: null }],
    }
    const { user, onSubmit } = show({ initial: rule })
    expect(screen.getByRole('spinbutton', { name: 'Due in days' })).toHaveValue(null)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(rule)
  })
  it('keeps an incomplete assignment in the form and identifies the missing recipient', async () => {
    const { user, onSubmit } = show()
    await user.type(screen.getByRole('textbox', { name: 'Rule name' }), 'Incomplete assignment')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByText('Choose or fill in the value for this action.')).toBeVisible(),
    )
  })
  it('preserves a paused rule and shows the actual all-field matching setting', async () => {
    const { user, onSubmit } = show({ initial, triggerLocked: true })
    expect(screen.getByRole('combobox', { name: 'Event' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Which field' })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Any field' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith(initial)
  })
  it('preserves the card filter when choosing a different trigger for a copy', async () => {
    const { user, onSubmit } = show({ initial })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Event' }), 'card_status_changed')
    expect(screen.getByRole('textbox', { name: 'Which cards' })).toHaveValue('label:request')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        trigger: 'card_status_changed',
        triggerConfig: { filter: 'label:request' },
      }),
    )
  })
  it('accepts only one rapid submit and disables editing until the accepted write settles', async () => {
    const { props, rerender, onSubmit } = show({ initial })
    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!
    act(() => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })
    expect(onSubmit).toHaveBeenCalledOnce()
    rerender(<RuleBuilder {...props} busy />)
    expect(screen.getByRole('textbox', { name: 'Rule name' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Action' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    rerender(<RuleBuilder {...props} busy={false} />)
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })
})

it('groups interleaved runs once without duplicate React keys, retaining first-seen order', () => {
  const run = (id: string, ruleId: string, at: string): AutomationRun => ({
    id,
    ruleId,
    ruleName: ruleId,
    cardId: null,
    cardTitle: null,
    status: 'applied',
    detail: {},
    at,
  })
  const a = run('a', 'one', '2026-10-01T10:00:58Z')
  const b = run('b', 'two', '2026-10-01T10:00:57Z')
  const c = run('c', 'one', '2026-10-01T10:00:56Z')
  const d = run('d', 'one', '2026-10-01T09:59:00Z')
  const groups = groupRuns([a, b, c, d])
  expect(groups.map((group) => group.runs.map((item) => item.id))).toEqual([
    ['a', 'c'],
    ['b'],
    ['d'],
  ])
  expect(new Set(groups.map((group) => group.key)).size).toBe(3)
})
