# Free-tier deployment: PGlite → Supabase + GitHub Actions cron — design

## Goal

Get `kommunfotboll` genuinely live on Render, on Render's **free** Web
Service tier, without changing its self-sustaining "no manual editing"
architecture.

The current architecture cannot run on a free host as-is:

- `lib/db/client.ts` uses PGlite, an embedded WASM Postgres that persists
  to a local directory (`./.pgdata`). Render's free Web Services have an
  ephemeral filesystem and no persistent disk option — every restart would
  silently wipe the database.
- `instrumentation.ts` schedules the app's own cron (`syncMatches` every 15
  min, `syncNewsAndFilter` daily at 22:00 Europe/Stockholm) using in-process
  `setInterval`/`setTimeout`. Render's free Web Services spin down after ~15
  minutes of inactivity; a sleeping process doesn't fire timers, so these
  jobs would stop running reliably between visits.

Both problems have the same fix: move state and scheduling **out of the
Next.js process** onto services that don't need it to stay resident.
`lib/db/schema.ts` already uses `drizzle-orm/pg-core` (real Postgres
dialect) specifically so this migration wouldn't require touching it — the
README already said as much before this spec was written.

A Supabase project (`kommunfotboll`, `eu-west-1`, session pooler for IPv4
compatibility) has already been created for this migration during
planning, so the implementation can be verified against a real database
rather than just "it compiles."

## 1. Database: PGlite → Supabase Postgres

`lib/db/client.ts` swaps `@electric-sql/pglite` + `drizzle-orm/pglite` for
`postgres` (postgres-js) + `drizzle-orm/postgres-js`, connecting via a
`DATABASE_URL` environment variable. The existing "run `CREATE TABLE IF NOT
EXISTS` DDL on first connection" pattern is kept as-is — no new migration
tooling (drizzle-kit) is introduced, since the DDL string already is the
migration mechanism and rewriting that is out of scope.

`package.json`: remove `@electric-sql/pglite`, add `postgres`.
`next.config.ts`: remove the `serverExternalPackages: ["@electric-sql/pglite"]`
entry (postgres-js needs no such workaround).

`app/systemstatus/page.tsx` visibly tells visitors how the system is built
("PGlite + Drizzle, körs inbäddat i appen", "Byggt med ... PGlite ...") —
this becomes actively wrong once the database moves, so those two strings
get corrected to describe Supabase Postgres. This is a correctness fix
scoped to this task, not the broader portfolio-README polish requested
separately.

## 2. Cron: in-process timers → GitHub Actions

`app/api/sync/route.ts` currently only exposes `POST /api/sync`, which
always runs the combined `syncAll()` (both matches and news together). That
doesn't match the source cadence: matches need to run every 15 minutes,
news/podcasts once a day — running the daily job every 15 minutes would
call the Claude API and re-scrape news sources ~96x more often than
needed, for no benefit.

The route gains a `target` query parameter:

- `POST /api/sync?target=matches` → calls `syncMatches()` alone.
- `POST /api/sync?target=news` → calls `syncNewsAndFilter()` alone.
- `POST /api/sync` (no param, existing behavior) → calls `syncAll()`
  unchanged, kept as a manual/backup trigger exactly as documented today.

The endpoint is currently unauthenticated. That was a lower-stakes gap when
the in-process timers were the real trigger and this route was just a
documented manual backup; once GitHub Actions becomes the *only* reliable
trigger in production, an unauthenticated public POST endpoint that fans
out to Everysport scraping and paid Claude API calls is worth closing. The
route checks a shared secret (`CRON_SECRET` env var) against an
`Authorization: Bearer <secret>` header, returning `401` if it doesn't
match.

New `.github/workflows/sync.yml`, two scheduled jobs mirroring the original
cadence:

- Matches: cron `*/15 * * * *`, `curl -X POST
  "$RENDER_URL/api/sync?target=matches"` with the bearer header.
- News: cron `0 20 * * *` (20:00 UTC = 22:00 Europe/Stockholm outside DST;
  see Global Constraints for the DST caveat this introduces).

Both use `secrets.CRON_SECRET` and a `RENDER_URL` repository variable (not
a secret — it's just the public app URL) so the workflow file itself
contains no environment-specific values.

`instrumentation.ts` is left untouched. It's genuinely useful for local
`npm run dev` (auto-sync without needing to curl the endpoint by hand), and
harmless in production: on a sleeping Render instance its timers simply
don't fire between requests, which is fine now that GitHub Actions is the
trigger of record. Removing it would be a bigger, riskier change for no
functional benefit.

## 3. Render service

A **free** Web Service (Node environment, not Docker — no Dockerfile
exists or is needed), connected to the `AlexAhmanHV/Kommunfotbollen` GitHub
repo, `main` branch, auto-deploy enabled. Build command `npm install && npm
run build`, start command `npm start`. Environment variables:
`DATABASE_URL` (Supabase session-pooler connection string),
`ANTHROPIC_API_KEY` (existing key, currently only in local `.env`),
`CRON_SECRET` (new, generated for this task, shared with the GitHub Actions
workflow via a repo secret).

Custom domain `kommunfotboll.se` gets connected once the service is live
and building successfully — DNS is pointed at Render per Render's
standard custom-domain instructions.

## Global Constraints

- No Docker, no persistent disk, no paid Render tier — the entire point of
  this migration is to fit the free tier.
- `lib/db/schema.ts` is not modified — it already targets standard
  Postgres.
- No new database-migration tooling (drizzle-kit, etc.) — the existing
  DDL-on-connect pattern is preserved as-is.
- The news/podcast cron's `20:00 UTC` schedule drifts to 21:00 or 23:00
  local Swedish time depending on DST, since GitHub Actions cron is UTC-only
  and doesn't shift with daylight saving. The original in-process scheduler
  computed the target in `Europe/Stockholm` time and therefore didn't have
  this problem. This is a known, accepted trade-off, not a defect to fix
  here — cron-based DST handling would need a second workflow file swapped
  twice a year, which is out of scope for a hobby project's news sync
  timing.
- Real credentials (the Supabase password, `CRON_SECRET`) are never
  committed to git or written anywhere `.gitignore` doesn't already cover
  (`.env*`).

## Out of scope (explicitly, per the user's own sequencing)

- Linking the project from AlexAhman.se (separate follow-up request).
- Full portfolio-grade README rewrite / highlighting the AI-extraction
  story (separate follow-up request).
- Automated tests / CI for `kommunfotboll` itself (explicitly skipped by
  the user "for now").
- Fixing any *other* pre-existing lint/typecheck issues beyond what
  actually blocks this deployment.
