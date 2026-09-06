import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { subscribeLocale, getLocale } from '@devon/i18n'
import { bootLocale } from './lib/locale-boot.js'
import { bootTheme } from './lib/theme.js'
import { App } from './app.js'
import './styles.css'

// Both run synchronously, before the first render, so there is no flash of the wrong language or
// theme (design.md §4.3: "read on boot before first paint").
bootLocale()
bootTheme()

// `<html lang>`/`dir` (design.md §4.3: "the document lang and dir update" on every switch, not just
// boot). Every one of the four locales is left-to-right; `dir` is still set explicitly rather than
// assumed, so a future RTL locale is a one-line change here, not a rediscovery.
function applyDocumentLocale(): void {
  document.documentElement.lang = getLocale()
  document.documentElement.dir = 'ltr'
}
applyDocumentLocale()
subscribeLocale(applyDocumentLocale)

const container = document.getElementById('root')
if (!container) throw new Error('#root element not found')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
