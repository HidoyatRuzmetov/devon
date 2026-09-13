import * as React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionProvider } from './motion-provider.js'
import { Stagger, StaggerItem } from './stagger.js'
import { Reveal, BlurFade } from './reveal.js'
import { HoverLift, PressScale } from './hover-lift.js'
import { Collapsible } from './collapsible.js'
import { Shimmer } from './shimmer.js'
import { Celebrate, useCelebrate } from './celebrate.js'
import { AnimatedCheck } from './animated-check.js'
import { ProgressRing } from './progress-ring.js'
import { AmbientGradient, IdleFloat } from './ambient-gradient.js'
import { HoverCard, HoverCardTrigger, HoverCardContent } from './hover-card.js'
import { Shake, useShake } from './shake.js'
import { FlashOnChange } from './flash.js'
import { SettlePulse, useSettlePulse, LivePulse } from './pulse.js'
import { Strikethrough } from './strikethrough.js'
import { CountFlow } from './count-flow.js'
import { Swap } from './swap.js'

const meta = {
  title: 'Foundations/Motion catalogue',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border py-6">
      <h3 className="text-eyebrow uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Tile({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-4 text-body text-foreground shadow-1">
      {label}
    </div>
  )
}

function CelebrateDemo() {
  const { play, fire, onDone } = useCelebrate()
  const [checked, setChecked] = React.useState(false)
  return (
    <button
      type="button"
      className="relative inline-flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground"
      onClick={() => {
        setChecked((v) => !v)
        if (!checked) fire()
      }}
    >
      <span className="relative inline-flex size-5 items-center justify-center rounded-sm border border-border text-success">
        <AnimatedCheck checked={checked} />
        <Celebrate play={play} onDone={onDone} />
      </span>
      Bajarildi
    </button>
  )
}

function CollapsibleDemo() {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="max-w-100">
      <button
        type="button"
        className="rounded-sm border border-border bg-card px-3 py-2 text-body text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        Tafsilotlar
      </button>
      <Collapsible open={open}>
        <p className="pt-3 text-body text-muted-foreground">
          Balandlik avtomatik ravishda animatsiyalanadi.
        </p>
      </Collapsible>
    </div>
  )
}

function ShakeDemo() {
  const { play, fire, onDone } = useShake()
  return (
    <Shake play={play} onDone={onDone}>
      <button
        type="button"
        onClick={fire}
        className="rounded-md border border-border bg-card px-3 py-2 text-body text-foreground"
      >
        Ruxsat berilmagan joyga tashlash
      </button>
    </Shake>
  )
}

function FlashDemo() {
  const [priority, setPriority] = React.useState('Oʻrta')
  const next = { Oʻrta: 'Yuqori', Yuqori: 'Shoshilinch', Shoshilinch: 'Oʻrta' } as Record<
    string,
    string
  >
  return (
    <button
      type="button"
      onClick={() => setPriority((p) => next[p] ?? 'Oʻrta')}
      className="rounded-md border border-border bg-card px-3 py-2 text-left text-body text-foreground"
    >
      <span className="text-caption text-muted-foreground">Muhimligi </span>
      <FlashOnChange value={priority}>{priority}</FlashOnChange>
    </button>
  )
}

function SettlePulseDemo() {
  const { play, fire, onDone } = useSettlePulse()
  const [count, setCount] = React.useState(7)
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => {
          fire()
          setCount((n) => n + 1)
        }}
        className="relative rounded-md border border-border bg-card px-3 py-2 text-body text-foreground"
      >
        Bajarildi
        <SettlePulse play={play} onDone={onDone} />
      </button>
      <span className="text-body text-muted-foreground">
        Bajarilgan: <CountFlow value={count} />
      </span>
    </div>
  )
}

function StrikethroughDemo() {
  const [done, setDone] = React.useState(false)
  return (
    <button
      type="button"
      onClick={() => setDone((v) => !v)}
      className="max-w-100 text-left text-body text-foreground"
    >
      <Strikethrough done={done}>
        Hisobotni tayyorlash va boshqarma boshligʻiga kelishuvga yuborish
      </Strikethrough>
    </button>
  )
}

function SwapDemo() {
  const [pending, setPending] = React.useState(true)
  return (
    <div className="flex flex-col items-start gap-3">
      <button
        type="button"
        onClick={() => setPending((v) => !v)}
        className="rounded-sm border border-border bg-card px-3 py-1.5 text-small text-foreground"
      >
        {pending ? 'Yuklandi' : 'Qayta yuklash'}
      </button>
      <Swap
        pending={pending}
        className="w-100"
        fallback={
          <div className="flex flex-col gap-2">
            <Shimmer className="h-5 w-60" />
            <Shimmer className="h-4 w-full" />
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-lead text-foreground">Raqamli xizmatlar boshqarmasi</p>
          <p className="text-small text-muted-foreground">12 ta xodim · 34 ta ochiq vazifa</p>
        </div>
      </Swap>
    </div>
  )
}

/** Every row of UI-OVERHAUL.md §3 on one page. Flip the Storybook a11y/reduced-motion emulation to
 * check the replacement branch of each one. */
export const Catalogue: Story = {
  render: () => (
    <MotionProvider>
      <div className="relative min-h-200 bg-background p-8 font-sans">
        <AmbientGradient variant="hub" />
        <div className="mx-auto flex max-w-200 flex-col">
          <Row title="Stagger + StaggerItem">
            <Stagger className="grid grid-cols-3 gap-3">
              {['Bugun', 'Muddati', 'Tadbirlar'].map((l) => (
                <StaggerItem key={l}>
                  <Tile label={l} />
                </StaggerItem>
              ))}
            </Stagger>
          </Row>

          <Row title="Reveal / BlurFade">
            <div className="grid grid-cols-2 gap-3">
              <Reveal>
                <Tile label="Reveal" />
              </Reveal>
              <BlurFade delay={0.1}>
                <Tile label="BlurFade" />
              </BlurFade>
            </div>
          </Row>

          <Row title="HoverLift / PressScale">
            <div className="grid grid-cols-2 gap-3">
              <HoverLift>
                <Tile label="Hover" />
              </HoverLift>
              <PressScale>
                <Tile label="Press" />
              </PressScale>
            </div>
          </Row>

          <Row title="Collapsible">
            <CollapsibleDemo />
          </Row>

          <Row title="Shimmer skeleton">
            <div className="flex flex-col gap-2">
              <Shimmer className="h-5 w-60" />
              <Shimmer className="h-4 w-100" />
              <Shimmer className="h-30 w-full" />
            </div>
          </Row>

          <Row title="Celebrate + AnimatedCheck">
            <CelebrateDemo />
          </Row>

          <Row title="ProgressRing">
            <div className="flex items-center gap-4">
              <ProgressRing value={35} label="35%" size={56}>
                35%
              </ProgressRing>
              <ProgressRing value={80} label="80%" size={56} toneClassName="text-success">
                80%
              </ProgressRing>
            </div>
          </Row>

          <Row title="IdleFloat (empty-state illustration)">
            <IdleFloat className="w-40">
              <div className="h-24 rounded-md bg-illustration-fill" />
            </IdleFloat>
          </Row>

          <Row title="Shake (the product's refusal)">
            <ShakeDemo />
          </Row>

          <Row title="FlashOnChange (optimistic receipt)">
            <FlashDemo />
          </Row>

          <Row title="SettlePulse + CountFlow (a card lands in Done)">
            <SettlePulseDemo />
          </Row>

          <Row title="LivePulse (somebody is editing)">
            <span className="inline-flex items-center gap-2 text-body text-muted-foreground">
              <LivePulse label="Aziza Karimova tahrirlamoqda" />
              Aziza Karimova tahrirlamoqda
            </span>
          </Row>

          <Row title="Strikethrough (the third beat of done)">
            <StrikethroughDemo />
          </Row>

          <Row title="Swap (skeleton to content, no layout jump)">
            <SwapDemo />
          </Row>

          <Row title="HoverCard">
            <HoverCard>
              <HoverCardTrigger className="text-body text-primary underline underline-offset-2">
                Aziza Karimova
              </HoverCardTrigger>
              <HoverCardContent>
                <p className="text-small text-muted-foreground">Bosh mutaxassis · Tahlil boʻlimi</p>
              </HoverCardContent>
            </HoverCard>
          </Row>
        </div>
      </div>
    </MotionProvider>
  ),
}
