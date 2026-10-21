import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { useT } from '@devon/i18n'
import { Button, SectionCard, StateView } from '@devon/ui'
import { apiClient } from '../../lib/api-client.js'

const path = '/api/v1/admin/file-upload-approvals'
const schema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    size: z.number(),
    department: z.string(),
    requester: z.string(),
    subjectType: z.string(),
  }),
)
export function FileApprovalQueue() {
  const t = useT(),
    qc = useQueryClient()
  const query = useQuery({
    queryKey: ['admin', 'file-approvals'],
    queryFn: () => apiClient.get(path, schema),
  })
  const review = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) =>
      apiClient.post(`${path}/${id}`, { approved }, z.void()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'file-approvals'] }),
  })
  return (
    <SectionCard
      id="file-upload-approvals"
      title={t('portal.files.queue')}
      description={t('portal.files.queueHint')}
    >
      {query.isPending ? <StateView kind="loading" titleKey="state.loading" /> : null}
      {query.isError ? (
        <StateView
          kind="error"
          titleKey="state.error.title"
          action={{ labelKey: 'state.error.action', onAction: () => void query.refetch() }}
        />
      ) : null}
      {query.data?.length === 0 ? (
        <p className="text-small text-muted-foreground">{t('portal.files.empty')}</p>
      ) : null}
      {query.data?.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-border py-3">
          <div className="min-w-0 flex-1">
            <p className="break-all text-small font-medium">{r.name}</p>
            <p className="text-caption text-muted-foreground">
              {r.requester} · {r.department} · {Math.ceil(r.size / 1024 / 1024)} MB
            </p>
          </div>
          <Button
            size="sm"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: r.id, approved: true })}
          >
            {t('portal.files.approve')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={review.isPending}
            onClick={() => review.mutate({ id: r.id, approved: false })}
          >
            {t('portal.files.reject')}
          </Button>
        </div>
      ))}
      {review.isError ? (
        <p role="alert" className="text-small text-destructive">
          {t('state.error.title')}
        </p>
      ) : null}
    </SectionCard>
  )
}
