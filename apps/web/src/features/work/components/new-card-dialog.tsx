// SPEC §12 / WALKTHROUGH-FINDINGS §2.2 -- "the global + Yangi → Yangi vazifa does nothing".
//
// It used to navigate to `/work` and stop: no dialog, no focused input, `document.activeElement`
// still the button that was pressed. The most prominent control in the product had a dead primary
// item, and the person was dumped on the board to go and find the quick-add field themselves.
//
// This is that composer. `?new=1` on `/work` opens it -- the same query-string convention `/events?
// new=1` already uses, because `src/lib/router.tsx` is exact-path-only -- and presents regular
// labelled fields first. The board's `QuickAddBar` remains available under an optional
// disclosure, so experienced users can still use the typed grammar and AI parse. Closing clears
// the parameter, so Back does what it looks like it does and the URL is shareable.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Dialog, DialogContent, Input, toast } from '@devon/ui'
import { replaceSearchParam, useSearchParams } from '../../../lib/router.js'
import { useBoardQuery, useCreateCardMutation } from '../hooks.js'
import { QuickAddBar } from './quick-add-bar.js'

export function NewCardDialog() {
  const t = useT()
  const search = useSearchParams()
  const open = search.get('new') === '1'
  // The board screen already holds this query, so this shares its member list and request cache.
  const boardQuery = useBoardQuery()
  const members = boardQuery.data?.members ?? []
  const create = useCreateCardMutation()
  const [title, setTitle] = React.useState('')
  const [assignee, setAssignee] = React.useState('')
  const [due, setDue] = React.useState('')
  React.useEffect(() => {
    if (open) {
      setTitle('')
      setAssignee('')
      setDue('')
    }
  }, [open])

  function close(): void {
    replaceSearchParam('new', null)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      {open ? (
        <DialogContent title={t('work.actions.create')} className="max-w-2xl">
          <div className="flex flex-col gap-3 pt-2">
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (!title.trim()) return
                create.mutate(
                  {
                    title: title.trim(),
                    assigneeUserId: assignee || null,
                    dueAt: due ? new Date(`${due}T23:59:59+05:00`).toISOString() : null,
                  },
                  {
                    onSuccess: (card) => {
                      close()
                      replaceSearchParam('card', card.id)
                      toast(t('work.quickAdd.created', { title: card.title }))
                    },
                  },
                )
              }}
            >
              <label className="flex flex-col gap-1.5 text-small">
                {t('work.field.title')}
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-small">
                  {t('work.field.assignee')}
                  <select
                    aria-label={t('work.field.assignee')}
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                    className="h-10 rounded-sm border border-border bg-card px-3 text-foreground"
                  >
                    <option value="">{t('work.field.unassigned')}</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.givenName} {member.familyName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-small">
                  {t('work.field.due')}
                  <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                </label>
              </div>
              {create.isError ? (
                <p role="alert" className="text-small text-destructive">
                  {t('work.quickAdd.error')}
                </p>
              ) : null}
              <Button
                type="submit"
                className="self-start"
                loading={create.isPending}
                disabled={!title.trim()}
              >
                {t('work.actions.create')}
              </Button>
            </form>
            <details className="border-t border-border pt-3">
              <summary className="cursor-pointer text-small text-muted-foreground">
                {t('work.composer.quickEntry')}
              </summary>
              <p className="py-2 text-small text-muted-foreground">
                {t('work.quickAdd.dialogHint')}
              </p>
              <QuickAddBar
                members={members}
                onCreated={() => {
                  // One card, then out of the way: a composer that stayed open after creating would
                  // make "did that work?" the next question. The board behind it has already
                  // invalidated and re-rendered with the new card in place.
                  close()
                }}
              />
            </details>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

/** Opens the composer from anywhere -- the shell's "+ Yangi" menu routes here. */
export const NEW_CARD_PATH = '/work?new=1'
