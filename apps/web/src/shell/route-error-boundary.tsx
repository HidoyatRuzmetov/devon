// Blitz finding (agentic/ledger/blitz): navigating to a route whose feature chunk fails to load (a
// stale/never-cached dynamic import -- the same failure mode a real deploy produces when a client
// holds an old index.html referencing chunk hashes the server no longer serves) crashed the entire
// React tree with no error boundary anywhere in the app: the sidebar, top bar and everything else
// vanished, leaving a blank page with no way back short of a manual URL edit. `RouteErrorBoundary`
// is mounted around each route's content (inside `AppShell`/`AuthShell`, so the chrome survives) and
// renders the same `StateView kind="error"` every query-level error already uses (state.error.* --
// spec.md §8.3), with a primary action that reloads the page. A reload is deliberate, not a
// `setState` reset: a failed chunk import means the running bundle is stale, so only a fresh document
// load can recover it.
import * as React from 'react'
import { StateView } from '@devon/ui'

interface RouteErrorBoundaryProps {
  children: React.ReactNode
}

interface RouteErrorBoundaryState {
  error: Error | null
}

export class RouteErrorBoundary extends React.Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  override state: RouteErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Last-resort diagnostic; no client error-reporting sink exists in this app (ADR scope), so the
    // browser console is the only place this can surface. `no-console` is not an enabled lint rule
    // here (see other `console.*` call sites across `apps/web/src`), so no disable comment is needed.
    console.error('[RouteErrorBoundary]', error, info.componentStack)
  }

  override componentDidUpdate(prevProps: RouteErrorBoundaryProps): void {
    // A route change while showing the fallback (e.g. the user clicked a sidebar link instead of
    // "Try again") should retry rendering the new route rather than keep showing the old error.
    if (this.state.error && prevProps.children !== this.props.children) {
      this.setState({ error: null })
    }
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <StateView
          kind="error"
          titleKey="state.error.title"
          bodyKey="state.error.body"
          action={{ labelKey: 'state.error.action', onAction: () => window.location.reload() }}
        />
      )
    }
    return this.props.children
  }
}
