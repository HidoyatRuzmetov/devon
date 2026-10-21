import * as React from 'react'
import { useT } from '@devon/i18n'
import { Avatar, Button, Sheet, SheetContent, initialsFromName } from '@devon/ui'
import { ChevronRight, GraduationCap, Mail, Phone, X } from 'lucide-react'
import { professionalProfileSchema } from '@devon/contracts'
import { avatarUrl } from '../../lib/avatar.js'
import { RouterLink } from '../../lib/router.js'
import type { Member, Unit } from './api.js'

export function fullName(m: Pick<Member, 'givenName' | 'familyName' | 'patronymic'>): string {
  return [m.givenName, m.familyName].filter(Boolean).join(' ')
}
export function formalName(m: Pick<Member, 'givenName' | 'familyName' | 'patronymic'>): string {
  return [m.familyName, m.givenName, m.patronymic].filter(Boolean).join(' ')
}

export function MemberCard({
  member,
  unit,
  compact = false,
  profileHref,
  onAssign,
}: {
  member: Member
  unit?: Unit | null
  compact?: boolean
  onFilterByUnit?: ((id: string) => void) | undefined
  profileHref?: string | undefined
  onAssign?: (() => void) | undefined
  telegramDeepLink?: string | undefined
}) {
  const t = useT(),
    [open, setOpen] = React.useState(false)
  const profile = member.professionalProfile ?? professionalProfileSchema.parse({})
  const education = [...profile.education].sort(
    (a, b) => (b.endYear ?? 2200) - (a.endYear ?? 2200),
  )[0]
  const empty = t('portal.profile.empty')
  const avatar = (
    <Avatar
      src={avatarUrl(member.avatarKey, 128)}
      size={compact ? 'sm' : 'lg'}
      alt={fullName(member)}
      initials={initialsFromName(member.givenName, member.familyName)}
      hueSeed={member.unitId ?? 'department'}
    />
  )
  const period = (
    item: { startYear: number | null; endYear: number | null; current: boolean },
    education = false,
  ) =>
    [
      item.startYear,
      item.current
        ? education
          ? `${t('portal.profile.expected')} ${item.endYear ?? ''}`
          : t('portal.profile.present')
        : item.endYear,
    ]
      .filter(Boolean)
      .join(' – ')
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? 'flex min-w-0 w-full items-center gap-2 rounded-sm border border-border bg-card p-2 text-left [overflow-wrap:anywhere]'
            : 'flex h-full min-w-0 w-full flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-1 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]'
        }
      >
        <span className="flex w-full items-center gap-3">
          {avatar}
          <span className="min-w-0 flex-1">
            <span className="block text-lead font-medium">{fullName(member)}</span>
            <span className="block text-small text-muted-foreground">
              {profile.headline || member.title || empty}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </span>
        {!compact ? (
          <span className="flex w-full flex-col gap-1.5 border-t border-border pt-3 text-small text-muted-foreground">
            <span className="flex items-center gap-2">
              <Mail className="size-4 shrink-0" />
              <span className="truncate">{member.email || empty}</span>
            </span>
            <span className="flex items-center gap-2">
              <Phone className="size-4 shrink-0" />
              <span className="min-w-0">{profile.phone || empty}</span>
            </span>
            <span className="flex items-start gap-2">
              <GraduationCap className="size-4 shrink-0" />
              <span className="min-w-0">
                {education ? (
                  <>
                    <span className="block font-medium text-foreground">
                      {education.field || education.degree}
                    </span>
                    <span className="block text-caption">{education.institution}</span>
                  </>
                ) : (
                  empty
                )}
              </span>
            </span>
          </span>
        ) : null}
      </button>
      <Sheet open={open} onOpenChange={setOpen} direction="right">
        <SheetContent side="right" title={fullName(member)} className="w-full sm:w-[36rem]">
          <div className="flex items-center justify-between border-b border-border p-4">
            <span className="text-small text-muted-foreground">{t('portal.profile.title')}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('structure.units.chart.closePanel')}
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-6 [overflow-wrap:anywhere]">
            <div className="flex items-center gap-4">
              {avatar}
              <div className="min-w-0">
                <h2 className="font-display text-h2">{fullName(member)}</h2>
                <p className="text-muted-foreground">{profile.headline || member.title}</p>
              </div>
            </div>
            {unit ? <p className="rounded-md bg-accent p-2 text-small">{unit.name}</p> : null}
            {profile.about ? (
              <p className="whitespace-pre-wrap text-small leading-relaxed">{profile.about}</p>
            ) : null}
            <section className="flex flex-col gap-3">
              <h3 className="text-small font-semibold">{t('portal.profile.contact')}</h3>
              <p className="text-small">{member.email || empty}</p>
              <p className="text-small">{profile.phone || empty}</p>
              {profile.location ? <p className="text-small">{profile.location}</p> : null}
              {profile.links.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-small text-primary underline"
                >
                  {link.label || link.url}
                </a>
              ))}
            </section>
            <section className="flex flex-col gap-3">
              <h3 className="text-small font-semibold">{t('portal.profile.education')}</h3>
              {profile.education.length ? (
                profile.education.map((e, i) => (
                  <div key={i} className="border-l-2 border-border pl-4">
                    <p className="font-medium">
                      {e.degree} · {e.field}
                    </p>
                    <p className="text-small">{e.institution}</p>
                    <p className="text-caption text-muted-foreground">{period(e, true)}</p>
                  </div>
                ))
              ) : (
                <p className="text-small text-muted-foreground">{empty}</p>
              )}
            </section>
            <section className="flex flex-col gap-3">
              <h3 className="text-small font-semibold">{t('portal.profile.experience')}</h3>
              {profile.experience.length ? (
                profile.experience.map((e, i) => (
                  <div key={i} className="border-l-2 border-border pl-4">
                    <p className="font-medium">{e.role}</p>
                    <p className="text-small">{e.organization}</p>
                    <p className="text-caption text-muted-foreground">{period(e)}</p>
                    <p className="whitespace-pre-wrap text-small">{e.description}</p>
                  </div>
                ))
              ) : (
                <p className="text-small text-muted-foreground">{empty}</p>
              )}
            </section>
            {(['skills', 'languages'] as const).map((key) =>
              profile[key].length ? (
                <section key={key}>
                  <h3 className="mb-2 text-small font-semibold">{t(`portal.profile.${key}`)}</h3>
                  <div className="flex flex-wrap gap-2">
                    {profile[key].map((item) => (
                      <span
                        key={item}
                        className="min-w-0 rounded-full bg-muted px-3 py-1 text-small"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null,
            )}
            {profile.certifications.length ? (
              <section>
                <h3 className="mb-2 text-small font-semibold">
                  {t('portal.profile.certifications')}
                </h3>
                {profile.certifications.map((c, i) => (
                  <p key={i} className="text-small">
                    {c.name} · {c.issuer} · {c.year}
                  </p>
                ))}
              </section>
            ) : null}
            {profileHref || onAssign ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                {profileHref ? (
                  <RouterLink href={profileHref} className="text-small text-primary underline">
                    {t('structure.people.hoverCard.openProfile')}
                  </RouterLink>
                ) : null}
                {onAssign ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setOpen(false)
                      onAssign()
                    }}
                  >
                    {t('people.person.action.assign')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
