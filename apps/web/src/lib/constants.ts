// The product's own name is not translatable UI copy (no more than "Sonner" or "cmdk" are) -- it is
// rendered from a constant, never a JSX text literal, so it never needs (and never triggers) the
// i18n gate's hard-coded-string heuristic. design.md §14 SEV3-2 leaves the product-name conflict
// between CLAUDE.md ("WorkPortal") and DESIGN.md/`DEVON_DEMO` ("Devon") unresolved; this item follows
// CLAUDE.md, the repository's own name, for the one visible wordmark this epic ships. The sidebar
// slot is documented as tenant-overridable (design.md §3.6) -- swapping this constant for a
// server-supplied value is a contained follow-up, not a rewrite.
export const WORDMARK = 'WorkPortal'

export const LOCALE_STORAGE_KEY = 'devon_locale'
export const THEME_STORAGE_KEY = 'devon_theme'
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'devon_sidebar_collapsed'
export const LOCALE_COOKIE_NAME = 'wp_locale'
/** `useDepartment()`'s switcher stub (`src/lib/session.ts`) -- a client-only override of `Me.
 * activeDepartmentId` until a real "switch department" endpoint exists. Per-browser, not per-account:
 * exactly the same caveat `THEME_STORAGE_KEY` already carries. */
export const ACTIVE_DEPARTMENT_STORAGE_KEY = 'devon_active_department_id'
