import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Avatar } from '@devon/ui'

const fixture = document.createElement('div')
fixture.dataset['avatarFixture'] = 'true'
fixture.className = 'fixed inset-0 z-[9999] flex flex-col gap-4 overflow-auto bg-background p-4'
// This browser-loaded fixture is outside the Tailwind source scan; use an explicit overlay layer.
fixture.style.zIndex = '9999'
document.body.append(fixture)
createRoot(fixture).render(
  <>
    {(['xs', 'sm', 'md', 'lg'] as const).map((size) => (
      <section
        key={size}
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      >
        <h2 className="text-body text-foreground">{size}</h2>
        <div className="flex flex-wrap items-center gap-4">
          {['h', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map((seed, index) => (
            <Avatar
              key={seed}
              hueSeed={seed}
              size={size}
              alt={`Unit ${index + 1}`}
              initials="NW"
              data-avatar-size={size}
              data-avatar-hue={index + 1}
            />
          ))}
        </div>
      </section>
    ))}
  </>,
)
