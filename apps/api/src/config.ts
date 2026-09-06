// Config is parsed once, with Zod, at startup (design.md §7.4, H7.3, H17.1). In production the process
// refuses to start if a value still equals its checked-in `.env.example` local-dev default -- so a
// deploy can never go live silently trusting a placeholder secret or a placeholder database password.
import { z } from 'zod'

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DEVON_PUBLIC_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_COOKIE_NAME: z.string().min(1).default('devon_sid'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(720),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(30),
  CSRF_SECRET: z.string().min(1),
  // Loopback-gating for /api/v1/setup/{token} (design.md §1.7, AC-12). '1' only for a container/VM
  // setup where the operator genuinely cannot reach the API from 127.0.0.1 -- never the default.
  DEVON_SETUP_REMOTE: z.coerce.boolean().default(false),
  LOG_LEVEL: z.string().default('info'),
})

export type Config = z.infer<typeof configSchema>

/** The exact placeholder values `.env.example` ships (design.md §7.4). A production boot matching any
 * of these is refused outright -- these are example values pinned for local dev only, never valid in
 * a real deployment. */
const LOCAL_DEV_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  CSRF_SECRET: 'devon_local_dev_csrf_secret_change_in_production', // example value, changeme in production
  DATABASE_URL: 'postgres://devon_app:devon_local_dev_app@127.0.0.1:55432/devon', // example, local dev only
})

export class ProductionConfigGuardError extends Error {
  constructor(public readonly offendingKeys: readonly string[]) {
    super(
      `Refusing to start with NODE_ENV=production while these env vars still hold their local-dev ` +
        `example value from .env.example: ${offendingKeys.join(', ')}. Set real values (H17.1).`,
    )
    this.name = 'ProductionConfigGuardError'
  }
}

/** Pure function: parses `env`, and -- when `NODE_ENV === 'production'` -- throws
 * `ProductionConfigGuardError` if any guarded var still equals its example placeholder. Never reads
 * `process.env` itself, so this is unit-testable without mutating the real process environment. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = configSchema.parse(env)
  if (parsed.NODE_ENV === 'production') {
    const offending = Object.entries(LOCAL_DEV_DEFAULTS)
      .filter(([key, value]) => env[key] === value)
      .map(([key]) => key)
    if (offending.length > 0) throw new ProductionConfigGuardError(offending)
  }
  return parsed
}
