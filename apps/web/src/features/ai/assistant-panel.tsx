// The preview-then-accept AI assistant (TECH-SPEC §8: "the user always sees a preview and accepts").
// One tab per feature (`feature-forms.ts`'s data-driven descriptors), a small form built from that
// descriptor, a "Preview" call to the gateway, and an "Accept" action -- standalone here (this screen
// has no card/event/sprint of its own to write the result into), so "accept" copies the JSON result to
// the clipboard for now. A feature wired directly into the work/events/personal board (a follow-up,
// noted in this item's report) would replace "copy" with "apply to this card" using the exact same
// `useRunAiFeatureMutation` hook this panel already calls.
import * as React from 'react'
import { useT, useLocale, formatNumber } from '@devon/i18n'
import {
  AiPreviewPanel,
  Badge,
  Field,
  Select,
  SparkleButton,
  StateView,
  Textarea,
  toast,
} from '@devon/ui'
import { Sparkles } from 'lucide-react'
import { useDepartment } from '../../lib/session.js'
import { ApiError } from '../../lib/api-client.js'
import { useAiSettingsQuery, useRunAiFeatureMutation } from './use-ai.js'
import {
  buildFeatureInput,
  FEATURE_FORMS,
  remapPlanSprintTasks,
  type FieldSpec,
} from './feature-forms.js'
import type { RunFeatureResponse } from './types.js'

function fieldValue(t: ReturnType<typeof useT>, field: FieldSpec): string {
  return field.sampleKey ? t(field.sampleKey) : ''
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldSpec
  value: string
  onChange: (v: string) => void
}) {
  const t = useT()
  if (field.kind === 'localeSelect') {
    return (
      <Select
        id={field.key}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: 'uz-Latn', label: 'Oʻzbekcha (lotin)' },
          { value: 'uz-Cyrl', label: 'Ўзбекча (кирилл)' },
          { value: 'ru', label: 'Русский' },
          { value: 'en', label: 'English' },
        ]}
      />
    )
  }
  if (field.kind === 'text' || field.kind === 'number') {
    return (
      <input
        id={field.key}
        type={field.kind === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
        className="h-11 w-full rounded-sm border border-border bg-card px-3 text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    )
  }
  return (
    <Textarea
      id={field.key}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={field.kind === 'idTitleList' || field.kind === 'stringList' ? 4 : 3}
      placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
    />
  )
}

function apiErrorMessageKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'validation_failed') return 'ai.errors.invalidInput'
    if (err.code === 'forbidden') return 'ai.errors.forbidden'
    if (err.code === 'internal') return 'ai.errors.runFailed'
  }
  return 'toast.saveError'
}

function ResultBody({ result }: { result: RunFeatureResponse }) {
  const t = useT()
  const pretty = JSON.stringify(result.data, null, 2)
  return (
    <div className="flex flex-col gap-2">
      {result.meta.retried ? (
        <Badge tone="warning" className="self-start">
          {t('ai.result.retried')}
        </Badge>
      ) : null}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-sm bg-card p-3 text-caption text-foreground">
        {pretty}
      </pre>
    </div>
  )
}

export function AssistantPanel() {
  const t = useT()
  const locale = useLocale()
  const { department } = useDepartment()
  const settingsQuery = useAiSettingsQuery()
  const [activeFeature, setActiveFeature] = React.useState(FEATURE_FORMS[0]!.feature)
  const spec = FEATURE_FORMS.find((f) => f.feature === activeFeature)!
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(spec.fields.map((f) => [f.key, fieldValue(t, f)])),
  )
  const runMutation = useRunAiFeatureMutation(activeFeature)

  function selectFeature(feature: typeof activeFeature) {
    setActiveFeature(feature)
    const nextSpec = FEATURE_FORMS.find((f) => f.feature === feature)!
    setValues(Object.fromEntries(nextSpec.fields.map((f) => [f.key, fieldValue(t, f)])))
    runMutation.reset()
  }

  const flagEnabled = settingsQuery.data?.flags[activeFeature] === true
  const budgetOk = settingsQuery.data ? settingsQuery.data.budgetStatus !== 'hard_stop' : true

  function handlePreview() {
    let input = buildFeatureInput(spec, values)
    if (activeFeature === 'plan_sprint') input = remapPlanSprintTasks(input)
    input = { ...input, locale }
    runMutation.mutate(input, {
      onError: (err) => toast(t(apiErrorMessageKey(err))),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-primary" aria-hidden="true" />
        <h2 className="text-h3 text-foreground">{t('ai.assistant.title')}</h2>
      </div>
      <p className="text-body text-muted-foreground">{t('ai.assistant.description')}</p>

      <div
        role="tablist"
        aria-label={t('ai.assistant.title')}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {FEATURE_FORMS.map((f) => (
          <button
            key={f.feature}
            type="button"
            role="tab"
            aria-selected={activeFeature === f.feature}
            onClick={() => selectFeature(f.feature)}
            className={
              'rounded-t-sm px-3 py-2 text-small font-medium ' +
              (activeFeature === f.feature
                ? 'border-b-2 border-primary text-foreground'
                : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="flex flex-col gap-4">
        <p className="text-small text-muted-foreground">{t(spec.descriptionKey)}</p>

        {renderAssistantBody()}
      </div>
    </div>
  )

  function renderAssistantBody(): React.ReactNode {
    if (settingsQuery.data && !flagEnabled) {
      return (
        <StateView
          kind="forbidden"
          titleKey="ai.assistant.disabled.title"
          bodyKey="ai.assistant.disabled.body"
        />
      )
    }
    if (settingsQuery.data && !budgetOk) {
      return (
        <StateView
          kind="forbidden"
          titleKey="ai.assistant.budgetExceeded.title"
          bodyKey="ai.assistant.budgetExceeded.body"
        />
      )
    }
    return (
      <>
        {spec.fields.map((field) => (
          <Field key={field.key} label={t(field.labelKey)} htmlFor={field.key}>
            <FieldInput
              field={field}
              value={values[field.key] ?? ''}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
            />
          </Field>
        ))}

        <div className="flex justify-end">
          <SparkleButton
            aria-label={t('ai.assistant.preview')}
            label={t('ai.assistant.preview')}
            loading={runMutation.isPending}
            disabled={!department}
            onClick={handlePreview}
          />
        </div>

        {runMutation.isPending || runMutation.isError || runMutation.data ? (
          <AiPreviewPanel
            title={t(spec.labelKey)}
            status={runMutation.isPending ? 'pending' : runMutation.isError ? 'error' : 'ready'}
            pendingLabel={t('ai.assistant.pending')}
            {...(runMutation.error
              ? { errorMessage: t(apiErrorMessageKey(runMutation.error)) }
              : {})}
            acceptLabel={t('ai.result.accept')}
            editLabel={t('ai.result.edit')}
            discardLabel={t('ai.result.discard')}
            retryLabel={t('ai.result.retry')}
            {...(runMutation.data
              ? {
                  costLine: t('ai.result.costLine', {
                    tokens: formatNumber(runMutation.data.meta.totalTokens, locale),
                    ms: formatNumber(runMutation.data.meta.latencyMs, locale),
                  }),
                }
              : {})}
            onRetry={handlePreview}
            onAccept={() => {
              if (!runMutation.data) return
              const pretty = JSON.stringify(runMutation.data.data, null, 2)
              void navigator.clipboard.writeText(pretty).then(() => {
                toast(t('ai.result.copied'))
                runMutation.reset()
              })
            }}
            onEdit={() => runMutation.reset()}
            onDiscard={() => runMutation.reset()}
          >
            {runMutation.data ? <ResultBody result={runMutation.data} /> : null}
          </AiPreviewPanel>
        ) : null}
      </>
    )
  }
}
