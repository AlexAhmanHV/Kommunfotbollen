# Supabase + GitHub Actions Cron Migration Implementation Plan

**Goal:** Replace PGlite + in-process cron with Supabase Postgres + GitHub Actions cron, so `kommunfotboll` can run on Render's free Web Service tier.

**Architecture:** `lib/db/client.ts` connects to Supabase via `postgres` (postgres-js) + `drizzle-orm/postgres-js` using a `DATABASE_URL` env var, keeping the existing DDL-on-connect pattern. `/api/sync` gains a `target` query param (`matches` | `news`) and a bearer-token check. A new GitHub Actions workflow calls it on the original 15-min/daily cadence.

**Verification database:** a real Supabase project (`kommunfotboll`, eu-west-1, session pooler) already exists; `.env.local` (gitignored) already has its `DATABASE_URL`. Every step below is verified against this real database, not just compiled.

## Global Constraints

- No drizzle-kit or other new migration tooling — keep the DDL-exec-on-connect pattern.
- `lib/db/schema.ts` is not modified.
- Real secrets never get committed — `.env*` is already gitignored; double-check before every commit with `git status`.

---

### Task 1: Swap PGlite for Supabase Postgres

**Files:**
- Modify: `lib/db/client.ts`
- Modify: `package.json`
- Modify: `next.config.ts`
- Modify: `app/systemstatus/page.tsx`
- Modify: `README.md`

- [ ] **Step 1: Install `postgres`, remove `@electric-sql/pglite`**

```bash
npm uninstall @electric-sql/pglite
npm install postgres@^3.4.9
```

- [ ] **Step 2: Rewrite `lib/db/client.ts`**

Replace the top of the file (imports and `createDb`) — keep the `DDL` template string and everything from `type Db = ...` onward unchanged:

```ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

// Postgres (Supabase i produktion, valfri lokal Postgres i dev) via
// postgres-js. Samma pg-dialekt som schema.ts alltid varit skrivet för —
// inget här ändrar tabellstrukturen.
```

Replace `createDb`'s body:

```ts
async function createDb(): Promise<Db> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL saknas — sätt den i .env.local (dev) eller som miljövariabel (prod).");
  }
  const client = postgres(connectionString, { prepare: false });
  const db = drizzle(client, { schema });
  await db.execute(sql.raw(DDL));
  return db;
}
```

(`prepare: false` is required for Supabase's session/transaction poolers, which don't support prepared statements the way a direct connection does — using the session pooler here means this is not optional.)

- [ ] **Step 3: Run against the real database to confirm the DDL applies cleanly**

Next.js loads `.env.local` automatically, so `DATABASE_URL` is already available. Run:

```bash
npm run dev
```

Expected: server starts, no connection errors in the terminal. Load `http://localhost:3000` in a browser — the homepage should render (it will auto-seed via `ensureSynced()`, which will take a little while on first load since the database is empty). Stop the server (Ctrl+C) once the homepage renders without errors.

Then confirm the tables actually landed in Supabase: run `psql "$DATABASE_URL" -c '\dt'` (reading `DATABASE_URL` from `.env.local`) or check the Supabase dashboard's Table Editor — expect to see `seasons`, `leagues`, `groups`, `teams`, `team_entries`, `matches`, `articles`, `article_teams`, `podcast_episodes`, `match_goals`, `dv_reports`, `table_rows`.

- [ ] **Step 4: Remove the PGlite-specific Next.js config**

In `next.config.ts`, remove this line entirely:

```ts
  serverExternalPackages: ["@electric-sql/pglite"],
```

(and its preceding comment block about PGlite/Turbopack). Leave the `turbopack.root` and `images.remotePatterns` entries untouched.

- [ ] **Step 5: Correct the architecture description in `app/systemstatus/page.tsx`**

Change:

```tsx
          <FlowStep label="Databas" detail="PGlite + Drizzle, körs inbäddat i appen" />
```

to:

```tsx
          <FlowStep label="Databas" detail="Supabase Postgres + Drizzle" />
```

Change:

```tsx
          Byggt med Next.js 16 · PGlite · Drizzle · Zod · Tailwind v4 · Claude API
```

to:

```tsx
          Byggt med Next.js 16 · Supabase Postgres · Drizzle · Zod · Tailwind v4 · Claude API
```

- [ ] **Step 6: Correct the architecture description in `README.md`**

Change the tech-stack line:

```
- [PGlite](https://pglite.dev) — inbäddad Postgres (WASM), ingen extern databas att drifta
```

to:

```
- [Supabase](https://supabase.com) — hanterad Postgres
```

Change the architecture diagram's database line from:

```
        PGlite + Drizzle (inbäddad databas)
```

to:

```
        Supabase Postgres + Drizzle
```

Do not touch anything else in the README in this task — the fuller portfolio-README pass is a separate, later request.

- [ ] **Step 7: Full verification**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all three succeed (the `npm run build` regex/target fix from the earlier session already landed — this should stay clean).

- [ ] **Step 8: Commit**

```bash
git add lib/db/client.ts package.json package-lock.json next.config.ts app/systemstatus/page.tsx README.md
git commit -m "feat: migrate from PGlite to Supabase Postgres"
```

Confirm `.env.local` is NOT in this commit: `git status` should not list it (it's gitignored, but double-check).

---

### Task 2: Split `/api/sync` by target, add auth

**Files:**
- Modify: `app/api/sync/route.ts`

- [ ] **Step 1: Rewrite the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { syncAll, syncMatches, syncNewsAndFilter } from "@/lib/sync";

// Manuell/cron-endpoint. Anropas av GitHub Actions (var 15:e min för
// matcher, dagligen för nyheter) och kan även köras manuellt utan
// target-param för en full synk (backup/felsökning).
// Kräver Authorization: Bearer <CRON_SECRET> om CRON_SECRET är satt.
export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const target = req.nextUrl.searchParams.get("target");
  const started = Date.now();
  try {
    if (target === "matches") {
      await syncMatches();
    } else if (target === "news") {
      await syncNewsAndFilter();
    } else {
      await syncAll();
    }
    return NextResponse.json({ ok: true, target: target ?? "all", ms: Date.now() - started });
  } catch (err) {
    console.error("[sync] /api/sync misslyckades:", err);
    return NextResponse.json({
      ok: false,
      error: String(err),
      ms: Date.now() - started,
    });
  }
}
```

Note: `CRON_SECRET` is optional-if-unset by design here so local dev (no `.env.local` entry for it) keeps working without a token. It becomes mandatory in practice once set as a Render env var in Task 3.

- [ ] **Step 2: Verify locally against the real database**

With the dev server running (`npm run dev`) and `.env.local` NOT setting `CRON_SECRET` (so the check is skipped locally):

```bash
curl -X POST "http://localhost:3000/api/sync?target=matches"
```

Expected: `{"ok":true,"target":"matches","ms":...}` — and the terminal running `next dev` should show the `[sync]`-prefixed log lines from `syncMatches()`/`syncLeague()` actually running.

```bash
curl -X POST "http://localhost:3000/api/sync"
```

Expected: `{"ok":true,"target":"all","ms":...}`.

Then add `CRON_SECRET=test-secret-123` to `.env.local`, restart `npm run dev`, and confirm the auth check works:

```bash
curl -i -X POST "http://localhost:3000/api/sync?target=matches"
```

Expected: `HTTP/1.1 401` with `{"ok":false,"error":"unauthorized"}`.

```bash
curl -X POST "http://localhost:3000/api/sync?target=matches" -H "Authorization: Bearer test-secret-123"
```

Expected: `{"ok":true,...}` again.

Remove the test `CRON_SECRET` line from `.env.local` afterward (it was only for this local check — the real one gets generated fresh for Render in Task 3, don't reuse `test-secret-123` anywhere real).

- [ ] **Step 3: Verify the rest of the suite**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "feat: split /api/sync by target, add bearer-token auth"
```

---

### Task 3: GitHub Actions cron workflow

**Files:**
- Create: `.github/workflows/sync.yml`

**Note:** this task references `${{ secrets.CRON_SECRET }}` and `${{ vars.RENDER_URL }}`, neither of which exist in the GitHub repo yet — they get added in Task 4 once the Render URL is known and a real `CRON_SECRET` has been generated. The workflow file itself can be written and committed now; it simply won't run successfully (or won't be triggered in a way that matters) until Task 4 wires up the repo secret/variable and Task 5 gets the Render service live.

- [ ] **Step 1: Write `.github/workflows/sync.yml`**

```yaml
name: Sync

on:
  schedule:
    - cron: '*/15 * * * *'
    - cron: '0 20 * * *'
  workflow_dispatch:
    inputs:
      target:
        description: 'Sync target'
        required: true
        default: 'matches'
        type: choice
        options:
          - matches
          - news

jobs:
  sync-matches:
    if: github.event.schedule == '*/15 * * * *' || (github.event_name == 'workflow_dispatch' && inputs.target == 'matches')
    runs-on: ubuntu-latest
    steps:
      - name: Trigger match sync
        run: |
          curl -sf -X POST "${{ vars.RENDER_URL }}/api/sync?target=matches" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"

  sync-news:
    if: github.event.schedule == '0 20 * * *' || (github.event_name == 'workflow_dispatch' && inputs.target == 'news')
    runs-on: ubuntu-latest
    steps:
      - name: Trigger news sync
        run: |
          curl -sf -X POST "${{ vars.RENDER_URL }}/api/sync?target=news" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

`workflow_dispatch` with a `target` input is included so the sync can be triggered manually from the GitHub UI for testing, without waiting for a schedule to fire.

- [ ] **Step 2: Validate the YAML**

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/sync.yml'))"
```

Expected: no output, no error.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sync.yml
git commit -m "ci: add GitHub Actions cron for match and news sync"
```

---

### Task 4: Push, then set up Render + GitHub secrets (human-in-the-loop steps noted)

This task is executed by the controller (not delegated), since it involves account actions (Render service creation, GitHub secret configuration) that need the browser and explicit confirmation steps already covered earlier in the conversation.

- [ ] **Step 1: Push Tasks 1-3 to `main`**
- [ ] **Step 2: Generate a real `CRON_SECRET`** (a random string, e.g. via `openssl rand -hex 32`) — never reuse the `test-secret-123` value from Task 2's local testing.
- [ ] **Step 3: Create the Render Web Service** (free tier, Node environment, connected to `AlexAhmanHV/Kommunfotbollen`, build command `npm install && npm run build`, start command `npm start`), with environment variables `DATABASE_URL` (the Supabase session-pooler string), `ANTHROPIC_API_KEY` (existing key), `CRON_SECRET` (the one just generated).
- [ ] **Step 4: Wait for the first deploy to go live**, confirm the app actually renders (homepage loads, no 500s).
- [ ] **Step 5: Add the GitHub repo secret `CRON_SECRET`** (same value as Render's) and repo variable `RENDER_URL` (the live `https://...onrender.com` URL, no trailing slash).
- [ ] **Step 6: Manually trigger the `Sync` workflow once via `workflow_dispatch`** (both `matches` and `news` targets) to confirm the whole chain works end-to-end against the live deployment.
- [ ] **Step 7: Connect the custom domain `kommunfotboll.se`** in Render's dashboard, following Render's standard custom-domain DNS instructions.

## Post-plan state

After Task 4: `kommunfotboll` runs on Render's free tier, reading/writing a real Supabase Postgres database that survives restarts, kept up to date by a GitHub Actions cron hitting an authenticated `/api/sync` endpoint on the original 15-minute/daily cadence, reachable at `kommunfotboll.se`.
