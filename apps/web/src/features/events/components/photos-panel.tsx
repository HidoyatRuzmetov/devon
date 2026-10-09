// Photos (TECH-SPEC §3.4: "photos (links) after the event"). Link-only, per the product's refusal of
// its own file storage for this feature -- an external image URL, shown as a simple gallery grid.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Field, IconButton, Input, Skeleton, StateView, Textarea, toast } from '@devon/ui'
import { Trash2 } from 'lucide-react'
import { useAddPhotoMutation, useDeletePhotoMutation, usePhotosQuery } from '../hooks.js'

export function PhotosPanel({ eventId }: { eventId: string }) {
  const t = useT()
  const photosQuery = usePhotosQuery(eventId, true)
  const addMutation = useAddPhotoMutation(eventId)
  const deleteMutation = useDeletePhotoMutation(eventId)
  const [url, setUrl] = React.useState('')
  const [caption, setCaption] = React.useState('')
  const draftRevision = React.useRef({ url: 0, caption: 0 })

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    const submittedRevision = { ...draftRevision.current }
    try {
      await addMutation.mutateAsync({ url: url.trim(), caption: caption.trim() || undefined })
      if (submittedRevision.url === draftRevision.current.url) setUrl('')
      if (submittedRevision.caption === draftRevision.current.caption) setCaption('')
    } catch {
      toast(t('events.error.title'))
    }
  }

  const handleDelete = async (photoId: string) => {
    try {
      await deleteMutation.mutateAsync(photoId)
    } catch {
      toast(t('events.error.title'))
    }
  }

  function renderGalleryBody() {
    if (photosQuery.isPending) {
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="aspect-square w-full" />
        </div>
      )
    }
    if (photosQuery.isError) {
      return (
        <StateView
          kind="error"
          titleKey="events.error.title"
          bodyKey="events.error.body"
          action={{ labelKey: 'events.actions.retry', onAction: () => void photosQuery.refetch() }}
        />
      )
    }
    if (photosQuery.data.items.length === 0) {
      return <p className="text-small text-muted-foreground">{t('events.photos.empty')}</p>
    }
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photosQuery.data.items.map((photo) => (
          <figure
            key={photo.id}
            className="group relative overflow-hidden rounded-md border border-border"
          >
            <img
              src={photo.url}
              alt={photo.caption ?? ''}
              className="aspect-square w-full object-cover"
              loading="lazy"
            />
            {photo.caption ? (
              <figcaption className="bg-card/90 px-2 py-1 wrap-anywhere text-caption text-foreground">
                {photo.caption}
              </figcaption>
            ) : null}
            {photo.canDelete ? (
              <IconButton
                aria-label={t('events.photos.delete')}
                onClick={() => handleDelete(photo.id)}
                className="absolute right-1 top-1 bg-card/80 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              >
                <Trash2 aria-hidden="true" />
              </IconButton>
            ) : null}
          </figure>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-2 rounded-md border border-border p-4"
      >
        <Field label={t('events.photos.urlLabel')} htmlFor="photo-url">
          <Input
            id="photo-url"
            type="url"
            value={url}
            onChange={(e) => {
              draftRevision.current.url += 1
              setUrl(e.target.value)
            }}
            placeholder="https://…"
          />
        </Field>
        <Field label={t('events.photos.captionLabel')} htmlFor="photo-caption">
          <Textarea
            id="photo-caption"
            rows={2}
            value={caption}
            onChange={(e) => {
              draftRevision.current.caption += 1
              setCaption(e.target.value)
            }}
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={addMutation.isPending} disabled={!url.trim()}>
            {t('events.photos.add')}
          </Button>
        </div>
      </form>

      {renderGalleryBody()}
    </div>
  )
}
