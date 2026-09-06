// Tiny, defensive "are we in production" check that works whether this module ends up running
// under Node (tests, CLI scripts) or bundled into the browser by Vite (which statically replaces
// `process.env.NODE_ENV`, but does not guarantee a `process` global exists at runtime otherwise).
export function isDev(): boolean {
  try {
    return typeof process !== 'undefined' && process.env?.['NODE_ENV'] !== 'production'
  } catch {
    return true
  }
}
