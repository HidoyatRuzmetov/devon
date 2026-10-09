import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Button, Input, SectionCard, StateView, toast } from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import type { Me } from '../../lib/api-schemas.js'
import { fetchProfile, saveProfile, type AccountProfile } from './api.js'

const PROFILE_FIELDS = ['givenName', 'familyName', 'patronymic', 'title', 'login', 'email'] as const

/** Refresh each untouched field without erasing typing in another one. */
function refreshDraft(current: AccountProfile, baseline: AccountProfile, updated: AccountProfile) {
  const next = { ...current }
  for (const field of PROFILE_FIELDS) {
    if (current[field] === baseline[field]) Object.assign(next, { [field]: updated[field] })
  }
  return next
}

type ProfileSaveCommand = {
  baseline: AccountProfile
  submitted: AccountProfile
  patch: Partial<AccountProfile>
  ownerUserId: string | null
  csrfToken: string
}

export function ProfileSection() {
  const t = useT()
  const query = useQuery({ queryKey: ['accounts', 'profile'], queryFn: fetchProfile })
  return (
    <SectionCard
      id="section-profile"
      title={t('profileEdit.heading')}
      description={t('profileEdit.description')}
    >
      {query.isPending ? <StateView kind="loading" titleKey="state.loading" /> : null}
      {query.isError ? (
        <StateView
          kind="error"
          titleKey="state.error.title"
          action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
        />
      ) : null}
      {query.data ? <ProfileForm profile={query.data} /> : null}
    </SectionCard>
  )
}

function ProfileForm({ profile }: { profile: AccountProfile }) {
  const t = useT()
  const qc = useQueryClient()
  useMeQuery()
  const [values, setValues] = React.useState(profile)
  const currentValues = React.useRef(values)
  const previousProfile = React.useRef(profile)
  React.useLayoutEffect(() => {
    const next = refreshDraft(currentValues.current, previousProfile.current, profile)
    currentValues.current = next
    setValues(next)
    previousProfile.current = profile
  }, [profile])
  const save = useMutation({
    mutationFn: (command: ProfileSaveCommand) => {
      if (
        !command.ownerUserId ||
        qc.getQueryData<Me | null>(['me'])?.user.id !== command.ownerUserId
      )
        throw new Error('The signed-in account changed')
      return saveProfile(command.patch, command.csrfToken)
    },
    onSuccess: (updated, { baseline, submitted, patch, ownerUserId }) => {
      if (!ownerUserId || qc.getQueryData<Me | null>(['me'])?.user.id !== ownerUserId) return
      // A GET may already have observed a later edit while this receipt was in flight. Only
      // acknowledge submitted fields that the authoritative cache has not since superseded.
      const latest = qc.getQueryData<AccountProfile>(['accounts', 'profile']) ?? baseline
      const acknowledged = { ...latest }
      for (const field of PROFILE_FIELDS) {
        if (
          field in patch &&
          (latest[field] === baseline[field] || latest[field] === submitted[field])
        )
          Object.assign(acknowledged, { [field]: updated[field] })
      }
      const next = refreshDraft(currentValues.current, submitted, acknowledged)
      currentValues.current = next
      setValues(next)
      qc.setQueryData(['accounts', 'profile'], acknowledged)
      void qc.invalidateQueries({ queryKey: ['accounts', 'profile'] })
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['people'] })
      void qc.invalidateQueries({ queryKey: ['work'] })
      toast(t('profileEdit.saved'))
    },
  })
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (save.isPending) return
        const patch = Object.fromEntries(
          PROFILE_FIELDS.filter((field) => values[field] !== profile[field]).map((field) => [
            field,
            values[field],
          ]),
        ) as Partial<AccountProfile>
        if (Object.keys(patch).length === 0) return
        const me = qc.getQueryData<Me | null>(['me'])
        save.mutate({
          baseline: { ...profile },
          submitted: { ...values },
          patch,
          ownerUserId: me?.user.id ?? null,
          csrfToken: me?.csrfToken ?? '',
        })
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {PROFILE_FIELDS.map((field) => (
          <label key={field} className="flex flex-col gap-1.5 text-small">
            {t(`profileEdit.${field}`)}
            <Input
              value={values[field] ?? ''}
              type={field === 'email' ? 'email' : 'text'}
              required={['givenName', 'familyName', 'login'].includes(field)}
              maxLength={
                field === 'email' ? 256 : field === 'title' ? 150 : field === 'login' ? 64 : 100
              }
              {...(field === 'login' ? { minLength: 3, pattern: '[a-z0-9._\\-]+' } : {})}
              onChange={(e) => {
                const next = {
                  ...values,
                  [field]:
                    e.target.value ||
                    (['email', 'title', 'patronymic'].includes(field) ? null : ''),
                }
                currentValues.current = next
                setValues(next)
              }}
            />
          </label>
        ))}
      </div>
      <p className="text-caption text-muted-foreground">{t('profileEdit.loginHint')}</p>
      {save.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t(
            save.error instanceof ApiError && save.error.status === 409
              ? 'profileEdit.loginTaken'
              : 'profileEdit.error',
          )}
        </p>
      ) : null}
      <Button
        type="submit"
        className="self-start"
        loading={save.isPending}
        disabled={JSON.stringify(values) === JSON.stringify(profile)}
      >
        {t('work.action.save')}
      </Button>
    </form>
  )
}
