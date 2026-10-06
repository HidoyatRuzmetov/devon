# Telegram delivery

`TELEGRAM_TRANSPORT=webhook` is the default. It requires a publicly trusted HTTPS endpoint and
`TELEGRAM_WEBHOOK_SECRET`; optional `TELEGRAM_WEBHOOK_BASE_URL` and
`TELEGRAM_WEBHOOK_CERTIFICATE_PATH` support a separately operated endpoint/public certificate.
Never supply a private key as the certificate. Public certificates can be placed in `infra/certs`,
mounted read-only in the API at `/run/devon-public-certs`.

For IP-only installations where Telegram cannot verify HTTPS and another inbound port is blocked,
set `TELEGRAM_TRANSPORT=polling` and deploy. Only that explicit setting allows production to remove
its webhook. Pending updates are preserved. A dedicated PostgreSQL advisory lock elects a single
consumer; a second API instance waits without deleting the webhook or consuming updates. Losing
the lock connection aborts polling, and failures retry with backoff. Shutdown aborts the request and
releases the lock. No extra ports, proxy container or certificate renewal jobs are needed.

The admin health check verifies Telegram authentication, an empty webhook URL in polling mode, and
a recent successful poll by this process. It does not report success from the presence of a token
alone. Local development still requires `TELEGRAM_POLLING_ENABLED=true`; copied production tokens
remain disabled by default. Use a separate development bot.

After changing production transport, check pending updates reach zero and that a fresh user-issued
`/start <code>` receives a reply. Expired codes require a new code from the Telegram settings page.
