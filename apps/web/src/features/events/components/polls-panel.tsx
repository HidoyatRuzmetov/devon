// Polls (TECH-SPEC §3.4: "date / single / multi, anonymous option, deadline, results animation").
// Voting replaces the caller's whole ballot server-side (`service.ts`'s `voteOnPoll`), so "change
// vote" is just "vote again" here -- no separate retract step.
import * as React from 'react'
import { useT, useLocale, formatDate, formatTime } from '@devon/i18n'
import {
  Badge,
  Button,
  Celebrate,
  Checkbox,
  cn,
  Field,
  Input,
  Select,
  Skeleton,
  StateView,
  toast,
  toastWithUndo,
  useCelebrate,
  useReducedMotion,
} from '@devon/ui'
import { Plus, X } from 'lucide-react'
import { useCreatePollMutation, usePollsQuery, useVoteOnPollMutation } from '../hooks.js'
import type { PollDto } from '../schemas.js'

function PollResultBar({
  option,
  totalVotes,
}: {
  option: PollDto['options'][number]
  totalVotes: number
}) {
  const reducedMotion = useReducedMotion()
  const pct = totalVotes > 0 ? Math.round((option.votes / totalVotes) * 100) : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-small text-foreground">
        <span className={cn(option.votedByMe && 'font-medium')}>{option.label}</span>
        <span className="text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full bg-primary',
            !reducedMotion && 'transition-[width] duration-(--dur-page) ease-out',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function PollCard({ eventId, poll }: { eventId: string; poll: PollDto }) {
  const t = useT()
  const voteMutation = useVoteOnPollMutation(eventId)
  const [selected, setSelected] = React.useState<string[]>(
    poll.options.filter((o) => o.votedByMe).map((o) => o.id),
  )
  const closed =
    poll.status === 'closed' || (poll.closesAt !== null && new Date(poll.closesAt) < new Date())
  const hasVoted = poll.options.some((o) => o.votedByMe)
  const [editing, setEditing] = React.useState(false)
  const showBallot = !closed && (editing || !hasVoted)

  const toggle = (optionId: string) => {
    if (poll.kind === 'multi') {
      setSelected((prev) =>
        prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
      )
    } else {
      setSelected([optionId])
    }
  }

  // §11: "poll vote retraction ... use toastWithUndo". Voting replaces the whole ballot server-side
  // (this file's own header comment) and the API requires at least one option (`optionIds.min(1)`),
  // so there is no true "vote for nothing" call to make -- the closest, honest retraction available
  // from here is reverting to whatever the previous ballot was. A first-ever vote has no previous
  // ballot to revert to, so it gets the plain confirmation instead of an undo it can't fulfil.
  const previousSelected = poll.options.filter((o) => o.votedByMe).map((o) => o.id)
  // A vote is a small commitment somebody just made -- the same shape as an RSVP, which has carried
  // the burst since v1.0. Kept to the *first* vote on a poll: changing a ballot already has the undo
  // toast, and a celebration on every edit would be the product cheering at indecision.
  const voteCelebrate = useCelebrate()

  const handleVote = async () => {
    if (selected.length === 0) return
    const hadPreviousVote = previousSelected.length > 0
    try {
      await voteMutation.mutateAsync({ pollId: poll.id, optionIds: selected })
      setEditing(false)
      if (hadPreviousVote) {
        toastWithUndo({
          message: t('events.polls.voteChangedToast'),
          undoLabel: t('events.actions.undo'),
          onUndo: () => {
            voteMutation.mutate(
              { pollId: poll.id, optionIds: previousSelected },
              { onSuccess: () => toast(t('events.polls.voteRevertedToast')) },
            )
          },
        })
      } else {
        voteCelebrate.fire()
        toast(t('events.polls.votedToast'))
      }
    } catch {
      toast(t('events.error.title'))
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-body font-medium text-foreground">{poll.question}</p>
          <p className="text-caption text-muted-foreground">
            {t('events.polls.createdBy', {
              name: `${poll.createdBy.givenName} ${poll.createdBy.familyName}`,
            })}
          </p>
        </div>
        {closed ? <Badge tone="neutral">{t('events.polls.closed')}</Badge> : null}
      </div>

      {showBallot ? (
        <div className="flex flex-col gap-2">
          {poll.options.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-center gap-2 rounded-sm border border-border px-3 py-2 hover:bg-accent"
            >
              {poll.kind === 'multi' ? (
                <Checkbox
                  checked={selected.includes(option.id)}
                  onCheckedChange={() => toggle(option.id)}
                />
              ) : (
                <input
                  type="radio"
                  name={`poll-${poll.id}`}
                  checked={selected.includes(option.id)}
                  onChange={() => toggle(option.id)}
                  className="size-4 accent-[var(--color-primary)]"
                />
              )}
              <span className="text-small text-foreground">{option.label}</span>
            </label>
          ))}
          <div className="flex justify-end">
            <span className="relative inline-flex">
              <Button
                size="sm"
                onClick={handleVote}
                loading={voteMutation.isPending}
                disabled={selected.length === 0}
              >
                {t('events.polls.vote')}
              </Button>
              <Celebrate play={voteCelebrate.play} onDone={voteCelebrate.onDone} />
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {poll.options.map((option) => (
            <PollResultBar key={option.id} option={option} totalVotes={poll.totalVotes} />
          ))}
          <div className="flex items-center justify-between">
            <p className="text-caption text-muted-foreground">
              {t('events.polls.totalVotes', { count: poll.totalVotes })}
            </p>
            {!closed && hasVoted ? (
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                {t('events.polls.changeVote')}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </li>
  )
}

function CreatePollForm({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const t = useT()
  const locale = useLocale()
  const createMutation = useCreatePollMutation(eventId)
  const [kind, setKind] = React.useState<'date' | 'single' | 'multi'>('single')
  const [question, setQuestion] = React.useState('')
  const [anonymous, setAnonymous] = React.useState(false)
  const [closesAt, setClosesAt] = React.useState('')
  const [options, setOptions] = React.useState<string[]>(['', ''])

  const setOption = (index: number, value: string) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean)
    if (!question.trim() || cleanOptions.length < 2) return
    try {
      await createMutation.mutateAsync({
        kind,
        question: question.trim(),
        anonymous,
        closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
        options: cleanOptions.map((value) => {
          if (kind !== 'date') return { label: value }
          const date = new Date(value)
          return {
            label: `${formatDate(date, locale)} · ${formatTime(date, locale)}`,
            optionDate: date.toISOString(),
          }
        }),
      })
      onDone()
    } catch {
      toast(t('events.error.title'))
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-border p-4"
    >
      <Field label={t('events.polls.kindLabel')} htmlFor="poll-kind">
        <Select
          id="poll-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          options={[
            { value: 'single', label: t('events.polls.kind.single') },
            { value: 'multi', label: t('events.polls.kind.multi') },
            { value: 'date', label: t('events.polls.kind.date') },
          ]}
        />
      </Field>
      <Field label={t('events.polls.questionLabel')} htmlFor="poll-question">
        <Input
          id="poll-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('events.polls.questionPlaceholder')}
          maxLength={200}
        />
      </Field>
      <Field label={t('events.polls.optionsLabel')} htmlFor="poll-option-0">
        <div className="flex flex-col gap-2">
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                id={`poll-option-${index}`}
                type={kind === 'date' ? 'datetime-local' : 'text'}
                value={option}
                onChange={(e) => setOption(index, e.target.value)}
                placeholder={kind === 'date' ? undefined : t('events.polls.optionPlaceholder')}
              />
              {options.length > 2 ? (
                <button
                  type="button"
                  aria-label={t('events.polls.removeOption')}
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setOptions((prev) => [...prev, ''])}
            className="w-fit"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t('events.polls.addOption')}
          </Button>
        </div>
      </Field>
      <Field label={t('events.polls.closesAtLabel')} htmlFor="poll-closes-at">
        <Input
          id="poll-closes-at"
          type="datetime-local"
          value={closesAt}
          onChange={(e) => setClosesAt(e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={anonymous}
          onCheckedChange={(v) => setAnonymous(v === true)}
          id="poll-anonymous"
        />
        <label htmlFor="poll-anonymous" className="text-small text-foreground">
          {t('events.polls.anonymousLabel')}
        </label>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={createMutation.isPending}>
          {t('events.polls.create')}
        </Button>
      </div>
    </form>
  )
}

export function PollsPanel({ eventId }: { eventId: string }) {
  const t = useT()
  const pollsQuery = usePollsQuery(eventId, true)
  const [showForm, setShowForm] = React.useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
          {t('events.polls.create')}
        </Button>
      </div>

      {showForm ? <CreatePollForm eventId={eventId} onDone={() => setShowForm(false)} /> : null}

      {renderPollsBody()}
    </div>
  )

  function renderPollsBody() {
    if (pollsQuery.isPending) return <Skeleton className="h-32 w-full" />
    if (pollsQuery.isError) {
      return <StateView kind="error" titleKey="events.error.title" bodyKey="events.error.body" />
    }
    if (pollsQuery.data.items.length === 0) {
      return <p className="text-small text-muted-foreground">{t('events.polls.empty')}</p>
    }
    return (
      <ul className="flex flex-col gap-3">
        {pollsQuery.data.items.map((poll) => (
          <PollCard key={poll.id} eventId={eventId} poll={poll} />
        ))}
      </ul>
    )
  }
}
