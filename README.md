# FlashMail

A receive-only disposable inbox application built with Next.js, React, TypeScript, Tailwind, PostgreSQL/Prisma and Redis. No SMTP client, compose endpoint, outbound provider key, reply, or forwarding feature is included.

## Status

The application generates independent browser-session inboxes. **External receiving is unconfigured by default.** `localhost.invalid` is deliberately non-deliverable. Signed integration fixtures are tests, not real external delivery. Do not advertise receiving as working until the end-to-end procedure below passes.

## Local development

Use Node 22.12+ (Node 24 recommended), PostgreSQL 17 and Redis 7. Copy `.env.example` to `.env` and set database URLs for your environment. Keep `.env` private. For local services, point URLs at `127.0.0.1`; Compose uses service names `db` and `redis`.

```sh
npm ci
npm run db:migrate
npm run dev
# separate terminal
npm run worker
```

Open port 3000. The worker deletes expired sessions, cascading to inboxes, messages and attachment bytes, every minute. Authorization and inbound delivery deny expired inboxes immediately, even before cleanup. Files are stored as PostgreSQL bytes to keep transactions and cascade deletion consistent. Restrict database backups and define their retention separately.

## Production

Set a strong `POSTGRES_PASSWORD` in `.env`; use the same URL-encoded value in `DATABASE_URL`. Set `DATABASE_URL=postgresql://flashmail:YOUR_PASSWORD@db:5432/flashmail` and `REDIS_URL=redis://redis:6379`. Configure your actual HTTPS `APP_URL`, domain, signing key, ClamAV host, and admin password hash.

```sh
docker compose up --build -d
```

Compose includes PostgreSQL, Redis persistence, ClamAV, migration job, application and cleanup worker. Database and Redis are not published. The app binds host loopback port 3000 for a TLS reverse proxy. Deploy the included Caddyfile with `PUBLIC_HOST` set to your website hostname, DNS A/AAAA pointing at your server, and ports 80/443 open. Caddy obtains HTTPS certificates. Never publish the development server. Set body limits on any additional ingress to 10 MiB, disable buffering on SSE, and preserve streaming. Trust only your own reverse proxy; if it overwrites X-Forwarded-For, set `TRUST_PROXY=true` for per-client IP creation/login limits. Otherwise creation limits conservatively share one bucket.

For this managed cloud environment, networked Docker build steps support a `proxy_ca` BuildKit secret. Supply `docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" .` with the injected public CA; do not disable TLS checks. Standard deployments need no additional CA.

Run `npm run build && npm start` for a non-Docker production deployment, alongside `npm run worker`. Health: `GET /api/health` verifies PostgreSQL and Redis; its `receivingConfigured` flag means configuration presence only, never proven delivery. Configure your monitoring system to poll this endpoint and alert on 503, worker absence, Redis errors, disk pressure and webhook failures. Logs intentionally exclude message contents. The admin panel provides aggregate error and abuse counters. External error-monitoring service credentials are not included.

## Connect a domain to Mailgun inbound receiving

1. Own a domain or subdomain (for example `inbox.yourdomain.com`) and add it to Mailgun in a region/plan supporting inbound routing. Do not repoint an existing personal/business mail domain: doing so can interrupt its mail.
2. Add the exact MX records displayed by Mailgun. US commonly uses priority 10 `mxa.mailgun.org` and `mxb.mailgun.org`; EU uses the region-specific hosts shown by Mailgun. Provider instructions are authoritative. Complete domain verification records. Outbound sending is not used.
3. Deploy this app on a publicly reachable HTTPS origin, for example `https://flashmail.yourdomain.com`.
4. Set `MAIL_DOMAIN=inbox.yourdomain.com`, `APP_URL=https://flashmail.yourdomain.com`, `MAILGUN_SIGNING_KEY` to Mailgun's **HTTP webhook signing key** (not the API key), and `INBOUND_ENABLED=true`. Supply secrets securely through the host, never chat or Git. Restart the app and worker.
5. In Mailgun Routes create a catch-all expression scoped to your domain: `match_recipient(".*@inbox.yourdomain.com")`. Add `forward("https://flashmail.yourdomain.com/api/webhooks/inbound-email")` and `stop()`. Mailgun posts parsed MIME fields as URL-encoded/multipart form data. Do not configure raw MIME forwarding or JSON; this endpoint expects parsed `recipient`, `sender`, `subject`, `body-plain`, `body-html`, `Message-Id`, `timestamp`, `token`, `signature`, and `attachment-N` files. Mailgun handles MIME/Unicode parsing. Match only your inbound domain.
6. Start ClamAV, wait until its signatures and TCP service are ready, set `CLAMAV_HOST=clamav` and `CLAMAV_PORT=3310`. It must only be accessible privately. Messages with attachments fail closed when scanning is unavailable. Scan rejection returns 422; oversized requests return 413; unknown/expired recipients return 406. Provider retries temporary 503 failures according to its policy. Check delivery logs.
7. Generate a **new** inbox in your browser, send an email from Gmail/Outlook to that address, and confirm the sender, Unicode subject, body and SSE update. Test a small benign attachment and download. Open another browser profile and confirm the message is absent there. Check Mailgun logs for HTTP 200. Verify duplicate delivery produces one message.
8. Only after those checks may you describe external receiving as tested. Never substitute locally inserted messages as proof of domain delivery.

Webhook signatures use HMAC-SHA256 with a five-minute timestamp window and constant-time comparison. Redis prevents signed-token replay; a unique `(inboxId, providerMessageId)` constraint handles retries and concurrent delivery. Retries must include the original Message-Id. Webhook signatures authenticate the provider, not the sender's identity; spoofed From headers remain possible.

## Security and operating limits

HttpOnly SameSite=Strict cookies authorize inboxes; HTTPS enables Secure. Tokens are hashed in PostgreSQL and excluded from public responses. All reads/deletes and attachment downloads check ownership and expiry. Browser writes require an exact Origin match; API calls without Origin intentionally fail. Redis rate limits fail closed. Run Redis privately with persistence, resource monitoring and no eviction. The application shares no public inbox lookup.

HTML is allowlist-sanitized and rendered in a sandboxed iframe with a restrictive nested CSP. Links, images, scripts, inline styles, forms and tracking URLs are removed. Attachments have a 5 MiB individual limit, 10 per message, and 10 MiB total webhook body limit by default; only clean ClamAV scans are persisted. Downloads use application/octet-stream, attachment disposition and nosniff. Antivirus is defense in depth, not a guarantee.

The default 24-hour expiry is configurable; admin changes affect newly generated inboxes. Message listing returns the newest 200 messages. No service can promise unlimited resource use: plan capacity, provider quotas, storage budgets and retention. Thousands of concurrent SSE connections require appropriately sized hosts/proxy timeouts and Redis connection capacity. Horizontal app replicas share PostgreSQL/Redis; run one cleanup worker. Load testing and independent security review are required before a production launch.

## Admin

Generate a password hash locally (input is hidden, no plaintext in command history):

```sh
read -rs -p 'Admin password: ' FM_PASSWORD; echo
FM_PASSWORD="$FM_PASSWORD" node --input-type=module -e 'import {randomBytes,scryptSync} from "node:crypto"; const salt=randomBytes(16).toString("hex"); console.log(salt+":"+scryptSync(process.env.FM_PASSWORD,salt,64).toString("hex"))'
unset FM_PASSWORD
```

Store the result as `ADMIN_PASSWORD_HASH`; never store the plaintext. Use a long unique password. Visit `/admin`. Sessions expire in an hour and login attempts are rate limited. Admin has aggregate statistics, latest inbox addresses, inbox deletion and retention/body-size controls. There is no message-content viewer. For public production deployments, add identity-aware proxy/MFA protection to `/admin` and `/api/admin/*`.

## Tests

Integration tests require a **separate test database** and Redis database, the app on port 3001, and the same `MAILGUN_SIGNING_KEY` on test runner and server. Set `APP_URL=http://localhost:3001`, `MAIL_DOMAIN=test.example.org`, `INBOUND_ENABLED=true`. Never use this key or domain in production. Generate a random test key locally. Run migrations, start `PORT=3001 npm run dev`, then `TEST_URL=http://localhost:3001 npm test`. Tests post signed provider-shaped fixture requests; no test injection endpoint exists in the application. Test database records and rate-limit keys are disposable. Test coverage includes generation/concurrency, session restoration/isolation, CSRF, invalid signatures, delivery, deduplication, sanitized HTML, reads/deletes, expiration, regeneration and rate limits.

`npm run build` also checks TypeScript. Browser checks should include desktop/mobile layouts, keyboard navigation, copy, theme, address replacement, live inbox updates and deletion. Do not treat a successful build or fixture delivery as proof of real incoming email.

## Prisma tooling in restricted environments

`npm run db:generate` uses the official, version-pinned Prisma generator API with the JavaScript PostgreSQL driver adapter. It does not need a native query engine. `npm run db:migrate` applies the checked-in SQL in transactions under a PostgreSQL advisory lock and records SHA-256 checksums in Prisma-compatible migration history. Repeat runs verify history and do not reapply migrations. `npm run db:migrate:prisma` offers the standard Prisma CLI deployment path where `binaries.prisma.sh` is reachable. Do not disable engine checksum verification. The generator tooling packages are pinned together in the lockfile; update them together.

Current local validation artifacts are in the ignored `artifacts/` directory. The optional `scripts/browser-check.ts` uses the locally installed `/usr/bin/chromium`; adapt that executable path on other hosts. `scripts/operations-check.ts` is an isolated test-only admin/cleanup check and assumes a test server on port 3002, a test database, and test-only credentials. It must never target production.

ClamAV is defined in Compose but has not been started or positively validated in the local preview. Inbound attachment delivery stays blocked without a healthy scanner. Allow ClamAV signature updates to its official update destinations on the deployment host, size memory appropriately, and test a benign attachment and a controlled EICAR fixture before enabling public attachment receiving. The local production preview intentionally has admin login disabled until you configure your own password hash.

For repeatable local integration runs, create a private `.env.test` with the separate `DATABASE_URL` ending in `_test`, `REDIS_URL` pointing to database 1, `APP_URL=http://localhost:3001`, `MAIL_DOMAIN=test.example.org`, `INBOUND_ENABLED=true`, and a random test-only `MAILGUN_SIGNING_KEY`. Run `node --env-file=.env.test --import tsx scripts/migrate.ts`. Start the test instance with `node --env-file=.env.test node_modules/next/dist/bin/next start -p 3001` after a successful build, then `npm test`. Tests refuse to use a database whose name does not end in `_test`.
