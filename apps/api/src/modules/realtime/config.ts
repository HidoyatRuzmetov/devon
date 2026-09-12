// Realtime configuration (v1.1 SPEC §10, EPIC-018).
//
// Parsed with Zod, once, at first use -- the same posture as `apps/api/src/config.ts`, kept in this
// module rather than folded into that file because `config.ts` is a shared file every other v1.1
// package also wants to touch (MODULE-GUIDE.md: "a module ships by adding files"). The merge that
// brings these six keys into the central schema is one mechanical move and is listed in this
// package's handoff notes.
//
// The whole feature is OPTIONAL by construction. Centrifugo sits behind a Compose profile
// (`infra/docker-compose.yml`), so a developer box, a CI run and a ministry deployment that has not
// started it are all normal: `realtimeConfig().enabled` is false, `GET /realtime/config` says so, and
// the web client keeps its polling fallback with an honest "jonli yangilanish yoqilmagan" line.
// Nothing in the product ever *requires* a WebSocket to work.
import { z } from 'zod'

const schema = z.object({
  /** Browser-facing WebSocket URL. Same-origin in production (Caddy proxies `/connection/*` to
   * Centrifugo); `ws://127.0.0.1:8000/connection/websocket` on a developer box. */
  CENTRIFUGO_WS_URL: z.string().trim().default(''),
  /** Server-facing HTTP API base, e.g. `http://127.0.0.1:8000`. Never reached from the browser. */
  CENTRIFUGO_API_URL: z.string().trim().default(''),
  /** `http_api.key` -- authenticates this API to Centrifugo's own HTTP API. */
  CENTRIFUGO_API_KEY: z.string().trim().default(''),
  /** `client.token.hmac_secret_key` -- signs both connection and subscription tokens. */
  CENTRIFUGO_TOKEN_HMAC_SECRET_KEY: z.string().trim().default(''),
  /** Connection-token lifetime. Short on purpose: the client refreshes through `/realtime/token`,
   * which re-runs `can()`, so losing a membership takes effect within one token life. */
  CENTRIFUGO_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(600),
  /** Every outbound call to Centrifugo is bounded (H8.1 "every outbound call has a timeout"). */
  CENTRIFUGO_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(3000),
})

export type RealtimeEnv = z.infer<typeof schema>

export type RealtimeConfig = RealtimeEnv & {
  /** True only when every value a working connection needs is present. */
  enabled: boolean
}

let cached: RealtimeConfig | null = null

function build(env: NodeJS.ProcessEnv): RealtimeConfig {
  const parsed = schema.safeParse({
    CENTRIFUGO_WS_URL: env['CENTRIFUGO_WS_URL'],
    CENTRIFUGO_API_URL: env['CENTRIFUGO_API_URL'],
    CENTRIFUGO_API_KEY: env['CENTRIFUGO_API_KEY'],
    CENTRIFUGO_TOKEN_HMAC_SECRET_KEY: env['CENTRIFUGO_TOKEN_HMAC_SECRET_KEY'],
    CENTRIFUGO_TOKEN_TTL_SECONDS: env['CENTRIFUGO_TOKEN_TTL_SECONDS'],
    CENTRIFUGO_TIMEOUT_MS: env['CENTRIFUGO_TIMEOUT_MS'],
  })
  // A malformed value is not a reason to take the API down -- realtime is an enhancement. It is a
  // reason to stay off, loudly: the health payload and `/realtime/config` both report `enabled:false`
  // and the boot log line below says which key was wrong.
  const value: RealtimeEnv = parsed.success
    ? parsed.data
    : {
        CENTRIFUGO_WS_URL: '',
        CENTRIFUGO_API_URL: '',
        CENTRIFUGO_API_KEY: '',
        CENTRIFUGO_TOKEN_HMAC_SECRET_KEY: '',
        CENTRIFUGO_TOKEN_TTL_SECONDS: 600,
        CENTRIFUGO_TIMEOUT_MS: 3000,
      }
  return {
    ...value,
    enabled:
      value.CENTRIFUGO_WS_URL.length > 0 && value.CENTRIFUGO_TOKEN_HMAC_SECRET_KEY.length > 0,
  }
}

export function realtimeConfig(): RealtimeConfig {
  cached ??= build(process.env)
  return cached
}

/** True when this process can also *publish* (the HTTP API half, needed for server-side fan-out and
 * for presence lookups). A deployment may legitimately have the browser half configured and the
 * server half not yet -- in that case the channels exist but carry no server publications, which is
 * a degraded state worth naming rather than a crash. */
export function canPublish(cfg: RealtimeConfig = realtimeConfig()): boolean {
  return cfg.enabled && cfg.CENTRIFUGO_API_URL.length > 0 && cfg.CENTRIFUGO_API_KEY.length > 0
}

/** Test-only: forget the memoised parse so a test can set env vars and re-read them. */
export function __resetRealtimeConfigForTests(): void {
  cached = null
}
