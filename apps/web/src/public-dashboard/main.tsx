/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- Named scroll regions expose keyboard scrolling without making their cards interactive. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import type { PublicDashboard } from '@devon/contracts'
import { copy, type DashboardLocale } from './text.js'
import './style.css'

function LanguageFlag({ locale }: { locale: DashboardLocale }) {
  return (
    <svg className="language-flag" viewBox="0 0 60 40" aria-hidden="true">
      {locale === 'en' ? (
        <>
          <path fill="#012169" d="M0 0h60v40H0z" />
          <path stroke="#fff" strokeWidth="8" d="m0 0 60 40M60 0 0 40" />
          <path stroke="#c8102e" strokeWidth="3" d="m0 0 60 40M60 0 0 40" />
          <path stroke="#fff" strokeWidth="13" d="M30 0v40M0 20h60" />
          <path stroke="#c8102e" strokeWidth="7" d="M30 0v40M0 20h60" />
        </>
      ) : locale === 'ru' ? (
        <>
          <path fill="#fff" d="M0 0h60v40H0z" />
          <path fill="#0039a6" d="M0 13.33h60v13.34H0z" />
          <path fill="#d52b1e" d="M0 26.67h60V40H0z" />
        </>
      ) : (
        <>
          <path fill="#1eb53a" d="M0 0h60v40H0z" />
          <path fill="#ce1126" d="M0 12h60v16H0z" />
          <path fill="#fff" d="M0 13h60v14H0z" />
          <path fill="#0099b5" d="M0 0h60v12H0z" />
          <circle fill="#fff" cx="9" cy="6" r="4.5" />
          <circle fill="#0099b5" cx="11" cy="6" r="4" />
          {[3, 4, 5].flatMap((count, row) =>
            Array.from({ length: count }, (_, col) => (
              <path
                key={`${row}-${col}`}
                fill="#fff"
                transform={`translate(${16 + (5 - count + col) * 3} ${2 + row * 3.5})`}
                d="m0-1.2.3.8h.9l-.7.5.3.9L0 .5l-.8.5.3-.9-.7-.5h.9z"
              />
            )),
          )}
        </>
      )}
    </svg>
  )
}

function Dashboard() {
  const [locale, setLocale] = React.useState<DashboardLocale>(() =>
    navigator.language.startsWith('ru')
      ? 'ru'
      : navigator.language.startsWith('uz')
        ? 'uz-Latn'
        : 'en',
  )
  const t = copy[locale]
  const [tab, setTab] = React.useState<'cards' | 'structure'>('cards')
  const [data, setData] = React.useState<PublicDashboard | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'unavailable' | 'offline'>(
    'loading',
  )
  const [retry, setRetry] = React.useState(0)
  React.useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  React.useEffect(() => {
    const controller = new AbortController()
    let active = true,
      loading = false
    const token = location.hash.slice(1)
    if (
      !/^\/view\/(?:index\.html)?$/.test(location.pathname) ||
      !/^[A-Za-z0-9_-]{43}$/.test(token)
    ) {
      setState('unavailable')
      return
    }
    const refresh = async () => {
      if (loading) return
      loading = true
      try {
        const response = await fetch('/api/v1/public-dashboard', {
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        })
        if (!response.ok) {
          if (active) {
            setData(null)
            setState(response.status === 404 ? 'unavailable' : 'offline')
          }
          return
        }
        const result = (await response.json()) as PublicDashboard
        if (active) {
          setData(result)
          setState('ready')
        }
      } catch {
        if (active) {
          setData(null)
          setState('offline')
        }
      } finally {
        loading = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 30000)
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [retry])
  React.useEffect(() => {
    const changed = () => {
      setData(null)
      setState('loading')
      setRetry((n) => n + 1)
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const people = data?.members ?? []
  const columns = [
    ...people,
    ...(data?.cards.some((c) => !c.assigneeKey)
      ? [{ key: 'unassigned', name: t.unassignedCards, head: false, colour: 'muted-foreground' }]
      : []),
  ]
  const byPerson = new Map(people.map((m) => [m.key, m]))
  const assigned = new Set(data?.units.flatMap((u) => u.people.map((p) => p.memberKey)))
  const tree = (parent: string | null, seen = new Set<string>()): React.ReactNode =>
    data?.units
      .filter((u) => u.parentKey === parent && !seen.has(u.key))
      .map((u) => (
        <li
          key={u.key}
          className="unit"
          style={{ '--unit-color': `var(--color-unit-${u.colour})` } as React.CSSProperties}
        >
          <div className="unit-heading">
            <span className="unit-avatar" aria-hidden>
              {u.name.trim().charAt(0).toUpperCase()}
            </span>
            <h3>{u.name}</h3>
            <span className="count">{u.people.length}</span>
          </div>
          <ul className="people-list">
            {u.people.map((p) => (
              <li key={p.memberKey}>
                <span className="person-avatar" aria-hidden>
                  {byPerson
                    .get(p.memberKey)
                    ?.name.split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <span className="person-name">{byPerson.get(p.memberKey)?.name}</span>
                {p.role !== 'member' && <span className="role">{t[p.role]}</span>}
              </li>
            ))}
          </ul>
          <ul className="unit-children">{tree(u.key, new Set([...seen, u.key]))}</ul>
        </li>
      ))
  return (
    <div className="dashboard">
      <header className="masthead">
        <div>
          <p className="eyebrow">{t.dashboard}</p>
          <h1>{data?.department ?? t.team}</h1>
        </div>
        <div className="header-tools">
          <label className="language">
            <span className="tile-label">{t.language}</span>
            <span className="language-choice">
              <LanguageFlag locale={locale} />
              <select
                translate="no"
                value={locale}
                onChange={(e) => setLocale(e.target.value as DashboardLocale)}
              >
                <option value="en">English</option>
                <option value="ru">Русский</option>
                <option value="uz-Latn">O‘zbekcha</option>
                <option value="uz-Cyrl">Ўзбекча</option>
              </select>
            </span>
          </label>
        </div>
      </header>
      {state === 'ready' && data ? (
        <main>
          <div className="navigation">
            <div role="tablist" aria-label={t.views} className="tabs">
              {(['cards', 'structure'] as const).map((value, i) => (
                <button
                  key={value}
                  id={`tab-${value}`}
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls={`panel-${value}`}
                  tabIndex={tab === value ? 0 : -1}
                  onClick={() => setTab(value)}
                  onKeyDown={(e) => {
                    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                      e.preventDefault()
                      const next =
                        e.key === 'Home'
                          ? 'cards'
                          : e.key === 'End'
                            ? 'structure'
                            : i === 0
                              ? 'structure'
                              : 'cards'
                      setTab(next)
                      document.getElementById(`tab-${next}`)?.focus()
                    }
                  }}
                >
                  {t[value]}
                </button>
              ))}
            </div>
            <dl className="dashboard-metrics">
              <div className="metric">
                <dt className="tile-label">{tab === 'cards' ? t.activeCards : t.units}</dt>
                <dd>{tab === 'cards' ? data.cards.length : data.units.length}</dd>
              </div>
              <div className="metric">
                <dt className="tile-label">{t.people}</dt>
                <dd>{people.length}</dd>
              </div>
              <div className="metric updated">
                <dt className="tile-label">{t.updated}</dt>
                <dd>
                  <span className="live-dot" aria-hidden="true" />
                  <time dateTime={data.updatedAt}>
                    {new Date(data.updatedAt).toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </time>
                </dd>
              </div>
            </dl>
          </div>
          <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
            {tab === 'cards' ? (
              <>
                <h2 className="sr-only">{t.cards}</h2>
                {data.truncated && <p className="notice">{t.limited}</p>}
                <div
                  className="board"
                  role="region"
                  tabIndex={0}
                  aria-label={t.board}
                  onKeyDown={(event) => {
                    if (
                      event.target !== event.currentTarget ||
                      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
                    )
                      return
                    event.preventDefault()
                    const board = event.currentTarget
                    const column = board.querySelector<HTMLElement>('.column')
                    const step =
                      (column?.offsetWidth ?? board.clientWidth) +
                      parseFloat(getComputedStyle(board).columnGap)
                    const left =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? board.scrollWidth
                          : board.scrollLeft + (event.key === 'ArrowLeft' ? -step : step)
                    board.scrollTo({ left, behavior: 'instant' })
                  }}
                >
                  {columns.map((m) => {
                    const cards = data.cards.filter(
                      (c) => (c.assigneeKey ?? 'unassigned') === m.key,
                    )
                    return (
                      <section
                        className="column"
                        key={m.key}
                        style={
                          { '--work-unit-color': `var(--color-${m.colour})` } as React.CSSProperties
                        }
                      >
                        <header className="column-heading">
                          <span className="avatar" aria-hidden>
                            {m.name
                              .split(' ')
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')}
                          </span>
                          <h3>{m.name}</h3>
                          <span className="count">{cards.length}</span>
                        </header>
                        <div
                          className="column-cards"
                          role="region"
                          tabIndex={0}
                          aria-label={m.name}
                        >
                          {cards.map((c) => (
                            <article className="work-card" key={c.key}>
                              <h4>{c.title}</h4>
                              <span className={`stage ${c.stage}`}>
                                <span aria-hidden>{c.stage === 'in_progress' ? '◐' : '○'}</span>
                                {c.stage === 'in_progress' ? t.inProgress : t.todo}
                              </span>
                            </article>
                          ))}
                          {!cards.length && <p className="empty-column">{t.noCards}</p>}
                        </div>
                      </section>
                    )
                  })}
                  {!columns.length && <p className="empty-column">{t.noCards}</p>}
                </div>
              </>
            ) : (
              <>
                <div className="view-heading">
                  <div>
                    <h2>{t.structure}</h2>
                    <p>{t.structureHint}</p>
                  </div>
                </div>
                <div className="structure-list">
                  <section className="leadership">
                    <h3>{t.leadership}</h3>
                    <ul className="people-list">
                      {people
                        .filter((m) => m.head)
                        .map((m) => (
                          <li key={m.key}>
                            <span className="person-avatar" aria-hidden>
                              {m.name
                                .split(' ')
                                .map((n) => n[0])
                                .slice(0, 2)
                                .join('')}
                            </span>
                            <span className="person-name">{m.name}</span>
                            <span className="role">{t.head}</span>
                          </li>
                        ))}
                    </ul>
                  </section>
                  <ul className="unit-roots">{tree(null)}</ul>
                  {people.some((m) => !m.head && !assigned.has(m.key)) && (
                    <section className="unassigned">
                      <h3>{t.unassigned}</h3>
                      <ul className="people-list">
                        {people
                          .filter((m) => !m.head && !assigned.has(m.key))
                          .map((m) => (
                            <li key={m.key}>
                              <span className="person-avatar" aria-hidden>
                                {m.name
                                  .split(' ')
                                  .map((n) => n[0])
                                  .slice(0, 2)
                                  .join('')}
                              </span>
                              <span className="person-name">{m.name}</span>
                            </li>
                          ))}
                      </ul>
                    </section>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      ) : (
        <main className="state" aria-live="polite">
          <div className="state-mark" aria-hidden>
            {state === 'loading' ? '…' : '○'}
          </div>
          <h2>
            {state === 'loading' ? t.loading : state === 'unavailable' ? t.unavailable : t.offline}
          </h2>
          <p>
            {state === 'unavailable' ? t.unavailableBody : state === 'offline' ? t.offlineBody : ''}
          </p>
          {state === 'offline' && <button onClick={() => setRetry((n) => n + 1)}>{t.retry}</button>}
        </main>
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Dashboard />)
