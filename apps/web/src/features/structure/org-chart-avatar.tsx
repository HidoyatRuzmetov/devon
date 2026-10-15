import * as React from 'react'
import { initialsFromName } from '@devon/ui'
import { avatarUrl } from '../../lib/avatar.js'

/** The SVG chart cannot use the HTML Avatar primitive; keep the same photo/fallback behavior. */
export function OrgChartAvatar({
  person,
  cy,
  fill,
  textStyle,
}: {
  person: { givenName: string; familyName: string; avatarKey: string | null }
  cy: number
  fill: string
  textStyle: React.CSSProperties
}) {
  const clipId = `org-avatar-${React.useId().replaceAll(':', '')}`
  const src = avatarUrl(person.avatarKey, 64)
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const imageRef = React.useRef<SVGImageElement>(null)
  React.useLayoutEffect(() => {
    const image = imageRef.current
    if (!image || !src) return
    const failed = () => setFailedSrc(src)
    image.addEventListener('error', failed)
    return () => image.removeEventListener('error', failed)
  }, [src])
  return (
    <g aria-hidden="true">
      <circle cx={24} cy={cy} r={11} fill={fill} />
      <text
        x={24}
        y={cy + 4}
        textAnchor="middle"
        className="fill-white text-caption"
        style={textStyle}
      >
        {initialsFromName(person.givenName, person.familyName)}
      </text>
      {src && src !== failedSrc ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <circle cx={24} cy={cy} r={11} />
            </clipPath>
          </defs>
          <image
            ref={imageRef}
            href={src}
            x={13}
            y={cy - 11}
            width={22}
            height={22}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${clipId})`}
          />
        </>
      ) : null}
    </g>
  )
}
