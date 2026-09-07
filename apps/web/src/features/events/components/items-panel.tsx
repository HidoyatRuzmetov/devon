// "Who brings what" (TECH-SPEC §3.4 `event_items`: "potluck / checklist"). Claim is optimistic-feeling
// but server-arbitrated -- a 409 from a race (two people tapping the same item at once) surfaces as a
// toast, never a silent no-op.
import * as React from 'react'
import { useT } from '@devon/i18n'
import { Button, Field, Input, Skeleton, StateView, toast } from '@devon/ui'
import {
  useAddItemMutation,
  useClaimItemMutation,
  useItemsQuery,
  useReleaseItemMutation,
} from '../hooks.js'
import type { ItemDto } from '../schemas.js'

export function ItemsPanel({ eventId }: { eventId: string }) {
  const t = useT()
  const itemsQuery = useItemsQuery(eventId, true)
  const addMutation = useAddItemMutation(eventId)
  const claimMutation = useClaimItemMutation(eventId)
  const releaseMutation = useReleaseItemMutation(eventId)
  const [label, setLabel] = React.useState('')
  const [quantity, setQuantity] = React.useState('1')

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim()) return
    try {
      await addMutation.mutateAsync({ label: label.trim(), quantity: Number(quantity) || 1 })
      setLabel('')
      setQuantity('1')
    } catch {
      toast(t('events.error.title'))
    }
  }

  const handleClaim = async (itemId: string) => {
    try {
      await claimMutation.mutateAsync(itemId)
    } catch {
      toast(t('events.items.alreadyClaimed'))
    }
  }

  const handleRelease = async (itemId: string) => {
    try {
      await releaseMutation.mutateAsync(itemId)
    } catch {
      toast(t('events.error.title'))
    }
  }

  function renderClaimButton(item: ItemDto) {
    if (item.claimedByMe) {
      return (
        <Button variant="secondary" size="sm" onClick={() => handleRelease(item.id)}>
          {t('events.items.release')}
        </Button>
      )
    }
    if (!item.claimedBy) {
      return (
        <Button variant="secondary" size="sm" onClick={() => handleClaim(item.id)}>
          {t('events.items.claim')}
        </Button>
      )
    }
    return null
  }

  function renderItemsBody() {
    if (itemsQuery.isPending) return <Skeleton className="h-24 w-full" />
    if (itemsQuery.isError) {
      return <StateView kind="error" titleKey="events.error.title" bodyKey="events.error.body" />
    }
    if (itemsQuery.data.items.length === 0) {
      return <p className="text-small text-muted-foreground">{t('events.items.empty')}</p>
    }
    return (
      <ul className="divide-y divide-border rounded-md border border-border">
        {itemsQuery.data.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-body text-foreground">
                {item.label}
                {item.quantity > 1 ? ` ×${item.quantity}` : ''}
              </span>
              {item.claimedBy ? (
                <span className="text-caption text-muted-foreground">
                  {t(item.claimedByMe ? 'events.items.claimedByMe' : 'events.items.claimedBy', {
                    name: `${item.claimedBy.givenName} ${item.claimedBy.familyName}`,
                  })}
                </span>
              ) : null}
            </div>
            {renderClaimButton(item)}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
        <Field label={t('events.items.add')} htmlFor="item-label" className="flex-1">
          <Input
            id="item-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t('events.items.labelPlaceholder')}
            maxLength={200}
          />
        </Field>
        <Field label={t('events.items.quantityLabel')} htmlFor="item-quantity">
          <Input
            id="item-quantity"
            type="number"
            min={1}
            className="w-20"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Button type="submit" loading={addMutation.isPending} disabled={!label.trim()}>
          {t('events.items.add')}
        </Button>
      </form>

      {renderItemsBody()}
    </div>
  )
}
