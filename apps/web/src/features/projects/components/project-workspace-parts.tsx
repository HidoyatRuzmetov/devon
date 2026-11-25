import type { ReactNode } from 'react'
import { useT } from '@devon/i18n'
import { Avatar, Badge, Button, Input, ProgressRing, initialsFromName } from '@devon/ui'
import { ListTodo } from 'lucide-react'
import { WORK_TITLE_MAX } from '@devon/contracts'

/** Shared, state-free project UI: production supplies mutations; practice supplies local state. */
export function ProjectWorkspaceHeading({
  title,
  description,
  percent,
  actions,
  status = 'active',
  colour,
}: {
  title: string
  description?: string | undefined
  percent: number
  actions?: ReactNode
  status?: string
  colour?: string
}) {
  const t = useT()
  return (
    <header className="flex items-start gap-3">
      <ProgressRing
        value={percent}
        size={56}
        strokeWidth={4.5}
        label={t('projects.tile.progressAria', { percent })}
        toneClassName="text-primary"
      >
        {percent}
      </ProgressRing>
      <div className="min-w-0 flex-1 space-y-2">
        <h1 className="break-words font-display text-h3 sm:text-h2">{title}</h1>
        <div className="flex items-center gap-2">
          {colour ? (
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: colour }}
              aria-hidden="true"
            />
          ) : null}
          <Badge tone="neutral">{t(`projects.status.${status}`)}</Badge>
        </div>
        {description ? (
          <p className="max-w-160 text-body text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions}
    </header>
  )
}
export function ProjectMemberPanel({
  name,
  givenName,
  familyName,
  avatar,
  count,
  children,
}: {
  name: string
  givenName: string
  familyName: string
  avatar?: string | null | undefined
  count: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <Avatar
          size="sm"
          src={avatar ?? null}
          alt={name}
          initials={initialsFromName(givenName, familyName)}
          hueSeed={name}
        />
        <span className="text-small font-medium">{name}</span>
        <span className="text-caption text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  )
}
export function ProjectAssignmentComposer({
  value,
  onChange,
  onSubmit,
  pending = false,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  pending?: boolean
}) {
  const t = useT()
  return (
    <form
      className="flex gap-2 pt-1"
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim() && !pending) onSubmit()
      }}
    >
      <Input
        value={value}
        maxLength={WORK_TITLE_MAX}
        title={t('portal.cards.titleLimit', { count: WORK_TITLE_MAX })}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('projects.card.addSubjectivePlaceholder')}
        aria-label={t('projects.card.addSubjectivePlaceholder')}
      />
      <Button type="submit" size="sm" variant="secondary" disabled={!value.trim() || pending}>
        {t('work.action.save')}
      </Button>
    </form>
  )
}
export function ProjectAssignmentFrame({
  title,
  onOpen,
  children,
}: {
  title: string
  onOpen: () => void
  children: ReactNode
}) {
  return (
    <article className="my-1 rounded-md border border-border/70 bg-card px-2.5 py-2 shadow-xs">
      <div className="flex min-h-7 items-center gap-2">
        <ListTodo className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 break-words text-left text-small font-semibold hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
        >
          {title}
        </button>
      </div>
      {children}
    </article>
  )
}
