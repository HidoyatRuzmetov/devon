import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useFontsLoaded } from '../lib/use-fonts-loaded.js'

/**
 * design.md §12.F / AC-6: the one page whose whole job is to make a missing glyph or a wrong
 * apostrophe visible in a screenshot. `wp-qa-visual` captures `storybook-glyphs__{light,dark}.png`;
 * `wp-a11y-i18n` inspects it for tofu, substitution or a straight quote next to a curly one.
 *
 * The two proof strings, from the item handoff and design.md's own failure-mode list (§4(j)):
 *   uz-Latn: "Oʻzbekiston Gʻalaba maʼno sanʼat"  -- Oʻ/Gʻ = U+02BB, ʼ = U+02BC
 *   uz-Cyrl: "Ўзбекистон Ғалаба қишлоқ ҳақида"    -- ў ғ қ ҳ = Cyrillic Extended / Supplement
 */
const UZ_LATN = 'Oʻzbekiston Gʻalaba maʼno sanʼat'
const UZ_CYRL = 'Ўзбекистон Ғалаба қишлоқ ҳақида'
const SIZES = [12, 14, 16, 20, 30, 40] as const

const FAMILIES = [
  {
    key: 'display',
    label: '--font-display (Devon Display / IBM Plex Serif)',
    family: 'var(--font-display)',
  },
  { key: 'sans', label: '--font-sans (Devon Sans / Inter)', family: 'var(--font-sans)' },
  { key: 'mono', label: '--font-mono (Devon Mono / IBM Plex Mono)', family: 'var(--font-mono)' },
] as const

/** The control row: a font stack that cannot resolve to our self-hosted faces, so a reviewer has a
 * side-by-side reference for what tofu/substitution actually looks like on this machine
 * (design.md §12.F: "a deliberate fallback-font control row for comparison"). */
const FALLBACK_FAMILY = '"Devon Nonexistent Test Font", "Comic Sans MS", cursive'

function GlyphRow({ family, size }: { family: string; size: number }) {
  return (
    <div
      className="flex items-baseline gap-8 border-b border-border py-2"
      style={{ fontFamily: family }}
    >
      <span className="w-10 shrink-0 font-mono text-caption text-muted-foreground">{size}px</span>
      <span style={{ fontSize: size }}>{UZ_LATN}</span>
      <span style={{ fontSize: size }}>{UZ_CYRL}</span>
    </div>
  )
}

function GlyphsPage() {
  const loaded = useFontsLoaded()
  return (
    <div
      data-font-loaded={loaded}
      className="flex flex-col gap-10 bg-background p-8 text-foreground"
    >
      {FAMILIES.map((f) => (
        <section key={f.key}>
          <h2 className="mb-2 text-h3">{f.label}</h2>
          {SIZES.map((size) => (
            <GlyphRow key={size} family={f.family} size={size} />
          ))}
        </section>
      ))}

      <section>
        <h2 className="mb-2 text-h3">Fallback (nazorat) -- forced substitution for comparison</h2>
        {SIZES.slice(0, 3).map((size) => (
          <GlyphRow key={size} family={FALLBACK_FAMILY} size={size} />
        ))}
      </section>

      <p className="font-mono text-caption text-muted-foreground">
        data-font-loaded={String(loaded)} (flips true once every self-hosted subset used above is
        confirmed loaded via `document.fonts.ready` + `document.fonts.check(...)`)
      </p>
    </div>
  )
}

const meta: Meta<typeof GlyphsPage> = {
  title: 'Foundations/Glyphs',
  component: GlyphsPage,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof GlyphsPage>

export const Default: Story = {}
