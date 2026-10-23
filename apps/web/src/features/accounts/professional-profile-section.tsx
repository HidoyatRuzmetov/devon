import { SettingsSection } from './settings-section.js'
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  professionalProfileRecordSchema,
  professionalProfileWriteSchema,
  type ProfessionalProfile,
} from '@devon/contracts'
import {
  Award,
  BriefcaseBusiness,
  GraduationCap,
  Heart,
  Link as LinkIcon,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useT } from '@devon/i18n'
import { Button, Input, StateView, Textarea, toast } from '@devon/ui'
import { apiClient } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import type { Me } from '../../lib/api-schemas.js'

const path = '/api/v1/accounts/professional-profile'
const profileKey = (ownerUserId: string) =>
  ['accounts', 'professional-profile', ownerUserId] as const
type ProfileRecord = { profile: ProfessionalProfile; version: number }
type SaveCommand = ProfileRecord & { ownerUserId: string; csrfToken: string }
export function ProfessionalProfileSection() {
  const t = useT()
  const { data: me } = useMeQuery()
  const ownerUserId = me?.user.id ?? ''
  const query = useQuery({
    queryKey: profileKey(ownerUserId),
    queryFn: () => apiClient.get(path, professionalProfileRecordSchema),
    enabled: Boolean(ownerUserId),
  })
  return (
    <SettingsSection
      id="section-professional"
      title={t('portal.profile.title')}
      description={t('portal.profile.intro')}
    >
      {query.isPending ? <StateView kind="loading" titleKey="state.loading" /> : null}
      {query.isError ? (
        <StateView
          kind="error"
          titleKey="state.error.title"
          action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
        />
      ) : null}
      {query.data && ownerUserId ? (
        <ProfileEditor
          key={`${ownerUserId}:${query.data.version}`}
          initial={query.data.profile}
          version={query.data.version}
          ownerUserId={ownerUserId}
          csrfToken={me?.csrfToken ?? ''}
        />
      ) : null}
    </SettingsSection>
  )
}

function ProfileEditor({
  initial,
  version,
  ownerUserId,
  csrfToken,
}: {
  initial: ProfessionalProfile
  version: number
  ownerUserId: string
  csrfToken: string
}) {
  const t = useT(),
    qc = useQueryClient()
  const [profile, setProfile] = React.useState(initial)
  const save = useMutation({
    mutationFn: (command: SaveCommand) => {
      if (qc.getQueryData<Me | null>(['me'])?.user.id !== command.ownerUserId)
        throw new Error('The signed-in account changed')
      return apiClient.put(
        path,
        { profile: command.profile, version: command.version },
        professionalProfileRecordSchema,
        command.csrfToken,
      )
    },
    onSuccess: (record, command) => {
      if (qc.getQueryData<Me | null>(['me'])?.user.id !== command.ownerUserId) return
      qc.setQueryData<ProfileRecord>(profileKey(command.ownerUserId), (current) =>
        current && current.version > record.version ? current : record,
      )
      void qc.invalidateQueries({ queryKey: ['structure', 'members'] })
      toast(t('profileEdit.saved'))
    },
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const formRef = React.useRef<HTMLFormElement>(null)
  const set = <K extends keyof ProfessionalProfile>(key: K, value: ProfessionalProfile[K]) => {
    setProfile((p) => ({ ...p, [key]: value }))
    setErrors({})
  }
  const label = (key: string) => t(`portal.profile.${key}`)
  const period = { startYear: null, endYear: null, current: false }
  const sections = [
    {
      key: 'education',
      icon: GraduationCap,
      fields: ['institution', 'degree', 'field', 'startYear', 'endYear', 'current'],
      required: ['institution'],
      limit: 30,
    },
    {
      key: 'experience',
      icon: BriefcaseBusiness,
      fields: ['organization', 'role', 'startYear', 'endYear', 'current', 'description'],
      required: ['organization', 'role'],
      limit: 50,
    },
    {
      key: 'certifications',
      icon: Award,
      fields: ['name', 'issuer', 'year'],
      required: ['name'],
      limit: 50,
    },
    { key: 'links', icon: LinkIcon, fields: ['label', 'url'], required: ['url'], limit: 20 },
  ] as const
  function updateEntry(
    section: (typeof sections)[number]['key'],
    index: number,
    field: string,
    value: string | number | boolean | null,
  ) {
    setProfile((p) => ({
      ...p,
      [section]: p[section].map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    }))
    setErrors({})
  }
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = professionalProfileWriteSchema.safeParse(profile)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const list = ['skills', 'languages', 'hobbies'].includes(String(issue.path[0]))
        const key = list ? String(issue.path[0]) : issue.path.join('.')
        next[key] =
          issue.message === 'Required'
            ? t('settings.profile.required')
            : list && issue.code === 'too_big'
              ? t(
                  issue.path.length > 1
                    ? 'settings.profile.itemLimit'
                    : 'settings.profile.listLimit',
                  { max: Number(issue.maximum) },
                )
              : t(
                  String(issue.path.at(-1)).match(/year/i)
                    ? 'settings.profile.invalid'
                    : 'settings.profile.invalidValue',
                )
      }
      setErrors(next)
      const first = Object.keys(next)[0]
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()
      return
    }
    if (!save.isPending) save.mutate({ profile: parsed.data, version, ownerUserId, csrfToken })
  }
  return (
    <form ref={formRef} noValidate className="flex min-w-0 flex-col gap-5" onSubmit={submit}>
      <p className="text-caption text-muted-foreground">{t('settings.profile.requiredHint')}</p>
      <fieldset className="flex min-w-0 flex-col gap-4">
        <legend className="mb-3 flex items-center gap-2 text-lead font-medium">
          <UserRound className="size-5 text-primary" aria-hidden="true" />
          {t('settings.profile.introduction')}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {(['headline', 'phone', 'location'] as const).map((key) => (
            <label
              className={
                key === 'headline'
                  ? 'flex flex-col gap-1.5 text-small sm:col-span-2'
                  : 'flex flex-col gap-1.5 text-small'
              }
              key={key}
            >
              {label(key)}
              <Input
                type={key === 'phone' ? 'tel' : 'text'}
                maxLength={key === 'phone' ? 80 : 500}
                value={profile[key]}
                onChange={(e) => set(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-small">
          {label('about')}
          <Textarea
            maxLength={10000}
            rows={4}
            value={profile.about}
            onChange={(e) => set('about', e.target.value)}
          />
        </label>
      </fieldset>
      {sections.map(({ key: section, icon: Icon, fields, required, limit }) => (
        <fieldset key={section} className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
          <legend className="flex items-center gap-2 pr-3 text-lead font-medium">
            <Icon className="size-5 text-primary" aria-hidden="true" />
            {label(section)}
          </legend>
          {!profile[section].length ? (
            <p className="text-small text-muted-foreground">
              {t('settings.profile.addHint', { section: label(section).toLowerCase() })}
            </p>
          ) : null}
          {profile[section].map((item, index) => (
            <div
              key={index}
              className="relative min-w-0 rounded-md border border-border bg-muted/20 p-3"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-small font-medium">
                  {label(section)} <span className="text-muted-foreground">{index + 1}</span>
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={t('settings.profile.removeEntry', {
                    section: label(section),
                    number: index + 1,
                  })}
                  onClick={() =>
                    set(
                      section,
                      profile[section].filter(
                        (_, i) => i !== index,
                      ) as ProfessionalProfile[typeof section],
                    )
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  {label('remove')}
                </Button>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-3">
                {fields.map((key) => {
                  const value = (item as unknown as Record<string, unknown>)[key]
                  const name = `${section}.${index}.${key}`
                  const requiredField = (required as readonly string[]).includes(key)
                  const year = key.toLowerCase().includes('year')
                  const fieldLabel =
                    key === 'endYear' &&
                    section === 'education' &&
                    'current' in item &&
                    item.current
                      ? t('settings.profile.expectedYear')
                      : label(key)
                  if (key === 'current')
                    return (
                      <label
                        key={key}
                        className="flex min-h-11 items-center gap-2 text-small col-span-2"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(e) => updateEntry(section, index, key, e.target.checked)}
                          className="size-4 accent-primary"
                        />
                        {label(section === 'education' ? 'studying' : 'current')}
                      </label>
                    )
                  return (
                    <label
                      key={key}
                      className={`flex min-w-0 flex-col gap-1.5 text-small ${year ? '' : key === 'description' || key === 'url' ? 'col-span-2' : 'col-span-2 sm:col-span-1'}`}
                    >
                      <span>
                        {fieldLabel}
                        {requiredField ? (
                          <span className="ml-1 text-destructive" aria-hidden="true">
                            *
                          </span>
                        ) : null}
                      </span>
                      {key === 'description' ? (
                        <Textarea
                          name={name}
                          value={String(value ?? '')}
                          maxLength={5000}
                          rows={3}
                          onChange={(e) => updateEntry(section, index, key, e.target.value)}
                        />
                      ) : (
                        <Input
                          name={name}
                          type={key === 'url' ? 'url' : 'text'}
                          inputMode={year ? 'numeric' : undefined}
                          pattern={year ? '[0-9]{4}' : undefined}
                          maxLength={year ? 4 : key === 'url' ? 2000 : 500}
                          required={requiredField}
                          aria-required={requiredField}
                          aria-invalid={Boolean(errors[name])}
                          aria-describedby={errors[name] ? `${name}-error` : undefined}
                          value={value === null ? '' : String(value)}
                          onChange={(e) => {
                            if (year && !/^\d{0,4}$/.test(e.target.value)) return
                            updateEntry(
                              section,
                              index,
                              key,
                              year
                                ? e.target.value === ''
                                  ? null
                                  : Number(e.target.value)
                                : e.target.value,
                            )
                          }}
                        />
                      )}
                      {errors[name] ? (
                        <span id={`${name}-error`} className="text-caption text-destructive">
                          {errors[name]}
                        </span>
                      ) : null}
                    </label>
                  )
                })}
              </div>
              {errors[`${section}.${index}`] ? (
                <p className="mt-3 text-small text-destructive">
                  {t('settings.profile.invalidPeriod')}
                </p>
              ) : null}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={profile[section].length >= limit}
            onClick={() => {
              if (section === 'education')
                set('education', [
                  ...profile.education,
                  { institution: '', degree: '', field: '', ...period },
                ])
              if (section === 'experience')
                set('experience', [
                  ...profile.experience,
                  { organization: '', role: '', description: '', ...period },
                ])
              if (section === 'certifications')
                set('certifications', [
                  ...profile.certifications,
                  { name: '', issuer: '', year: null },
                ])
              if (section === 'links') set('links', [...profile.links, { label: '', url: '' }])
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('settings.profile.addSection', { section: label(section).toLowerCase() })}
          </Button>
        </fieldset>
      ))}
      <fieldset className="grid min-w-0 gap-4 border-t border-border pt-5 sm:grid-cols-2">
        <legend className="flex items-center gap-2 pr-3 text-lead font-medium">
          <Heart className="size-5 text-primary" aria-hidden="true" />
          {t('settings.profile.capabilitiesInterests')}
        </legend>
        {(['skills', 'languages', 'hobbies'] as const).map((key) => (
          <label
            key={key}
            className={`flex min-w-0 flex-col gap-1.5 text-small ${key === 'hobbies' ? 'sm:col-span-2' : ''}`}
          >
            {label(key)}
            <Input
              name={key}
              aria-invalid={Boolean(errors[key])}
              aria-describedby={errors[key] ? `${key}-error` : undefined}
              maxLength={key === 'skills' ? 10099 : 5049}
              defaultValue={profile[key].join(', ')}
              onChange={(e) =>
                set(
                  key,
                  e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
            <span className="text-caption text-muted-foreground">{label('commaHint')}</span>
            {errors[key] ? (
              <span id={`${key}-error`} className="text-caption text-destructive">
                {errors[key]}
              </span>
            ) : null}
            {profile[key].length ? (
              <span className="mt-1 flex flex-wrap gap-1.5">
                {profile[key].map((value, index) => (
                  <span
                    key={index}
                    className="max-w-full break-words rounded-full bg-accent px-2 py-1 text-caption text-primary"
                  >
                    {value}
                  </span>
                ))}
              </span>
            ) : null}
          </label>
        ))}
      </fieldset>
      {Object.keys(errors).length ? (
        <p role="alert" className="text-small text-destructive">
          {t('settings.profile.validationError')}
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t('portal.profile.saveError')}
        </p>
      ) : null}
      <div className="sticky bottom-0 -mx-1 flex justify-end border-t border-border bg-card/95 px-1 py-3 backdrop-blur-sm">
        <Button type="submit" loading={save.isPending}>
          {t('work.action.save')}
        </Button>
      </div>
    </form>
  )
}
