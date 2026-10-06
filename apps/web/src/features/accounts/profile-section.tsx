import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useT } from '@devon/i18n'
import { Button, Input, SectionCard, StateView, toast } from '@devon/ui'
import { ApiError } from '../../lib/api-client.js'
import { useMeQuery } from '../../lib/session.js'
import { fetchProfile, saveProfile, type AccountProfile } from './api.js'

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
      {query.data ? <ProfileForm key={JSON.stringify(query.data)} profile={query.data} /> : null}
    </SectionCard>
  )
}

function ProfileForm({ profile }: { profile: AccountProfile }) {
  const t = useT()
  const qc = useQueryClient()
  const csrf = useMeQuery().data?.csrfToken ?? ''
  const [values, setValues] = React.useState(profile)
  const save = useMutation({
    mutationFn: () => saveProfile(values, csrf),
    onSuccess: (updated) => {
      qc.setQueryData(['accounts', 'profile'], updated)
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
        save.mutate()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {(['givenName', 'familyName', 'patronymic', 'title', 'login', 'email'] as const).map(
          (field) => (
            <label key={field} className="flex flex-col gap-1.5 text-small">
              {t(`profileEdit.${field}`)}
              <Input
                value={values[field] ?? ''}
                type={field === 'email' ? 'email' : 'text'}
                required={['givenName', 'familyName', 'login'].includes(field)}
                maxLength={
                  field === 'email' ? 256 : field === 'title' ? 150 : field === 'login' ? 64 : 100
                }
                {...(field === 'login' ? { minLength: 3, pattern: '[a-z0-9._-]+' } : {})}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [field]:
                      e.target.value ||
                      (['email', 'title', 'patronymic'].includes(field) ? null : ''),
                  })
                }
              />
            </label>
          ),
        )}
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
