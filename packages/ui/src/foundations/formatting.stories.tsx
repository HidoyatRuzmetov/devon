import type { Meta, StoryObj } from '@storybook/react-vite'
import { LOCALES, formatDate, formatNumber, formatUzs, type Locale } from '@devon/i18n'

/** design.md §12.F: dates (short and long form), numbers, names in "Familiya Ism Otasining ismi"
 * and "Familiya I.O." forms, per locale. Short-form dates/numbers/currency come straight from
 * `@devon/i18n`'s formatters (the thing being proven here is that this package's typography and the
 * package's *output* agree, not a second implementation of them). The long date form is route copy
 * (spec.md §6.1), not a general formatter -- shown here as a fixed reference string per locale. */
const SAMPLE_DATE = new Date('2026-09-06T09:00:00+05:00')
const SAMPLE_NUMBER = 12450.5
const SAMPLE_UZS = 3250000

const LONG_DATE: Record<Locale, string> = {
  'uz-Latn': '2026-yil 6-sentabr, yakshanba',
  'uz-Cyrl': '2026 йил 6 сентябр, якшанба',
  ru: '6 сентября 2026 г., воскресенье',
  en: 'Sunday, 6 September 2026',
}

const FULL_NAME: Record<Locale, string> = {
  'uz-Latn': 'Yusupov Aziz Baxtiyorovich',
  'uz-Cyrl': 'Юсупов Азиз Бахтиёрович',
  ru: 'Юсупов Азиз Бахтиёрович',
  en: 'Yusupov Aziz Bakhtiyorovich',
}

const SHORT_NAME: Record<Locale, string> = {
  'uz-Latn': 'Yusupov A.B.',
  'uz-Cyrl': 'Юсупов А.Б.',
  ru: 'Юсупов А.Б.',
  en: 'Yusupov A.B.',
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border py-2">
      <span className="text-caption uppercase tracking-(--text-eyebrow--letter-spacing) text-muted-foreground">
        {label}
      </span>
      <span className="text-body text-foreground">{value}</span>
    </div>
  )
}

function FormattingPage() {
  return (
    <div className="flex flex-col gap-8 bg-background p-8 text-foreground">
      {LOCALES.map((locale) => (
        <section key={locale}>
          <h2 className="mb-2 text-h3">{locale}</h2>
          <Row label="Date (short, DD.MM.YYYY, always)" value={formatDate(SAMPLE_DATE, locale)} />
          <Row label="Date (long form, route copy)" value={LONG_DATE[locale]} />
          <Row label="Number" value={formatNumber(SAMPLE_NUMBER, locale)} />
          <Row label="Currency (soʻm/сум/UZS)" value={formatUzs(SAMPLE_UZS, locale)} />
          <Row label='Name, formal ("Familiya Ism Otasining ismi")' value={FULL_NAME[locale]} />
          <Row label='Name, casual ("Familiya I.O.")' value={SHORT_NAME[locale]} />
        </section>
      ))}
    </div>
  )
}

const meta: Meta<typeof FormattingPage> = {
  title: 'Foundations/Formatting',
  component: FormattingPage,
  parameters: { layout: 'fullscreen' },
}
export default meta
type Story = StoryObj<typeof FormattingPage>

export const Default: Story = {}
