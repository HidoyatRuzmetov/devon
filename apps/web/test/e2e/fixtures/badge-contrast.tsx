// Loaded only by the local Vite QA browser, never imported by the application entry point.
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Avatar, Badge, Input, Select } from '@devon/ui'

const fixture = document.createElement('div')
fixture.dataset['contrastFixture'] = 'true'
fixture.className = 'fixed inset-0 flex flex-col gap-6 bg-background p-8'
fixture.style.zIndex = '9999'
document.body.append(fixture)
createRoot(fixture).render(
  <>
    <section className="flex flex-wrap gap-4 rounded-lg border border-border bg-card p-6">
      {['h', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map((seed, index) => (
        <Avatar
          key={seed}
          hueSeed={seed}
          alt={`Unit ${index + 1}`}
          initials="AB"
          data-contrast-avatar={index + 1}
        />
      ))}
    </section>
    {(['bg-card', 'bg-background'] as const).map((surface) => (
      <section key={surface} className={`${surface} rounded-lg border border-border p-6`}>
        <h2 className="mb-4 text-h3 text-foreground">{surface}</h2>
        <div className="flex flex-wrap gap-4">
          {(
            [
              'neutral',
              'attention',
              'success',
              'warning',
              'destructive',
              'info',
              'primary',
            ] as const
          ).map((tone) => (
            <Badge key={tone} tone={tone} variant="subtle" data-contrast-tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
      </section>
    ))}
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-6">
      <label className="text-body text-foreground" htmlFor="native-date-fixture">
        Native date control
      </label>
      <Input id="native-date-fixture" type="date" defaultValue="2030-10-10" />
      <label className="text-body text-foreground" htmlFor="native-select-fixture">
        Native select control
      </label>
      <Select
        id="native-select-fixture"
        defaultValue="one"
        options={[
          { value: 'one', label: 'First option' },
          { value: 'two', label: 'Second option' },
        ]}
      />
    </section>
  </>,
)
