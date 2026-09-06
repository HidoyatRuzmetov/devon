// Shared rendering for `?__state=` forcing (design.md §8, AC-7's evidence: "one screenshot per route
// per forced state"). Every route in `e2e/routes.json` (EPIC-000.9) must show a designed block with
// exactly one primary action when a kind is forced -- this is the one place that mapping is defined,
// so all five routes stay identical for the states that do not naturally occur on them (e.g.
// `forbidden` on `/`, `empty` on `/login`).
import { StateView, type StateKind } from '@devon/ui'
import { navigate } from '../lib/router.js'

export function ForcedStateBlock({ kind }: { kind: StateKind }) {
  switch (kind) {
    case 'empty':
      return (
        <StateView
          kind="empty"
          titleKey="home.empty.member.title"
          bodyKey="home.empty.member.body"
          action={{ labelKey: 'home.empty.action', onAction: () => navigate('/') }}
        />
      )
    case 'loading':
      // AC-7 reads "each state ... offers exactly one next action" as applying to all five forced
      // kinds, loading included, even though an organic (unforced) loading state has none yet
      // (design.md §8.2 shows a bare skeleton) -- `<StateView>` only renders `action` when given one.
      return (
        <StateView
          kind="loading"
          titleKey="state.loading"
          action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
        />
      )
    case 'error':
      return (
        <StateView
          kind="error"
          titleKey="state.error.title"
          bodyKey="state.error.body"
          requestId="e2e-forced"
          action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
        />
      )
    case 'forbidden':
      return (
        <StateView
          kind="forbidden"
          titleKey="state.denied.title"
          bodyKey="state.denied.body"
          action={{ labelKey: 'state.denied.action', onAction: () => navigate('/') }}
        />
      )
    case 'offline':
      return (
        <StateView
          kind="offline"
          titleKey="state.offline.banner"
          bodyKey="state.offline.body"
          action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
        />
      )
    default:
      return null
  }
}
