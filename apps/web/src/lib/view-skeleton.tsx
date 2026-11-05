import { useT } from '@devon/i18n'
import { Skeleton } from '@devon/ui'
import type { ReactNode } from 'react'

const times = (count: number, render: (index: number) => ReactNode) =>
  Array.from({ length: count }, (_, index) => <div key={index}>{render(index)}</div>)
const line = (width = 'w-2/3') => <Skeleton className={`h-3 ${width}`} />
function Rows({
  count = 5,
  avatar = false,
  controls = false,
}: {
  count?: number
  avatar?: boolean
  controls?: boolean
}) {
  return (
    <div className="divide-y divide-border">
      {times(count, (i) => (
        <div className="flex items-center gap-3 py-3">
          {avatar ? (
            <Skeleton className="size-10 shrink-0 rounded-full" />
          ) : (
            <Skeleton className="size-4 shrink-0 rounded" />
          )}
          <div className="flex-1 space-y-2">
            {line(i % 2 ? 'w-1/2' : 'w-3/4')}
            {line('w-1/3')}
          </div>
          {controls ? <Skeleton className="h-8 w-20" /> : null}
        </div>
      ))}
    </div>
  )
}
function Fields({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {times(count, () => (
        <div className="space-y-2">
          {line('w-28')}
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      ))}
    </div>
  )
}
function Tiles({ count = 6, people = false }: { count?: number; people?: boolean }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4">
      {times(count, () => (
        <div className="space-y-4 rounded-xl border border-border p-4">
          {people ? (
            <Skeleton className="mx-auto size-20 rounded-full" />
          ) : (
            <Skeleton className="h-4 w-4/5" />
          )}
          {line(people ? 'mx-auto w-2/3' : 'w-1/2')}
          {line(people ? 'mx-auto w-1/2' : 'w-3/4')}
          {people ? <Skeleton className="mx-auto h-5 w-20 rounded-full" /> : <Rows count={2} />}
        </div>
      ))}
    </div>
  )
}
function Table({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div
        className="grid gap-4 bg-muted/40 p-3"
        style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
      >
        {times(columns, () => line('w-3/4'))}
      </div>
      {times(rows, () => (
        <div
          className="grid gap-4 border-t border-border p-4"
          style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
        >
          {times(columns, () => line('w-4/5'))}
        </div>
      ))}
    </div>
  )
}
function Calendar({ toolbar = true }: { toolbar?: boolean }) {
  return (
    <div className="space-y-4">
      {toolbar ? (
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-28" />
        </div>
      ) : null}
      <div className="grid grid-cols-7 gap-4 rounded-t-lg border border-border bg-muted/40 p-3">
        {times(7, () => line('w-12'))}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-border">
        {times(35, (i) => (
          <div className="h-24 space-y-3 border-b border-r border-border p-2 sm:h-28">
            {line('w-5')}
            {i % 3 === 0 ? <Skeleton className="h-5 w-full" /> : null}
            {i % 7 === 0 ? <Skeleton className="h-5 w-4/5" /> : null}
          </div>
        ))}
      </div>
    </div>
  )
}
function Dashboard({ head = false }: { head?: boolean }) {
  return (
    <div className="space-y-3">
      <div
        className={`grid gap-3 ${head ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 lg:grid-cols-3'}`}
      >
        {times(head ? 4 : 3, () => (
          <div className="flex h-28 flex-col justify-between rounded-lg border border-border p-3.5">
            {line('w-32')}
            <Skeleton className="h-7 w-16" />
            {line('w-3/4')}
          </div>
        ))}
      </div>
      <div className="grid min-h-[calc(100dvh-300px)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="rounded-lg border border-border p-4">
          <div className="flex gap-3 border-b border-border pb-4">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-7 w-20" />
          </div>
          <Rows avatar count={7} />
        </div>
        <div className="grid grid-rows-[1.4fr_1fr] gap-3">
          <div className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap justify-between gap-3 border-b border-border pb-3">
              {line('w-28')}
              <Skeleton className="h-8 w-64" />
            </div>
            <Rows controls count={4} />
          </div>
          <div className="rounded-lg border border-border p-3">
            {line('w-40')}
            <Rows count={3} />
          </div>
        </div>
      </div>
    </div>
  )
}
function PersonnelSkeleton() {
  return (
    <>
      <div className="flex h-16 items-center justify-between rounded-xl border border-border p-3">
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-2">
          {times(3, () => (
            <Skeleton className="h-8 w-20" />
          ))}
        </div>
      </div>
      {line('w-64')}
      <div className="space-y-7 rounded-2xl bg-muted/40 p-4 sm:p-7">
        <div className="mx-auto min-h-280 max-w-198.5 border border-border bg-card px-6 py-14 sm:pl-19 sm:pr-10">
          <div className="mb-6 flex gap-8">
            <div className="flex-1 space-y-5 pt-2">
              <Skeleton className="mx-auto h-5 w-36" />
              <Skeleton className="h-7 w-full" />
              <div className="space-y-2 pt-6">
                {line('w-4/5')}
                {line('w-full')}
              </div>
            </div>
            <Skeleton className="h-38 w-28 shrink-0" />
          </div>
          <Fields count={6} />
          <div className="my-5">
            <Fields count={1} />
          </div>
          <Fields count={2} />
          <div className="my-5 space-y-4">
            {times(3, () => (
              <div className="space-y-2">
                {line('w-3/4')}
                <Skeleton className="h-7 w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="mx-auto mb-5 h-5 w-48" />
          <Rows count={3} />
        </div>
        <div className="mx-auto min-h-280 max-w-198.5 border border-border bg-card px-6 py-14 sm:pl-19 sm:pr-10">
          <Skeleton className="mx-auto mb-3 h-5 w-72" />
          <Skeleton className="mx-auto mb-7 h-5 w-32" />
          <Table columns={5} rows={5} />
        </div>
      </div>
    </>
  )
}
function Stats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {times(count, () => (
        <div className="space-y-3 rounded-lg border border-border p-4">
          {line('w-2/3')}
          <Skeleton className="h-8 w-14" />
          {line('w-1/2')}
        </div>
      ))}
    </div>
  )
}

/** Each name describes the actual view being awaited. Shared pieces preserve real row/field sizes. */
const layouts = {
  headHome: <Dashboard head />,
  personnel: <PersonnelSkeleton />,
  projects: (
    <div className="grid gap-3 lg:grid-cols-2">
      {times(4, () => (
        <div className="space-y-4 rounded-lg border border-border p-5">
          <div className="flex justify-between">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-5 w-16" />
          </div>
          {line('w-4/5')}
          {line('w-2/3')}
          <Skeleton className="h-2 w-full rounded-full" />
          <Rows count={1} />
          <div className="flex justify-between">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  ),
  eventDetail: (
    <div className="space-y-5">
      <Skeleton className="h-28 w-full rounded-md sm:h-36" />
      <div className="flex flex-wrap justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          {line('w-40')}
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="flex gap-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-36" />
      </div>
      <div className="space-y-2">
        {line('w-full')}
        {line('w-3/4')}
      </div>
      <div className="flex flex-wrap gap-1">
        {times(7, () => (
          <Skeleton className="h-10 w-16" />
        ))}
      </div>
      <div className="space-y-4 rounded-md border border-border p-4">
        {line('w-40')}
        <div className="flex gap-2">
          {times(3, () => (
            <Skeleton className="h-9 w-20 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-9 w-24" />
      </div>
      <Rows avatar count={3} />
    </div>
  ),
  eventAttendees: <Rows avatar count={3} />,
  eventComments: (
    <div className="space-y-3">
      {times(2, () => (
        <div className="flex gap-3 rounded-lg border border-border p-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-3">
            <div className="flex justify-between">
              {line('w-28')}
              {line('w-16')}
            </div>
            {line('w-full')}
            {line('w-3/4')}
          </div>
        </div>
      ))}
    </div>
  ),
  eventItems: (
    <div className="space-y-3">
      {times(4, () => (
        <div className="flex gap-4 rounded-lg border border-border p-4">
          <Skeleton className="size-5" />
          <div className="flex-1 space-y-3">
            {line('w-3/4')}
            {line('w-1/2')}
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  ),
  projectTasks: (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-24" />
      </div>
      <Rows controls count={5} />
    </div>
  ),
  personalCalendar: <Calendar toolbar={false} />,
  workCalendar: <Calendar toolbar={false} />,
  eventCalendar: <Calendar />,
  progress: (
    <>
      <div className="flex justify-end gap-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-48" />
      </div>
      <Table columns={7} rows={10} />
    </>
  ),
  login: (
    <div className="mx-auto max-w-96 space-y-6">
      <Skeleton className="h-9 w-48" />
      <Fields count={2} />
      <Skeleton className="h-11 w-full" />
      {line('w-3/4')}
    </div>
  ),
  signup: (
    <div className="mx-auto max-w-lg space-y-6">
      <Skeleton className="h-9 w-56" />
      <Fields count={6} />
      <Skeleton className="h-11 w-full" />
    </div>
  ),
  setup: (
    <div className="mx-auto max-w-lg space-y-6">
      <Skeleton className="h-9 w-56" />
      <Fields count={5} />
      <Skeleton className="h-11 w-40" />
    </div>
  ),
  faq: (
    <div className="mx-auto max-w-4xl space-y-5">
      <Skeleton className="h-11 w-full" />
      {times(6, () => (
        <div className="flex items-center justify-between rounded-lg border border-border p-5">
          {line('w-3/4')}
          <Skeleton className="size-5" />
        </div>
      ))}
    </div>
  ),
  accountDelete: (
    <div className="space-y-4 rounded-lg border border-border p-5">
      <Skeleton className="h-6 w-56" />
      {line('w-full')}
      {line('w-2/3')}
      <Skeleton className="h-10 w-40" />
    </div>
  ),
  departmentRequest: (
    <div className="mx-auto max-w-2xl space-y-6">
      <Fields count={3} />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-10 w-40" />
      <Rows count={2} />
    </div>
  ),
  deletedTasks: (
    <div className="space-y-3">
      <Skeleton className="h-10 w-72" />
      <Rows controls count={7} />
    </div>
  ),
  notFound: (
    <div className="mx-auto max-w-sm space-y-5 py-12">
      <Skeleton className="mx-auto size-12" />
      <Skeleton className="mx-auto h-7 w-56" />
      <Skeleton className="mx-auto h-10 w-36" />
    </div>
  ),
  checkin: (
    <>
      <div className="flex flex-wrap justify-between gap-3">
        <Skeleton className="h-10 w-48" />
        <div className="flex gap-3">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-56" />
        </div>
      </div>
      <div className="flex items-center gap-4 py-3">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex-1 space-y-3">
          {line('w-56')}
          {line('w-40')}
        </div>
        <Skeleton className="h-16 w-28" />
        <Skeleton className="h-9 w-20" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-3">
        {times(4, () => (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-6" />
              <Skeleton className="h-5 flex-1" />
              <Skeleton className="h-6 w-20" />
            </div>
            <Rows count={3} controls />
          </div>
        ))}
      </div>
    </>
  ),
  people: (
    <>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-10 w-40" />
      </div>
      {times(2, () => (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9" />
            {line('w-48')}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {times(3, () => (
              <div className="space-y-4 rounded-lg border border-border border-l-4 p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-12 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    {line('w-3/4')}
                    {line('w-1/2')}
                  </div>
                </div>
                <div className="space-y-2.5 border-t border-border pt-3">
                  {times(4, (index) => (
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="size-4 shrink-0" />
                      {line(index === 0 ? 'w-24' : index === 2 ? 'w-1/2' : 'w-3/4')}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.35fr)] items-center gap-2 border-t border-border pt-2">
                  <Skeleton className="size-3.5 shrink-0" />
                  {times(2, () => (
                    <div className="flex min-h-8 flex-col justify-center gap-1.5">
                      {line('w-4/5')}
                      <Skeleton className="h-2 w-3/5" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  ),
  structure: (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      {times(3, (index) => (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-3 bg-muted/40 p-3">
            <Skeleton className="size-4" />
            <Skeleton className="size-8" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-7 w-24" />
          </div>
          <div className="space-y-3 border-t border-border px-6 py-4">
            {times(index === 1 ? 2 : 3, () => (
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  {line('w-44')}
                  {line('w-28')}
                </div>
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
  structureChart: (
    <>
      <Skeleton className="mx-auto h-24 w-64 rounded-xl" />
      <div className="mx-auto h-8 w-px bg-border" />
      <Tiles count={3} />
      <div className="grid gap-6 md:grid-cols-3">
        {times(3, () => (
          <Rows avatar count={3} />
        ))}
      </div>
    </>
  ),
  personWork: (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-[repeat(4,minmax(16rem,1fr))] gap-3 overflow-hidden">
        {times(4, (column) => (
          <div className="min-h-[calc(100dvh-270px)] rounded-xl border border-border bg-muted/40 p-2">
            <div className="mb-3 flex items-center gap-2 p-2">
              <Skeleton className="size-4" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto size-5 rounded" />
            </div>
            <div className="space-y-2.5">
              {times(column === 3 ? 2 : 3, (row) => (
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="space-y-3 p-3">
                    {row % 2 === 0 ? line('w-24') : null}
                    {line('w-5/6')}
                    {line('w-2/3')}
                    <Skeleton className="h-4 w-16" />
                  </div>
                  <div className="border-t border-border p-3">
                    <Skeleton className={column === 3 ? 'ml-auto h-5 w-20' : 'h-4 w-28'} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
  events: (
    <>
      <div className="flex justify-between">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-10 w-32" />
      </div>
      <Tiles count={4} />
    </>
  ),
  calendar: <Calendar />,
  tasks: (
    <>
      <Skeleton className="h-11 w-full" />
      <Rows count={7} controls />
    </>
  ),
  pomodoro: (
    <div className="mx-auto max-w-sm space-y-6 py-4">
      <div className="flex justify-center gap-2">
        {times(3, () => (
          <Skeleton className="h-8 w-24" />
        ))}
      </div>
      <Skeleton className="mx-auto size-52 rounded-full" />
      <div className="flex justify-center gap-3">
        <Skeleton className="h-11 w-32" />
        <Skeleton className="h-11 w-11" />
      </div>
      <Fields count={2} />
    </div>
  ),
  assistant: (
    <div className="flex min-h-96 gap-5">
      <div className="hidden w-60 space-y-5 border-r border-border pr-4 md:block">
        <Skeleton className="h-10 w-full" />
        <Rows count={6} />
      </div>
      <div className="flex flex-1 flex-col justify-between gap-16">
        <div className="mx-auto mt-10 w-full max-w-lg space-y-4">
          <Skeleton className="mx-auto size-12 rounded-2xl" />
          {line('mx-auto w-2/3')}
          <Tiles count={2} />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  ),
  resume: (
    <>
      <Fields count={3} />
      <Skeleton className="h-24 w-full" />
      <div className="space-y-4 rounded-xl border border-border p-4">
        {line('w-40')}
        <Fields count={4} />
      </div>
      <Fields count={2} />
    </>
  ),
  profile: <Fields count={5} />,
  photo: (
    <div className="flex items-center gap-6">
      <Skeleton className="size-28 rounded-full" />
      <div className="space-y-3">
        <Skeleton className="h-10 w-40" />
        {line('w-48')}
      </div>
    </div>
  ),
  sessions: <Rows avatar controls count={3} />,
  security: (
    <>
      <Skeleton className="h-12 w-full" />
      <Fields count={2} />
      <Skeleton className="h-10 w-36" />
    </>
  ),
  settings: (
    <div className="space-y-8">
      <Fields count={4} />
      <Fields count={2} />
      <Skeleton className="h-10 w-32" />
    </div>
  ),
  appearance: (
    <>
      <Tiles count={3} />
      <Fields count={2} />
    </>
  ),
  aiSettings: (
    <>
      <Fields count={4} />
      <Table columns={3} rows={4} />
    </>
  ),
  usage: (
    <>
      <Stats count={3} />
      <Skeleton className="h-44 w-full" />
      <Table columns={4} rows={4} />
    </>
  ),
  providers: (
    <>
      <Fields count={3} />
      <Rows controls count={3} />
    </>
  ),
  versions: <Rows count={4} />,
  version: (
    <>
      <Skeleton className="h-5 w-2/3" />
      {times(8, (i) => line(i % 3 ? 'w-full' : 'w-2/3'))}
    </>
  ),
  pages: (
    <div className="flex gap-6">
      <div className="w-60 shrink-0 space-y-4 border-r border-border pr-4">
        <Skeleton className="h-10 w-full" />
        <Rows count={6} />
      </div>
      <div className="hidden flex-1 space-y-5 p-4 sm:block">
        <Skeleton className="h-9 w-2/3" />
        {times(8, () => line('w-full'))}
      </div>
    </div>
  ),
  page: (
    <div className="mx-auto max-w-3xl space-y-5">
      <Skeleton className="h-10 w-3/4" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-20" />
      </div>
      {times(3, () => (
        <div className="space-y-3 py-3">
          {line('w-full')}
          {line('w-full')}
          {line('w-3/4')}
        </div>
      ))}
    </div>
  ),
  templates: <Tiles count={6} />,
  discussion: (
    <>
      <Rows avatar count={3} />
      <Skeleton className="h-24 w-full rounded-lg" />
    </>
  ),
  overview: (
    <>
      <Stats />
      <div className="grid gap-6 lg:grid-cols-2">
        <Rows avatar count={5} />
        <Rows controls count={5} />
      </div>
    </>
  ),
  memberHome: <Dashboard />,
  health: (
    <>
      <Stats />
      <Table columns={4} rows={6} />
    </>
  ),
  analytics: (
    <>
      <Stats />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-60 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
      <Table columns={5} rows={4} />
    </>
  ),
  audit: (
    <>
      <Fields count={3} />
      <Table columns={6} rows={9} />
    </>
  ),
  accounts: (
    <>
      <Skeleton className="h-10 w-72" />
      <Table columns={5} rows={8} />
    </>
  ),
  approvals: <Rows avatar controls count={5} />,
  files: <Rows controls count={4} />,
  departments: (
    <>
      <Skeleton className="h-10 w-72" />
      <Tiles count={4} />
    </>
  ),
  department: (
    <>
      <Skeleton className="h-9 w-64" />
      <Fields count={4} />
      <Rows avatar controls count={4} />
    </>
  ),
  invite: (
    <>
      <Skeleton className="h-11 w-full" />
      <div className="flex gap-3">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-28" />
      </div>
    </>
  ),
  join: (
    <div className="mx-auto max-w-lg space-y-5">
      <Skeleton className="h-10 w-full" />
      <Rows count={3} controls />
    </div>
  ),
  members: <Rows avatar controls count={6} />,
  registration: (
    <>
      <Rows controls count={2} />
      <Fields count={2} />
    </>
  ),
  maintenance: (
    <>
      <Rows controls count={1} />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-10 w-28" />
    </>
  ),
  sentinel: (
    <>
      <Stats count={2} />
      <Rows count={3} controls />
    </>
  ),
  wipe: (
    <>
      <Skeleton className="h-20 w-full" />
      <Fields count={1} />
      <Skeleton className="h-10 w-40" />
    </>
  ),
  inbox: (
    <>
      <div className="flex gap-3">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-32" />
      </div>
      <Rows avatar controls count={8} />
    </>
  ),
  preferences: <Table columns={4} rows={7} />,
  quietHours: (
    <>
      <Rows controls count={1} />
      <Fields count={2} />
    </>
  ),
  telegram: (
    <div className="flex flex-wrap items-center gap-6">
      <Skeleton className="size-40 rounded-xl" />
      <div className="min-w-48 flex-1 space-y-4">
        {line('w-3/4')}
        <Skeleton className="h-10 w-48" />
        {line('w-full')}
      </div>
    </div>
  ),
  telegramGroups: <Rows controls count={3} />,
  feeds: (
    <>
      <Rows count={2} controls />
      <Skeleton className="h-11 w-full" />
    </>
  ),
  push: (
    <>
      <Rows controls count={1} />
      {line('w-3/4')}
      <Skeleton className="h-10 w-40" />
    </>
  ),
  agenda: (
    <>
      <Skeleton className="h-5 w-28" />
      <Rows count={3} />
      <Skeleton className="h-5 w-32" />
      <Rows count={2} />
    </>
  ),
  board: (
    <div className="flex gap-4 overflow-hidden">
      {times(4, () => (
        <div className="w-70 shrink-0 space-y-4 rounded-xl border border-border p-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            {line('w-32')}
          </div>
          {times(3, () => (
            <div className="space-y-4 rounded-lg border border-border p-3">
              {line('w-full')}
              {line('w-2/3')}
              <div className="flex justify-between">
                <Skeleton className="h-5 w-16" />
                <Skeleton className="size-6 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
  card: (
    <>
      <Skeleton className="h-9 w-3/4" />
      <div className="flex gap-3">
        {times(4, () => (
          <Skeleton className="h-8 w-20" />
        ))}
      </div>
      <Fields count={4} />
      <Skeleton className="h-20 w-full" />
      <Rows count={4} controls />
      <Rows avatar count={2} />
    </>
  ),
  project: (
    <>
      <Skeleton className="h-9 w-2/3" />
      <Stats count={3} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <Skeleton className="h-20 w-full" />
          <Rows count={4} />
        </div>
        <Rows avatar count={4} />
      </div>
    </>
  ),
  table: <Table columns={5} rows={8} />,
  focus: (
    <div className="space-y-4">
      <div className="flex justify-between">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-7 w-20" />
      </div>
      <Rows count={4} controls />
    </div>
  ),
  mine: (
    <div className="space-y-5">
      <div className="flex gap-3">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <Rows count={6} controls />
    </div>
  ),
  dependencies: (
    <div className="space-y-4">
      <Skeleton className="h-9 w-full" />
      <Rows count={2} controls />
    </div>
  ),
  timeLogs: (
    <div className="space-y-4">
      <Fields count={2} />
      <Rows count={3} controls />
    </div>
  ),
  reminders: (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full" />
      <Rows count={2} controls />
    </div>
  ),
  rsvp: (
    <div className="space-y-4">
      <div className="flex gap-2">
        {times(3, () => (
          <Skeleton className="h-10 w-24" />
        ))}
      </div>
      <Rows avatar count={3} />
    </div>
  ),
  timeline: (
    <div className="flex overflow-hidden rounded-lg border border-border">
      <div className="w-56 shrink-0 border-r border-border p-3">
        <Rows count={7} />
      </div>
      <div className="flex-1 space-y-7 p-5">
        {times(7, (i) => (
          <Skeleton
            className="h-7"
            style={{ marginLeft: `${(i % 4) * 12}%`, width: `${24 + (i % 3) * 12}%` }}
          />
        ))}
      </div>
    </div>
  ),
  feedback: (
    <>
      <Rows count={2} />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-9 w-24" />
    </>
  ),
  polls: (
    <>
      <Skeleton className="h-5 w-3/4" />
      <Rows count={3} />
      <Skeleton className="h-9 w-24" />
    </>
  ),
  carpool: (
    <>
      <Rows avatar controls count={2} />
      <Fields count={2} />
    </>
  ),
} satisfies Record<string, ReactNode>

export type LoadingView = keyof typeof layouts
export function ViewSkeleton({ view }: { view: LoadingView }) {
  const t = useT()
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t('state.loading')}
      data-loading-view={view}
      className="min-w-0 space-y-5 py-2"
    >
      <div aria-hidden="true" className="space-y-5">
        {layouts[view]}
      </div>
    </div>
  )
}
