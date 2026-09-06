// Config is parsed once, with Zod, at startup (design.md §7.4, H7.3, H17.1). In production the process
// refuses to start if a value still equals its checked-in `.env.example` local-dev default -- so a
// deploy can never go live silently trusting a placeholder secret or a placeholder database password.
import { z } from 'zod'

/** `'true'`/`'1'` -> true, `'false'`/`'0'` -> false. (`z.coerce.boolean()` turns the string `'false'`
 * into `true`, which is the wrong default for a knob whose safe value is the truthy one.) */
const boolString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue)
    .transform((v) => v === 'true' || v === '1')

const configSchema = z
  .object({
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

    // --- storage plugin (TECH-SPEC §6 `storage`; EPIC-001 photo upload) -------------------------
    // `local`: objects are files under STORAGE_LOCAL_DIR and "presigned" URLs are the API's own signed
    // routes -- what `pnpm start` uses with no extra service. `s3`: MinIO (the `minio` Compose
    // profile) or any S3-compatible endpoint, with real presigned PUT/GET URLs (`plugins/storage.ts`).
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().min(1).default('.data/storage'),
    STORAGE_S3_ENDPOINT: z.string().url().optional(),
    // The endpoint the *browser* can reach, when it differs from what the API reaches over the Compose
    // network (a presigned URL's signature covers its host). Defaults to STORAGE_S3_ENDPOINT.
    STORAGE_S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    STORAGE_S3_REGION: z.string().min(1).default('us-east-1'),
    STORAGE_S3_BUCKET: z.string().min(1).default('devon'),
    STORAGE_S3_ACCESS_KEY: z.string().min(1).optional(),
    STORAGE_S3_SECRET_KEY: z.string().min(1).optional(),
    STORAGE_S3_FORCE_PATH_STYLE: boolString('true'), // MinIO needs path-style addressing
    STORAGE_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),
    STORAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    // --- ClamAV (TECH-SPEC §6 "ClamAV before visibility"; HARDENING 1.8) -----------------------
    // `clamd`: every upload is streamed to clamd (the `clamav` Compose profile) before it can become
    // visible; clamd unreachable => the upload fails closed. `off`: NO malware scanning -- a
    // developer-machine convenience only, logged as a warning at every boot and refused outright when
    // NODE_ENV=production (see `loadConfig` below).
    CLAMAV_MODE: z.enum(['clamd', 'off']).default('off'),
    CLAMAV_HOST: z.string().min(1).default('127.0.0.1'),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.STORAGE_DRIVER === 's3') {
      for (const key of [
        'STORAGE_S3_ENDPOINT',
        'STORAGE_S3_ACCESS_KEY',
        'STORAGE_S3_SECRET_KEY',
      ] as const) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `${key} is required when STORAGE_DRIVER=s3`,
          })
        }
      }
    }
  })

export type Config = z.infer<typeof configSchema>

/** The exact placeholder values `.env.example` / `infra/docker-compose.yml` ship (design.md §7.4). A
 * production boot matching any of these is refused outright -- these are example values pinned for
 * local dev only, never valid in a real deployment. */
const LOCAL_DEV_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  CSRF_SECRET: 'devon_local_dev_csrf_secret_change_in_production', // example value, changeme in production
  DATABASE_URL: 'postgres://devon_app:devon_local_dev_app@127.0.0.1:55432/devon', // example, local dev only
  STORAGE_S3_SECRET_KEY: 'devon_local_dev_minio_change_me', // example value: docker-compose.yml's MINIO_ROOT_PASSWORD placeholder
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

/** TECH-SPEC §6 / HARDENING 1.8: an unscanned upload path is a developer convenience, never a
 * production configuration. Thrown before the process listens, so "we forgot to turn ClamAV on"
 * cannot be discovered from an incident. */
export class UnscannedUploadsRefusedError extends Error {
  constructor() {
    super(
      'Refusing to start with NODE_ENV=production while CLAMAV_MODE=off: uploads would not be ' +
        'scanned for malware (TECH-SPEC §6, HARDENING 1.8). Start the `clamav` Compose profile ' +
        '(`docker compose -f infra/docker-compose.yml --profile clamav up -d`) and set ' +
        'CLAMAV_MODE=clamd, CLAMAV_HOST, CLAMAV_PORT.',
    )
    this.name = 'UnscannedUploadsRefusedError'
  }
}

/** Pure function: parses `env`, and -- when `NODE_ENV === 'production'` -- throws
 * `ProductionConfigGuardError` if any guarded var still equals its example placeholder, or
 * `UnscannedUploadsRefusedError` if malware scanning is switched off. Never reads `process.env`
 * itself, so this is unit-testable without mutating the real process environment. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = configSchema.parse(env)
  if (parsed.NODE_ENV === 'production') {
    const offending = Object.entries(LOCAL_DEV_DEFAULTS)
      .filter(([key, value]) => env[key] === value)
      .map(([key]) => key)
    if (offending.length > 0) throw new ProductionConfigGuardError(offending)
    if (parsed.CLAMAV_MODE === 'off') throw new UnscannedUploadsRefusedError()
  }
  return parsed
}
