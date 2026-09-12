// "Assign a task" from a people-table row, a directory hover card, or a person page (v1.1 SPEC §4.3
// "Row actions: assign a task (quick-add sheet with assignee preset, title, due, priority)").
//
// The assignee is never a field here -- it is the row you clicked, shown as a person chip so the
// head can see who they are about to give work to and cannot pick the wrong one by accident. The
// giver is the signed-in head, because a card given by nobody is the bug the board's "giver avatar"
// exists to make visible.
//
// A shared primitive in spirit: the merge may promote this to `packages/ui` once `fields` and
// `work-plus` want the same sheet. Until then it lives in this feature, per the package brief.
import * as React from 'react'
import { useLocale, useT } from '@devon/i18n'
import {
  Avatar,
  Button,
  DatePicker,
  Field,
  Input,
  Select,
  Sheet,
  SheetClose,
  SheetContent,
  initialsFromName,
  toast,
} from '@devon/ui'
import { X } from 'lucide-react'
import { avatarUrl } from '../../../lib/avatar.js'

export type QuickAssignTarget = {
  userId: string
  givenName: string
  familyName: string
  title: string | null
  avatarKey: string | null
}

export type QuickAssignSubmit = {
  assigneeUserId: string
  title: string
  dueAt: string | null
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
}

export type QuickAssignSheetProps = {
  target: QuickAssignTarget | null
  onOpenChange: (open: boolean) => void
  onSubmit(input: QuickAssignSubmit): Promise<void>
  pending: boolean
}

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const

export function QuickAssignSheet({
  target,
  onOpenChange,
  onSubmit,
  pending,
}: QuickAssignSheetProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [title, setTitle] = React.useState('')
  const [due, setDue] = React.useState<Date | undefined>(undefined)
  const [priority, setPriority] = React.useState<(typeof PRIORITIES)[number]>('none')
  const [touched, setTouched] = React.useState(false)
  const titleRef = React.useRef<HTMLInputElement>(null)

  // A fresh sheet every time it opens: a title left over from the last person is how work ends up on
  // the wrong desk.
  React.useEffect(() => {
    if (!target) return
    setTitle('')
    setDue(undefined)
    setPriority('none')
    setTouched(false)
    const id = window.setTimeout(() => titleRef.current?.focus(), 120)
    return () => window.clearTimeout(id)
  }, [target])

  const name = target ? `${target.givenName} ${target.familyName}`.trim() : ''
  const invalid = title.trim().length === 0

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    setTouched(true)
    if (invalid || !target) return
    await onSubmit({
      assigneeUserId: target.userId,
      title: title.trim(),
      dueAt: due ? due.toISOString() : null,
      priority,
    })
    toast.success(t('people.assign.done', { name }))
    onOpenChange(false)
  }

  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange} direction="right">
      <SheetContent side="right" title={t('people.assign.title')}>
        <form onSubmit={submit} className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-h3">{t('people.assign.title')}</h2>
              <p className="text-caption text-muted-foreground">{t('people.assign.subtitle')}</p>
            </div>
            <SheetClose asChild>
              <Button variant="ghost" size="sm" aria-label={t('people.assign.close')}>
                <X aria-hidden="true" className="size-4" />
              </Button>
            </SheetClose>
          </header>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
              {target ? (
                <Avatar
                  size="sm"
                  alt={name}
                  hueSeed={target.userId}
                  initials={initialsFromName(target.givenName, target.familyName)}
                  src={avatarUrl(target.avatarKey, 64)}
                />
              ) : null}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-small font-medium">{name}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {target?.title ?? t('people.assign.noTitle')}
                </span>
              </span>
            </div>

            <Field
              label={t('people.assign.field.title')}
              htmlFor="people-assign-title"
              {...(touched && invalid
                ? { hint: t('people.assign.field.titleRequired') }
                : { hint: t('people.assign.field.titleHint') })}
            >
              <Input
                id="people-assign-title"
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('people.assign.field.titlePlaceholder')}
                aria-invalid={touched && invalid ? true : undefined}
                maxLength={300}
                autoComplete="off"
              />
            </Field>

            <Field label={t('people.assign.field.due')} htmlFor="people-assign-due">
              <DatePicker
                locale={locale}
                label={t('people.assign.field.due')}
                selected={due}
                onSelect={setDue}
                placeholder={t('people.assign.field.duePlaceholder')}
              />
            </Field>

            <Field label={t('people.assign.field.priority')} htmlFor="people-assign-priority">
              <Select
                id="people-assign-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}
                options={PRIORITIES.map((value) => ({
                  value,
                  label: t(`people.assign.priority.${value}`),
                }))}
              />
            </Field>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            <SheetClose asChild>
              <Button type="button" variant="secondary">
                {t('people.assign.cancel')}
              </Button>
            </SheetClose>
            <Button type="submit" loading={pending} disabled={pending}>
              {t('people.assign.submit')}
            </Button>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  )
}
