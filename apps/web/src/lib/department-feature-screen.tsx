import type * as React from 'react'
import { FEATURES, type AppActionId, type FeatureKey } from '@devon/contracts'
import { useT } from '@devon/i18n'
import { PageHeader, RouteSkeleton, StateView } from '@devon/ui'
import { useCan } from './can.js'
import { useFeatures } from './features.js'
import { useDepartment } from './session.js'
import { navigate } from './router.js'

/** A disabled department capability is a settings decision, not a broken API request. */
export function DepartmentFeatureScreen({
  feature,
  action,
  children,
}: {
  feature: FeatureKey
  action: AppActionId
  children: React.ReactNode
}) {
  const t = useT()
  const { features, isLoading, isError, retry } = useFeatures()
  const permission = useCan(action)
  const { department } = useDepartment()
  if (isLoading) return <RouteSkeleton label={t('shell.loading.route')} />
  if (!permission.allowed)
    return <StateView kind="forbidden" titleKey="state.denied.title" bodyKey="state.denied.body" />
  if (isError)
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.action', onAction: retry }}
      />
    )
  if (features[feature]) {
    return <>{children}</>
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t(FEATURES[feature].labelKey)} />
      <StateView
        kind="empty"
        titleKey="featureState.off"
        bodyKey={department?.role === 'head' ? 'featureState.headHelp' : 'featureState.memberHelp'}
        {...(department?.role === 'head'
          ? {
              action: {
                labelKey: 'departments.features.title',
                onAction: () => navigate('/department?tab=general#features'),
              },
            }
          : {})}
      />
    </div>
  )
}
