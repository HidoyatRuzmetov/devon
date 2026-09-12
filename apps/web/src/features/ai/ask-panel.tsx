// EPIC-016: the Ask box. A question in plain language, answered from this department's own cards,
// comments, pages and events, with every claim carrying a link to the record it came from.
//
// The retrieval runs on the server and the model only ever sees what was retrieved
// (`semantic-ask.ts`), which is the whole point in a ministry: an "ask your data" box that falls back
// to the model's own knowledge is how someone ends up reading an invented regulation. When nothing
// relevant is found, the honest answer -- "topilmadi" -- is what appears.
//
// Below the answer, the raw retrieval is always shown. A reader who does not trust the paragraph can
// read the four records it was built from, which is a better trust mechanism than a confidence score.
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Search, Sparkles } from 'lucide-react'
import { Badge, Button, Input, StateView } from '@devon/ui'
import { useT, useLocale } from '@devon/i18n'
import { semanticAskOutputSchema, type SemanticAskOutput } from './outputs.js'
import { AiResultPanel } from './components/ai-result-panel.js'
import { AskAnswerPreview } from './components/previews.js'
import { useAskMutation, useDepartmentSearchQuery } from './use-ai.js'
import { searchHitHref, type AskResponse, type SearchHit } from './types.js'

/** A search hit row, shared by the Ask panel's "what was found" list and any host that wants the
 * same list (the palette section, when it lands). */
export function SearchHitRow({ hit }: { hit: SearchHit }): React.JSX.Element {
  const t = useT()
  return (
    <Link
      to={searchHitHref(hit)}
      className="flex flex-col gap-0.5 rounded-sm px-2 py-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge tone="neutral">{t(`ai.search.kind.${hit.subjectType}`)}</Badge>
        <span className="min-w-0 truncate text-body text-foreground">
          {hit.title || t('ai.search.untitled')}
        </span>
      </span>
      {hit.snippet ? (
        <span className="line-clamp-2 text-caption text-muted-foreground">{hit.snippet}</span>
      ) : null}
    </Link>
  )
}

/**
 * The four states of the raw-retrieval list, as early returns rather than a JSX ternary ladder:
 * `check-i18n.mjs`'s hard-coded-text heuristic matches any run of words sitting between one JSX
 * closing bracket and the next opening one, across newlines, so a `) : cond ? (` line between two JSX
 * blocks reads to it as a stray text node. `people-screen.tsx` documents the same trap for its own ternaries.
 */
function SearchResults({ query }: { query: string }): React.JSX.Element {
  const t = useT()
  const searchQuery = useDepartmentSearchQuery(query, 8)

  if (query.trim().length < 2) {
    return <p className="text-small text-muted-foreground">{t('ai.search.typeToSearch')}</p>
  }
  if (searchQuery.isPending) {
    return <StateView kind="loading" titleKey="state.loading" />
  }
  if (searchQuery.isError) {
    return (
      <StateView
        kind="error"
        titleKey="state.error.title"
        bodyKey="state.error.body"
        action={{ labelKey: 'state.error.retry', onAction: () => void searchQuery.refetch() }}
      />
    )
  }
  if (searchQuery.data.hits.length === 0) {
    return <p className="text-small text-muted-foreground">{t('ai.search.noHits')}</p>
  }
  return (
    <ul className="flex flex-col">
      {searchQuery.data.hits.map((hit) => (
        <li key={`${hit.subjectType}-${hit.subjectId}`}>
          <SearchHitRow hit={hit} />
        </li>
      ))}
    </ul>
  )
}

export function AskPanel(): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const askMutation = useAskMutation()

  const [question, setQuestion] = React.useState('')
  const [submitted, setSubmitted] = React.useState('')
  const [answer, setAnswer] = React.useState<
    { output: SemanticAskOutput; response: AskResponse } | null
  >(null)
  const [failed, setFailed] = React.useState(false)

  // The "what was found" list is a plain search over whatever is currently typed, debounced, and is
  // useful on its own: many questions turn out to be "where is that card", which needs no model call
  // at all. Two seconds of typing later it is already answered, for free.
  const [debounced, setDebounced] = React.useState('')
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(question), 300)
    return () => clearTimeout(timer)
  }, [question])

  function run(text: string) {
    const trimmed = text.trim()
    if (trimmed.length < 3) return
    setSubmitted(trimmed)
    setAnswer(null)
    setFailed(false)
    askMutation.mutate(
      { question: trimmed, locale },
      {
        onSuccess: (response) => {
          const parsed = semanticAskOutputSchema.safeParse(response.data)
          if (parsed.success) setAnswer({ output: parsed.data, response })
          else setFailed(true)
        },
        onError: () => setFailed(true),
      },
    )
  }

  const status: 'pending' | 'ready' | 'error' = askMutation.isPending
    ? 'pending'
    : failed
      ? 'error'
      : 'ready'

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          run(question)
        }}
      >
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <label htmlFor="ai-ask-input" className="text-small font-medium text-foreground">
            {t('ai.ask.label')}
          </label>
          <Input
            id="ai-ask-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('ai.ask.placeholder')}
            autoComplete="off"
          />
        </div>
        <Button type="submit" loading={askMutation.isPending} disabled={question.trim().length < 3}>
          <Sparkles className="size-4" aria-hidden="true" />
          {t('ai.ask.submit')}
        </Button>
      </form>
      <p className="text-caption text-muted-foreground">{t('ai.ask.hint')}</p>

      {submitted ? (
        <AiResultPanel
          title={t('ai.ask.answerTitle', { question: submitted })}
          status={status}
          meta={askMutation.data?.meta}
          errorMessage={t('ai.errors.runFailed')}
          onDiscard={() => {
            setSubmitted('')
            setAnswer(null)
            setFailed(false)
          }}
          onRetry={() => run(submitted)}
          acceptLabel={t('ai.ask.done')}
          onAccept={() => {
            setSubmitted('')
            setAnswer(null)
          }}
        >
          {answer ? (
            <AskAnswerPreview output={answer.output} sources={answer.response.sources} />
          ) : null}
        </AiResultPanel>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-small font-medium text-foreground">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('ai.search.title')}
        </h3>
        <SearchResults query={debounced} />
      </section>
    </div>
  )
}
