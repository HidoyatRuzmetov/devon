/// <reference types="vite/client" />

// Declaring this as a named property (rather than leaving it to `ImportMetaEnv`'s index signature)
// does two things at once: it lets `import.meta.env.DEVON_E2E` use dot notation under this repo's
// `noPropertyAccessFromIndexSignature` (tsconfig.base.json) -- the form Vite's own static
// `import.meta.env.*` replacement during `build` reliably matches (`src/lib/forced-state.ts`) -- and
// it documents the one non-`VITE_`-prefixed env var this app reads (`src/vite.config.ts`'s
// `envPrefix: ['VITE_', 'DEVON_']`).
interface ImportMetaEnv {
  readonly DEVON_E2E?: string
}
