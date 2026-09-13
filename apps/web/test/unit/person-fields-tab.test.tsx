// v1.1 critique SEV1 #2 -- the golden test the adjudication asked for: "a person with a stored value
// never renders 'Toʻldirilmagan' and never triggers the required-missing banner."
//
// The bug it locks down: the Maydonlar tab matched answers on `subjectId`, which for a person field
// is the **membership** id, against the **user** id it was given. The two can never be equal, so the
// flagship compliance page reported all 27 people as non-compliant while the people table, reading
// the same API correctly, showed their answers. Two assertions here would have caught it -- one that
// a stored answer renders, one that the amber banner stays away -- so both are here, plus the
// negative case (a genuinely empty required field still raises the banner), because a test that only
// proves the alarm is silent would pass on a tab that renders nothing at all.
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PersonFieldsTab } from '../../src/features/people/person/person-fields-tab.js'

const PERSON_USER_ID = '9e01f74f-0000-4000-8000-000000000001'
const PERSON_MEMBERSHIP_ID = '1b69f28d-0000-4000-8000-000000000002'
const COLLEAGUE_USER_ID = '9e01f74f-0000-4000-8000-000000000009'

function def(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'def-talim',
    departmentId: 'dept',
    appliesTo: 'person',
    key: 'talim',
    label: { 'uz-Latn': 'Taʼlim', 'uz-Cyrl': 'Таʼлим', ru: 'Образование', en: 'Education' },
    description: null,
    type: 'text',
    options: [],
    required: true,
    defaultValue: null,
    showInTable: true,
    showOnCardTile: false,
    selfEditable: true,
    visibleTo: 'everyone',
    order: 0,
    reminderDays: 3,
    archivedAt: null,
    progress: null,
    ...over,
  }
}

/** The exact wire shape the real endpoint returns -- `subjectId` is the membership, `subjectUserId`
 * is the person. Getting these two the wrong way round is the whole bug. */
function value(over: Partial<Record<string, unknown>> = {}) {
  return {
    defId: 'def-talim',
    key: 'talim',
    subjectType: 'person',
    subjectId: PERSON_MEMBERSHIP_ID,
    subjectUserId: PERSON_USER_ID,
    value: 'magistr',
    updatedByUserId: PERSON_USER_ID,
    updatedAt: '2026-09-01T08:00:00.000Z',
    ...over,
  }
}

let requestedUrls: string[] = []

function mockApi(body: { defs?: unknown[]; values?: unknown[] }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      requestedUrls.push(url)
      const payload = url.includes('/fields/defs')
        ? { defs: body.defs ?? [], caps: { card: 20, person: 10 }, canManage: true }
        : { values: body.values ?? [] }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function renderTab(props: Partial<React.ComponentProps<typeof PersonFieldsTab>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PersonFieldsTab userId={PERSON_USER_ID} canManage canEditOwn={false} {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  requestedUrls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SEV1 #2 -- the Maydonlar tab agrees with the people table', () => {
  it('renders a stored answer instead of "Toʻldirilmagan"', async () => {
    mockApi({ defs: [def()], values: [value()] })
    renderTab()
    expect(await screen.findByText('magistr')).toBeInTheDocument()
    expect(screen.queryByText('Toʻldirilmagan')).not.toBeInTheDocument()
  })

  it('never raises the required-missing banner for a person who answered', async () => {
    mockApi({ defs: [def()], values: [value()] })
    renderTab()
    await screen.findByText('magistr')
    expect(screen.queryByText(/majburiy maydon toʻldirilmagan/)).not.toBeInTheDocument()
  })

  it('asks the endpoint by userIds, so the server can resolve the membership itself', async () => {
    mockApi({ defs: [def()], values: [value()] })
    renderTab()
    await screen.findByText('magistr')
    const valuesCall = requestedUrls.find((u) => u.includes('/fields/values'))
    expect(valuesCall).toBeDefined()
    expect(valuesCall).toContain('subjectType=person')
    expect(valuesCall).toContain(`userIds=${PERSON_USER_ID}`)
    // `appliesTo` is not a parameter this endpoint has; passing it was half of the bug.
    expect(valuesCall).not.toContain('appliesTo=')
  })

  it('still raises the banner when a required field is genuinely empty', async () => {
    mockApi({ defs: [def()], values: [] })
    renderTab()
    expect(await screen.findByText('Toʻldirilmagan')).toBeInTheDocument()
    expect(screen.getByText(/majburiy maydon toʻldirilmagan/)).toBeInTheDocument()
  })

  it('ignores an answer that belongs to somebody else', async () => {
    mockApi({
      defs: [def()],
      values: [value({ subjectUserId: COLLEAGUE_USER_ID, value: 'bakalavr' })],
    })
    renderTab()
    expect(await screen.findByText('Toʻldirilmagan')).toBeInTheDocument()
    expect(screen.queryByText('bakalavr')).not.toBeInTheDocument()
  })

  it('does not flash the alarm while the answers are still loading', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/fields/defs')) {
          return new Response(
            JSON.stringify({ defs: [def()], caps: { card: 20, person: 10 }, canManage: true }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        }
        await gate
        return new Response(JSON.stringify({ values: [value()] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    renderTab()
    await screen.findByText('Taʼlim')
    expect(screen.queryByText(/majburiy maydon toʻldirilmagan/)).not.toBeInTheDocument()
    release()
    await waitFor(() => expect(screen.getByText('magistr')).toBeInTheDocument())
  })
})
