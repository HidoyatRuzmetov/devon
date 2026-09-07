// Version history with diff/restore (TECH-SPEC §3.5: "versions with diff/restore"). Lists every
// snapshot `patchPage`/`restoreVersion` has ever written for this page; picking one shows a word-level
// diff against the page's current content (`diff.ts`), and "Restore" reapplies that version's content
// as a brand-new version (server-side, `pages/repo.ts`'s `restoreVersion`).
import * as React from 'react'
import { useT, formatDate } from '@devon/i18n'
import { useLocale } from '@devon/i18n'
import { Button, StateView, cn } from '@devon/ui'
import { toast } from '@devon/ui'
import { fetchVersion } from './api.js'
import { useRestoreVersionMutation, useVersionsQuery } from './use-pages.js'
import { diffText, extractText } from './diff.js'
import type { Page, PageVersionSummary } from './types.js'

function DiffView({ before, after }: { before: string; after: string }) {
  const t = useT()
  const parts = React.useMemo(() => diffText(before, after), [before, after])
  if (before === after) {
    return <p className="text-small text-muted-foreground">{t('pages.diff.noChanges')}</p>
  }
  return (
    <p className="whitespace-pre-wrap text-small leading-6">
      {parts.map((part, i) => (
        <span
          key={i}
          className={cn(
            part.type === 'added' && 'bg-success/20 text-success',
            part.type === 'removed' && 'bg-destructive/20 text-destructive line-through',
          )}
        >
          {part.text}
        </span>
      ))}
    </p>
  )
}

export function VersionHistory({
  page,
  onRestored,
  authorName,
}: {
  page: Page
  onRestored: () => void
  /** Resolves `authorUserId` to a display name (the department's member roster the editor already
   * loaded for `@mentions`) -- falls back to a shortened id when the author is no longer a member. */
  authorName?: (userId: string) => string | undefined
}) {
  const t = useT()
  const locale = useLocale()
  const versionsQuery = useVersionsQuery(page.id)
  const restoreVersion = useRestoreVersionMutation(page.id)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [selectedText, setSelectedText] = React.useState<string | null>(null)
  const currentText = React.useMemo(() => extractText(page.blocks), [page.blocks])

  React.useEffect(() => {
    if (!selectedId) {
      setSelectedText(null)
      return
    }
    let cancelled = false
    fetchVersion(page.id, selectedId).then((v) => {
      if (!cancelled) setSelectedText(extractText(v.blocks))
    })
    return () => {
      cancelled = true
    }
  }, [page.id, selectedId])

  if (versionsQuery.isPending) return <StateView kind="loading" titleKey="state.loading" />
  const versions = versionsQuery.data ?? []
  if (versions.length === 0) {
    return <p className="text-small text-muted-foreground">{t('pages.versions.empty')}</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-h3 text-foreground">{t('pages.versions.title')}</h3>
      <ul className="flex flex-col gap-1">
        {versions.map((v: PageVersionSummary, i: number) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => setSelectedId(selectedId === v.id ? null : v.id)}
              aria-expanded={selectedId === v.id}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-small hover:bg-accent',
                selectedId === v.id && 'bg-accent',
              )}
            >
              <span className="text-foreground">
                {formatDate(new Date(v.createdAt), locale)}
                {i === 0 ? ` · ${t('pages.versions.current')}` : ''}
              </span>
              <span className="text-muted-foreground">
                {t('pages.versions.by', {
                  name: authorName?.(v.authorUserId) ?? `${v.authorUserId.slice(0, 8)}…`,
                })}
              </span>
            </button>
            {selectedId === v.id ? (
              <div className="ml-2 flex flex-col gap-2 border-l-2 border-border py-2 pl-3">
                {selectedText === null ? (
                  <StateView kind="loading" titleKey="state.loading" />
                ) : (
                  <DiffView before={selectedText} after={currentText} />
                )}
                {i !== 0 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    loading={restoreVersion.isPending}
                    onClick={() =>
                      restoreVersion.mutate(v.id, {
                        onSuccess: () => {
                          toast(t('pages.versions.restored'))
                          onRestored()
                        },
                      })
                    }
                  >
                    {t('pages.versions.restore')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
