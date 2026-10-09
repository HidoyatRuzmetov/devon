import { isPlainHttpUrl } from '@devon/contracts'

/** Old rows stay readable, but unsupported stored URLs never become navigable browser hrefs. */
export function CardLinkLabel({ url, title }: { url: string; title: string }) {
  return isPlainHttpUrl(url) ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex-1 truncate text-small text-primary underline"
    >
      {title}
    </a>
  ) : (
    <span className="flex-1 truncate text-small text-muted-foreground">{title}</span>
  )
}
