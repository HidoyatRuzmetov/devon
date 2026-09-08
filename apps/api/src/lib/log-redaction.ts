// Log redaction (HARDENING H1.11: "logs redact passwords, tokens, codes, contact blocks").
//
// Pino's `redact` runs inside the serializer, so a value listed here can never reach a log
// transport, a file or a shipped log line -- unlike a convention that every `log.info` call site
// must remember. The paths are deliberately over-broad: it costs nothing to censor a field that
// happened to be harmless, and the failure mode of missing one is a credential in a log file that
// is then backed up (H19.1) and read by whoever restores it.
//
// Pino's path grammar matches literally: `password` is the top-level key, `*.password` is that key
// one level down, `*.*.password` two levels down. Three levels covers every shape this codebase
// actually logs (`log.error({ err, upload }, ...)`, `log.info({ req: { body } }, ...)`).

/** Secret-bearing field names, in every casing this codebase uses. */
const SECRET_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'temporaryPassword',
  'joinPassword',
  'passwordHash',
  'password_hash',
  'token',
  'rawToken',
  'raw_token',
  'tokenHash',
  'token_hash',
  'rawCsrf',
  'csrf',
  'csrfToken',
  'csrfHash',
  'csrf_hash',
  'challengeToken',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'secret',
  'secretToken',
  'secret_token',
  'webhookSecret',
  'signingSecret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'setCookie',
  'set-cookie',
  // Short-lived codes (2FA, Telegram link, department join, group connect, reset) -- H1.15.
  'code',
  'otp',
  'totp',
  'totpSecret',
  'joinKey',
  'linkCode',
  'connectCode',
  'recoveryCodes',
  // "Contact blocks" (H1.11) -- Restricted-tier personal data (TECH-SPEC §3, I-2). Never a log line.
  'email',
  'phone',
  'phoneNumber',
  'telegram',
  'telegramUsername',
  'chatId',
  'chat_id',
  'contact',
]

/** Header names whose *values* are credentials, spelled for both the `req.headers` and the bare
 * `headers` shapes Fastify and this codebase log. */
const HEADER_PATHS = [
  'cookie',
  'authorization',
  'proxy-authorization',
  'x-csrf-token',
  'x-telegram-bot-api-secret-token',
  'set-cookie',
]

function bracket(field: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field) ? field : `["${field}"]`
}

function join(prefix: string, field: string): string {
  const key = bracket(field)
  if (!prefix) return key
  return key.startsWith('[') ? `${prefix}${key}` : `${prefix}.${key}`
}

/** Every path pino should censor. Exported (and unit-tested) so the list is inspectable rather than
 * buried in a Fastify options literal. */
export function redactPaths(): string[] {
  const paths = new Set<string>()
  // One wildcard segment only: `fast-redact` (pino's redaction engine) allows at most one `*` per
  // path, so `*.*.password` would throw at logger construction. `''` covers `{ password }` and `'*'`
  // covers `{ user: { password } }` / `{ body: { password } }` -- the two shapes this codebase logs.
  for (const prefix of ['', '*']) {
    for (const field of SECRET_FIELDS) paths.add(join(prefix, field))
  }
  for (const container of ['headers', 'req.headers', 'request.headers', 'res.headers']) {
    for (const header of HEADER_PATHS) paths.add(join(container, header))
  }
  return [...paths]
}

export const REDACTION_CENSOR = '[redacted]'
