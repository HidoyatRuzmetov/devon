import * as React from 'react'
import { EventIllustration } from '../illustrations/index.js'
import type { EventDto } from '../schemas.js'

/** The image stays on the authenticated file route; a missing image has the same illustrated fallback as an event without a photo. */
export function EventCover({
  event,
  className,
  illustrationKeyOverride,
}: {
  event: EventDto
  className?: string | undefined
  illustrationKeyOverride?: string | undefined
}) {
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null)
  if (event.thumbnailUrl && event.thumbnailUrl !== failedUrl) {
    return (
      <img
        src={event.thumbnailUrl}
        alt=""
        className={className}
        onError={() => setFailedUrl(event.thumbnailUrl ?? null)}
      />
    )
  }
  return (
    <EventIllustration
      illustrationKey={event.illustrationKey}
      category={event.category}
      eventId={event.id}
      illustrationKeyOverride={illustrationKeyOverride}
      className={className}
    />
  )
}
