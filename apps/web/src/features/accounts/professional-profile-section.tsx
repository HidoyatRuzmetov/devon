import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { professionalProfileRecordSchema, type ProfessionalProfile } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { Button, Input, SectionCard, StateView, Textarea, toast } from '@devon/ui'
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
    <SectionCard
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
    </SectionCard>
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
  const set = <K extends keyof ProfessionalProfile>(key: K, value: ProfessionalProfile[K]) =>
    setProfile((p) => ({ ...p, [key]: value }))
  const label = (key: string) => t(`portal.profile.${key}`)
  const period = { startYear: null, endYear: null, current: false }
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!save.isPending) save.mutate({ profile, version, ownerUserId, csrfToken })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {(['headline', 'phone', 'location'] as const).map((key) => (
          <label className="flex flex-col gap-1 text-small" key={key}>
            {label(key)}
            <Input
              maxLength={key === 'phone' ? 80 : 500}
              value={profile[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-small">
        {label('about')}
        <Textarea
          maxLength={10000}
          rows={4}
          value={profile.about}
          onChange={(e) => set('about', e.target.value)}
        />
      </label>
      {(['skills', 'languages'] as const).map((key) => (
        <label key={key} className="flex flex-col gap-1 text-small">
          {label(key)}
          <Input
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
        </label>
      ))}
      {(['education', 'experience', 'certifications', 'links'] as const).map((section) => (
        <fieldset key={section} className="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 text-small font-semibold">{label(section)}</legend>
          {profile[section].map((item, index) => (
            <div key={index} className="grid gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-2">
              {Object.entries(item).map(([key, value]) =>
                key === 'current' ? (
                  <label key={key} className="flex items-center gap-2 text-small">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          [section]: p[section].map((v, i) =>
                            i === index ? { ...v, current: e.target.checked } : v,
                          ),
                        }))
                      }
                    />
                    {label(section === 'education' ? 'studying' : 'current')}
                  </label>
                ) : key === 'description' ? (
                  <label key={key} className="flex flex-col gap-1 text-small sm:col-span-2">
                    {label(key)}
                    <Textarea
                      value={String(value ?? '')}
                      maxLength={5000}
                      rows={3}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          [section]: p[section].map((v, i) =>
                            i === index ? { ...v, description: e.target.value } : v,
                          ),
                        }))
                      }
                    />
                  </label>
                ) : (
                  <label key={key} className="flex flex-col gap-1 text-small">
                    {label(key)}
                    <Input
                      type={
                        key.toLowerCase().includes('year')
                          ? 'number'
                          : key === 'url'
                            ? 'url'
                            : 'text'
                      }
                      min={1900}
                      max={2200}
                      maxLength={key === 'url' ? 2000 : 500}
                      value={value === null ? '' : String(value)}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          [section]: p[section].map((v, i) =>
                            i === index
                              ? {
                                  ...v,
                                  [key]: key.toLowerCase().includes('year')
                                    ? e.target.value === ''
                                      ? null
                                      : Number(e.target.value)
                                    : e.target.value,
                                }
                              : v,
                          ),
                        }))
                      }
                    />
                  </label>
                ),
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setProfile((p) => ({ ...p, [section]: p[section].filter((_, i) => i !== index) }))
                }
              >
                {t('portal.profile.remove')}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
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
            {t('portal.profile.add')}
          </Button>
        </fieldset>
      ))}
      {save.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t('portal.profile.saveError')}
        </p>
      ) : null}
      <Button type="submit" disabled={save.isPending} className="self-start">
        {t('work.action.save')}
      </Button>
    </form>
  )
}
