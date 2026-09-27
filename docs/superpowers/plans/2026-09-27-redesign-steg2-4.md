# Redesign steg 2–4: seriesida, lagsidor, övriga sidor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ge seriesidan en mörk topp med tabellen som resultattavla, bygg nya lagsidor (`/lag/[slug]`), ge "Så funkar det", systemstatus och 404 den nya stilen, och ta bort de gamla färgtokens.

**Architecture:** Ren logik (slug ↔ lag-id, tabellutdrag) i `lib/teams.ts` med enhetstester. Seriesidans tabell och lagsidans delar blir egna serverkomponenter. Det mörka nyhetskortet bryts ut och delas av startsidan och lagsidan. Sist ersätts alla gamla klasser och tokens.

**Tech Stack:** Next.js 16 App Router (server components), React 19, Tailwind CSS v4 (`@theme` i `app/globals.css`), Drizzle ORM + Postgres, node:test via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-27-redesign-steg2-4-design.md` (bygger på `2026-09-27-redesign-steg1-design.md`)

## Global Constraints

- Tokens (finns sedan steg 1): mörkt `surface-dark`, `surface-dark-raised`, `line-dark`, `on-dark`, `on-dark-muted`; ljust `surface`, `surface-raised`, `line`, `ink`, `ink-muted`; `accent` `#c6f432`, `form-draw`. Typsnitt `font-display` (Barlow Condensed) för rubriker, lagnamn i rubriker/kort, siffror; Geist för brödtext.
- `accent` får vara **text** på mörka ytor men bara **fyllning** på ljusa (med mörk text ovanpå).
- Lokala lag markeras med fetstil (ingen grön streck-markering i listor).
- All text i gränssnittet på svenska. Kodkommentarer på svenska som i resten av projektet.
- Rörelse bara via befintliga klasser (`kenburns`, `rise`, `reveal`) som redan stängs av vid `prefers-reduced-motion`.
- Lag-slugs: `ifk-vastervik`, `hjorted-totebo`, `tjust-if-ff`, `vasterviks-ff`, `boif`, `gunnebo-if`, `fc-orbacken`, `overums-ik`, `ankarsrums-is`, `vasterviks-dam` (samma som lagbilderna).
- Kör aldrig två Next.js-processer samtidigt (dev-server körs på port 3001; `next build` bara av controllern med dev-servern stoppad).

## File Structure

| Fil | Ansvar |
|---|---|
| `lib/teams.ts` (ny) | `TEAM_SLUGS`, `teamSlug`, `teamIdBySlug`, `tableExcerpt` |
| `lib/teams.test.ts` (ny) | Tester för ovan |
| `lib/team-images.ts` (ändras) | Använder `TEAM_SLUGS` från `lib/teams.ts` |
| `app/components/league-table.tsx` (ny) | Seriesidans mörka tabell |
| `app/serie/[id]/page.tsx` (skrivs om) | Mörk topp + ljust spelprogram |
| `app/components/news-card.tsx` (ny) | Delat mörkt nyhetskort (`NewsArticle`, `NewsCard`) |
| `app/components/home/news-feed.tsx` (ändras) | Använder `NewsCard` |
| `app/components/home/team-grid.tsx` (ändras) | Exporterar `FormBadges`; korten länkar till lagsidan |
| `app/components/team/team-hero.tsx`, `next-match.tsx`, `table-excerpt.tsx` (nya) | Lagsidans mörka delar |
| `app/lag/[slug]/page.tsx` (ny) | Lagsidan |
| `app/layout.tsx`, `app/components/site-nav.tsx` (ändras) | Menyn "Lag" länkar till lagsidor; Geist Mono bort |
| `app/components/page-header.tsx` (ny) | Mörk rubrikrad för textsidor |
| `app/components/page-container.tsx` (ändras) | `max-w-5xl` |
| `app/sa-funkar-det/page.tsx`, `app/systemstatus/page.tsx`, `app/not-found.tsx` (ändras) | Ny stil |
| `app/globals.css` (ändras) | Gamla tokens och `.font-mono` bort |

---

### Task 1: Lag-slugs och tabellutdrag (ren logik)

**Files:**
- Create: `lib/teams.ts`
- Create: `lib/teams.test.ts`
- Modify: `lib/team-images.ts`

**Interfaces:**
- Produces:
  - `TEAM_SLUGS: Record<string, string>` (lag-id → slug)
  - `teamSlug(teamId: string): string | null`
  - `teamIdBySlug(slug: string): string | null`
  - `tableExcerpt<T extends { teamId: string }>(rows: T[], teamId: string, radius?: number): T[]`

- [ ] **Step 1: Skriv testerna (`lib/teams.test.ts`)**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tableExcerpt, teamIdBySlug, teamSlug } from "./teams";

describe("teamSlug / teamIdBySlug", () => {
  it("slug åt båda hållen", () => {
    assert.equal(teamSlug("eswidget-9925"), "ifk-vastervik");
    assert.equal(teamIdBySlug("ifk-vastervik"), "eswidget-9925");
    assert.equal(teamIdBySlug("vasterviks-dam"), "eswidget-191798");
  });
  it("okänt lag eller okänd slug ger null", () => {
    assert.equal(teamSlug("eswidget-1"), null);
    assert.equal(teamIdBySlug("finns-inte"), null);
  });
});

describe("tableExcerpt", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ teamId: `t${i + 1}`, position: i + 1 }));
  const ids = (r: { teamId: string }[]) => r.map((x) => x.teamId);

  it("laget i mitten: två över och två under", () => {
    assert.deepEqual(ids(tableExcerpt(rows, "t6")), ["t4", "t5", "t6", "t7", "t8"]);
  });
  it("först i tabellen: fem översta", () => {
    assert.deepEqual(ids(tableExcerpt(rows, "t1")), ["t1", "t2", "t3", "t4", "t5"]);
  });
  it("sist i tabellen: fem nedersta", () => {
    assert.deepEqual(ids(tableExcerpt(rows, "t12")), ["t8", "t9", "t10", "t11", "t12"]);
  });
  it("serie med färre än fem lag: alla", () => {
    assert.deepEqual(ids(tableExcerpt(rows.slice(0, 3), "t2")), ["t1", "t2", "t3"]);
  });
  it("laget saknas: tomt", () => {
    assert.deepEqual(tableExcerpt(rows, "x"), []);
  });
});
```

- [ ] **Step 2: Kör och se dem misslyckas**

Run: `npm test`
Expected: FAIL — `Cannot find module './teams'` (eller motsvarande).

- [ ] **Step 3: Skapa `lib/teams.ts`**

```ts
// Lokala lags adresser (slug) och tabellutdrag — ren logik utan databas.
// Samma slug används för lagsidan (/lag/<slug>) och lagbilden
// (public/images/lag/<slug>.jpg).
export const TEAM_SLUGS: Record<string, string> = {
  "eswidget-9925": "ifk-vastervik",
  "eswidget-10040": "hjorted-totebo",
  "eswidget-51390": "tjust-if-ff",
  "eswidget-9942": "vasterviks-ff",
  "eswidget-23106": "boif",
  "eswidget-10039": "gunnebo-if",
  "eswidget-224214": "fc-orbacken",
  "eswidget-10249": "overums-ik",
  "eswidget-9982": "ankarsrums-is",
  "eswidget-191798": "vasterviks-dam",
};

const ID_BY_SLUG = new Map(Object.entries(TEAM_SLUGS).map(([id, slug]) => [slug, id]));

export function teamSlug(teamId: string): string | null {
  return TEAM_SLUGS[teamId] ?? null;
}

export function teamIdBySlug(slug: string): string | null {
  return ID_BY_SLUG.get(slug) ?? null;
}

/**
 * Utdrag ur en tabell (sorterad efter placering): laget med upp till `radius`
 * lag ovanför och under. Vid toppen/botten flyttas fönstret så att
 * 2·radius+1 rader visas om tabellen räcker. Saknas laget → tom lista.
 */
export function tableExcerpt<T extends { teamId: string }>(
  rows: T[],
  teamId: string,
  radius = 2,
): T[] {
  const i = rows.findIndex((r) => r.teamId === teamId);
  if (i < 0) return [];
  const size = Math.min(rows.length, radius * 2 + 1);
  const start = Math.min(Math.max(0, i - radius), rows.length - size);
  return rows.slice(start, start + size);
}
```

- [ ] **Step 4: Låt `lib/team-images.ts` använda `TEAM_SLUGS`**

Ta bort objektet `export const TEAM_IMAGE_SLUGS: Record<string, string> = { ... };` ur `lib/team-images.ts`, lägg till `import { TEAM_SLUGS } from "./teams";` efter de befintliga importerna, och byt `TEAM_IMAGE_SLUGS[teamId]` mot `TEAM_SLUGS[teamId]` i `teamImage`. Uppdatera kommentaren överst så att den säger att slug-tabellen finns i `lib/teams.ts`.

Run: `grep -rn "TEAM_IMAGE_SLUGS" app lib`
Expected: inga träffar.

- [ ] **Step 5: Kör och se dem gå igenom**

Run: `npm test` och `npx tsc --noEmit`
Expected: alla tester PASS (tidigare 32 + 7 nya), inga typfel.

- [ ] **Step 6: Commit**

```bash
git add lib/teams.ts lib/teams.test.ts lib/team-images.ts
git commit -m "feat: team slugs and table excerpt helpers"
```

---

### Task 2: Seriesidan med mörk topp

**Files:**
- Create: `app/components/league-table.tsx`
- Rewrite: `app/serie/[id]/page.tsx`

**Interfaces:**
- Consumes: `teamSlug` (`@/lib/teams`, Task 1), `isLocalTeam` (`@/lib/local-teams`), `TeamCrest`, `SectionHeading` (med `tone`), `MatchList`, `PageContainer`, `getMatches`, `isResultMissing` (`@/lib/queries`).
- Produces: `type LeagueTableRow = { position: number; teamId: string; teamName: string; teamLogo: string | null; gp: number; w: number; d: number; l: number; gd: number; pts: number; positionStatus: string | null }` och `LeagueTable({ rows }: { rows: LeagueTableRow[] })`.

- [ ] **Step 1: Skapa `app/components/league-table.tsx`**

```tsx
import Link from "next/link";
import { isLocalTeam } from "@/lib/local-teams";
import { teamSlug } from "@/lib/teams";
import { TeamCrest } from "./team-crest";

export type LeagueTableRow = {
  position: number;
  teamId: string;
  teamName: string;
  teamLogo: string | null;
  gp: number;
  w: number;
  d: number;
  l: number;
  gd: number;
  pts: number;
  positionStatus: string | null;
};

// Zonkant längst till vänster, från Everysports zonstreck.
const ZONE: Record<string, string> = {
  promotion: "shadow-[inset_3px_0_0_#c6f432]",
  playoff: "shadow-[inset_3px_0_0_rgb(198_244_50/0.45)]",
  relegation: "shadow-[inset_3px_0_0_#ff5a5a]",
};

// Seriens tabell som resultattavla i den mörka zonen. Lokala lag i fetstil
// med svag grön bakgrund; deras namn länkar till lagsidan.
export function LeagueTable({ rows }: { rows: LeagueTableRow[] }) {
  const hasZones = rows.some((r) => r.positionStatus);
  return (
    <div>
      <div className="overflow-x-auto rounded-xl bg-surface-dark-raised">
        <table className="w-full min-w-[520px] text-sm tabular-nums">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-widest text-on-dark-muted">
              <th className="px-3 py-2.5 text-left">#</th>
              <th className="px-3 py-2.5 text-left">Lag</th>
              <th className="px-2 py-2.5 text-right">S</th>
              <th className="px-2 py-2.5 text-right">V</th>
              <th className="px-2 py-2.5 text-right">O</th>
              <th className="px-2 py-2.5 text-right">F</th>
              <th className="px-2 py-2.5 text-right">+/-</th>
              <th className="px-3 py-2.5 text-right">P</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const local = isLocalTeam(r.teamId);
              const slug = local ? teamSlug(r.teamId) : null;
              return (
                <tr
                  key={r.teamId}
                  className={`border-t border-line-dark ${local ? "bg-accent/10 font-semibold" : ""}`}
                >
                  <td className={`px-3 py-2 text-on-dark-muted ${ZONE[r.positionStatus ?? ""] ?? ""}`}>
                    {r.position}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2.5">
                      <TeamCrest name={r.teamName} logoUrl={r.teamLogo} size={22} />
                      {slug ? (
                        <Link href={`/lag/${slug}`} className="hover:underline">
                          {r.teamName}
                        </Link>
                      ) : (
                        r.teamName
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">{r.gp}</td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">{r.w}</td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">{r.d}</td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">{r.l}</td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">
                    {r.gd > 0 ? `+${r.gd}` : r.gd}
                  </td>
                  <td className="px-3 py-2 text-right font-display text-lg font-extrabold text-accent">
                    {r.pts}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasZones && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-dark-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-1 bg-accent" aria-hidden /> uppflyttning
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-1 bg-accent/45" aria-hidden /> kval
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-1 bg-[#ff5a5a]" aria-hidden /> nedflyttning
          </span>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Skriv om `app/serie/[id]/page.tsx`**

Ersätt hela filen med:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { groups, leagues, matches, tableRows, teams } from "@/lib/db/schema";
import { getMatches, isResultMissing } from "@/lib/queries";
import { LeagueTable } from "../../components/league-table";
import { MatchList } from "../../components/match-list";
import { PageContainer } from "../../components/page-container";
import { SectionHeading } from "../../components/section-heading";

// Datan ändras en gång per dygn (synken kl 22/23) — cacha sidan i stället
// för att fråga databasen vid varje besök.
export const revalidate = 60;

const CLASS_LABEL: Record<string, string> = {
  MEN: "Herrar",
  WOMEN: "Damer",
  BOYS: "Pojkar",
  GIRLS: "Flickor",
  MIX: "Mix",
};

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">
      {children}
    </h3>
  );
}

export default async function SeriePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getDb();

  const league = await db.query.leagues.findFirst({ where: eq(leagues.id, id) });
  if (!league) notFound();

  const leagueGroups = await db.select().from(groups).where(eq(groups.leagueId, league.id));
  const groupIds = leagueGroups.map((g) => g.id);

  const table = await db
    .select({
      position: tableRows.position,
      teamId: teams.id,
      teamName: teams.name,
      teamLogo: teams.logoUrl,
      gp: tableRows.gp,
      w: tableRows.w,
      d: tableRows.d,
      l: tableRows.l,
      gd: tableRows.gd,
      pts: tableRows.pts,
      positionStatus: tableRows.positionStatus,
    })
    .from(tableRows)
    .innerJoin(teams, eq(tableRows.teamId, teams.id))
    .where(inArray(tableRows.groupId, groupIds))
    .orderBy(asc(tableRows.position));

  const allMatches = await getMatches({
    where: inArray(matches.groupId, groupIds),
    order: "asc",
  });

  const upcoming = allMatches.filter((m) => m.status === "UPCOMING" && !isResultMissing(m));
  const finished = allMatches
    .filter((m) => m.status === "FINISHED" || isResultMissing(m))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  // Widget-datan saknar omgångsnummer, så "senaste omgången" approximeras:
  // alla spelade matcher inom 4 dygn från seriens senast spelade match
  // (en omgång spelas i praktiken över en helg eller ett par vardagar).
  const ROUND_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;
  const latestPlayedAt = finished[0]?.startsAt.getTime() ?? 0;
  const lastRound = finished.filter((m) => m.startsAt.getTime() >= latestPlayedAt - ROUND_WINDOW_MS);
  const earlier = finished.filter((m) => m.startsAt.getTime() < latestPlayedAt - ROUND_WINDOW_MS);

  return (
    <>
      <section className="bg-surface-dark text-on-dark">
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-8">
          <Link
            href="/"
            className="group inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-on-dark-muted transition-colors hover:text-accent"
          >
            <span className="transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden>
              ←
            </span>
            Alla serier
          </Link>
          <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-on-dark-muted">
            {league.level} · {league.district} · {CLASS_LABEL[league.teamClass] ?? league.teamClass}
          </p>
          <h1 className="mt-2 font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl">
            {league.name}
          </h1>
          <div className="mt-8">
            <SectionHeading tone="dark" count={`${table.length} lag`}>
              Tabell
            </SectionHeading>
            <LeagueTable rows={table} />
          </div>
        </div>
      </section>

      <PageContainer className="reveal">
        <SectionHeading>Spelprogram</SectionHeading>
        {allMatches.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Inga matcher i databasen ännu. Matchdata samlas in varje kväll vid varje synk.
          </p>
        ) : (
          <div className="space-y-6">
            {upcoming.length > 0 && (
              <div>
                <SubHeading>Kommande</SubHeading>
                <MatchList matches={upcoming} />
              </div>
            )}
            {lastRound.length > 0 && (
              <div>
                <SubHeading>Senaste omgången</SubHeading>
                <MatchList matches={lastRound} />
              </div>
            )}
            {earlier.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                  Tidigare resultat ({earlier.length})
                </summary>
                <div className="mt-4">
                  <MatchList matches={earlier} />
                </div>
              </details>
            )}
          </div>
        )}
      </PageContainer>
    </>
  );
}
```

- [ ] **Step 3: Kontroller**

Run: `npx tsc --noEmit && npm test`
Expected: inga typfel, alla tester PASS.

Run: `grep -nE "neutral-|emerald-|brand|font-mono" "app/serie/[id]/page.tsx" app/components/league-table.tsx`
Expected: inga träffar.

- [ ] **Step 4: Commit**

```bash
git add app/components/league-table.tsx "app/serie/[id]/page.tsx"
git commit -m "feat: league page with dark scoreboard table"
```

---

### Task 3: Lagsidan

**Files:**
- Create: `app/components/news-card.tsx`
- Modify: `app/components/home/news-feed.tsx`
- Modify: `app/components/home/team-grid.tsx`
- Create: `app/components/team/team-hero.tsx`
- Create: `app/components/team/next-match.tsx`
- Create: `app/components/team/table-excerpt.tsx`
- Create: `app/lag/[slug]/page.tsx`
- Modify: `app/layout.tsx`, `app/components/site-nav.tsx`

**Interfaces:**
- Consumes: `teamSlug`, `teamIdBySlug`, `tableExcerpt` (Task 1); `teamSummaries`, `latestRowPerTeam`, `isResultMissing`, `TeamSummary` (`@/lib/matchday`); `getMatches` (`@/lib/queries`); `teamImage` (`@/lib/team-images`); `MAX_ARTICLE_AGE_DAYS` (`@/lib/news`); `MatchList`, `SectionHeading`, `TeamCrest`.
- Produces:
  - `type NewsArticle` (flyttas hit från `news-feed.tsx`, samma fält), `NewsTags({ names })`, `NewsCard({ a }: { a: NewsArticle })` i `app/components/news-card.tsx`
  - `FormBadges({ form }: { form: FormLetter[] })` exporteras från `team-grid.tsx` (tidigare den interna `Form`)
  - `TeamHero({ team }: { team: TeamSummary })`, `NextMatchBox({ next, leagueName })`, `TableExcerptBox({ rows, teamId, leagueId })`

- [ ] **Step 1: Skapa `app/components/news-card.tsx` och låt `news-feed.tsx` använda det**

`app/components/news-card.tsx`:

```tsx
export type NewsArticle = {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  publishedAt: Date;
  teamNames: string[];
};

const dateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});

export function formatNewsDate(d: Date): string {
  return dateFmt.format(d);
}

export function NewsTags({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((n) => (
        <span
          key={n}
          className="rounded-[3px] bg-accent px-1.5 py-0.5 font-display text-xs font-bold uppercase tracking-wide text-surface-dark"
        >
          {n}
        </span>
      ))}
    </span>
  );
}

// Mörkt nyhetskort (startsidan och lagsidan): lagetiketter, rubrik, ingress,
// källa och datum. Länkar alltid vidare till tidningen.
export function NewsCard({ a }: { a: NewsArticle }) {
  return (
    <a
      href={a.id}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl bg-surface-dark p-5 text-on-dark transition-colors hover:bg-surface-dark-raised"
    >
      <NewsTags names={a.teamNames} />
      <h3 className="mt-3 font-display text-2xl font-extrabold uppercase leading-none sm:text-3xl">
        {a.title}
      </h3>
      {a.summary && <p className="mt-3 line-clamp-3 text-sm text-on-dark-muted">{a.summary}</p>}
      <p className="mt-3 text-xs text-on-dark-muted">
        {a.source} · {formatNewsDate(a.publishedAt)}
      </p>
    </a>
  );
}
```

I `app/components/home/news-feed.tsx`: ta bort den lokala `NewsArticle`-typen, `dateFmt`, `Tags` och `FeaturedCard`; importera `import { NewsCard, NewsTags, formatNewsDate, type NewsArticle } from "../news-card";` och lägg `export type { NewsArticle };` så att `app/page.tsx` kan fortsätta importera typen från `news-feed`. Byt `<FeaturedCard ... />` mot `<NewsCard ... />`, `<Tags ... />` mot `<NewsTags ... />` och `dateFmt.format(...)` mot `formatNewsDate(...)`. Beteendet ska vara oförändrat.

- [ ] **Step 2: Lagkorten länkar till lagsidan och formrutorna exporteras**

I `app/components/home/team-grid.tsx`:
- Byt namn på den interna `function Form(` till `export function FormBadges(` och uppdatera användningen i `TeamCard`.
- Lägg till `import { teamSlug } from "@/lib/teams";`.
- I `TeamCard`: räkna ut `const slug = teamSlug(team.teamId);` och låt länken gå till `/lag/${slug}` när `slug` finns, annars som idag till `/serie/${team.leagueId}` (och ingen länk om inget av dem finns).

- [ ] **Step 3: Menyn "Lag" länkar till lagsidorna**

I `app/layout.tsx`, i `getNavData`: lägg till `slug: teamSlug(t.id)` på varje lag i den returnerade `teams`-listan (importera `teamSlug` från `@/lib/teams`; mappa resultatet av den befintliga frågan, t.ex. `return { leagues: ls, teams: ts.map((t) => ({ ...t, slug: teamSlug(t.id) })) };`).

I `app/components/site-nav.tsx`: utöka `type Team` med `slug: string | null`, och låt lag-länkarna i både desktopmenyn och mobilmenyn gå till `t.slug ? \`/lag/${t.slug}\` : \`/serie/${t.leagueId}\``.

- [ ] **Step 4: Skapa `app/components/team/team-hero.tsx`**

```tsx
import Image from "next/image";
import type { TeamSummary } from "@/lib/matchday";
import { teamImage } from "@/lib/team-images";
import { FormBadges } from "../home/team-grid";
import { TeamCrest } from "../team-crest";

// Lagsidans affisch: lagbild (eller reserv) med långsam zoom, lagnamn stort,
// placering, poäng och form.
export function TeamHero({ team }: { team: TeamSummary }) {
  const image = teamImage(team.teamId);
  return (
    <div className="relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10">
        {image ? (
          <Image src={image} alt="" fill sizes="100vw" className="kenburns object-cover" />
        ) : (
          <div
            className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#2a2f38,#0e1116)]"
            aria-hidden
          >
            <div className="opacity-15">
              <TeamCrest name={team.name} logoUrl={team.logoUrl} size={220} />
            </div>
          </div>
        )}
      </div>
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,#0e1116_5%,rgb(14_17_22/0.25)_70%)]"
        aria-hidden
      />
      <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-4 px-4 pb-8 pt-28 sm:pt-40">
        <TeamCrest name={team.name} logoUrl={team.logoUrl} size={64} />
        <div className="min-w-0">
          {team.leagueName && (
            <p className="text-xs font-semibold uppercase tracking-widest text-on-dark-muted">
              {team.leagueName}
            </p>
          )}
          <h1 className="font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl">
            {team.name}
          </h1>
        </div>
        <div className="ml-auto text-right">
          {team.position != null && (
            <p className="font-display text-6xl font-extrabold leading-none tabular-nums text-accent">
              {team.position}
              <small className="font-sans text-sm font-medium text-on-dark-muted">
                :a · {team.pts} p
              </small>
            </p>
          )}
          <div className="flex justify-end">
            <FormBadges form={team.form} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Skapa `app/components/team/next-match.tsx`**

```tsx
import type { TeamSummary } from "@/lib/matchday";

const weekdayFmt = new Intl.DateTimeFormat("sv-SE", { weekday: "short", timeZone: "Europe/Stockholm" });
const dayMonthFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "numeric",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

export function NextMatchBox({
  next,
  leagueName,
}: {
  next: TeamSummary["next"];
  leagueName: string | null;
}) {
  return (
    <div className="rounded-xl bg-surface-dark-raised p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">
        Nästa match
        {next && ` · ${weekdayFmt.format(next.startsAt)} ${dayMonthFmt.format(next.startsAt)}`}
      </p>
      {next ? (
        <>
          <div className="mt-3 flex items-end justify-between gap-4">
            <p className="font-display text-2xl font-extrabold uppercase leading-none">
              {next.home ? "Hemma" : "Borta"} mot {next.opponent}
            </p>
            <p className="font-display text-5xl font-extrabold leading-none tabular-nums text-accent">
              {timeFmt.format(next.startsAt)}
            </p>
          </div>
          {leagueName && <p className="mt-2 text-xs text-on-dark-muted">{leagueName}</p>}
        </>
      ) : (
        <p className="mt-3 text-on-dark-muted">Ingen match inlagd</p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Skapa `app/components/team/table-excerpt.tsx`**

```tsx
import Link from "next/link";

export type ExcerptRow = { teamId: string; teamName: string; position: number; pts: number };

// Utdrag ur serietabellen med lagets rad markerad och länk till hela tabellen.
export function TableExcerptBox({
  rows,
  teamId,
  leagueId,
}: {
  rows: ExcerptRow[];
  teamId: string;
  leagueId: string | null;
}) {
  return (
    <div className="rounded-xl bg-surface-dark-raised p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">Tabellen</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-on-dark-muted">Ingen tabell inläst.</p>
      ) : (
        <table className="mt-2 w-full text-sm tabular-nums">
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.teamId}
                className={`border-t border-line-dark first:border-t-0 ${
                  r.teamId === teamId ? "bg-accent/10 font-bold" : ""
                }`}
              >
                <td className="w-8 py-1.5 pl-2 text-on-dark-muted">{r.position}</td>
                <td className="py-1.5">{r.teamName}</td>
                <td className="py-1.5 pr-2 text-right font-display text-base font-extrabold text-accent">
                  {r.pts}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {leagueId && (
        <Link
          href={`/serie/${leagueId}`}
          className="mt-3 inline-block text-xs font-semibold text-accent hover:underline"
        >
          Hela tabellen →
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Skapa `app/lag/[slug]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { articles, articleTeams, groups, leagues, matches, tableRows, teams } from "@/lib/db/schema";
import { isResultMissing, latestRowPerTeam, teamSummaries } from "@/lib/matchday";
import { MAX_ARTICLE_AGE_DAYS } from "@/lib/news";
import { getMatches } from "@/lib/queries";
import { tableExcerpt, teamIdBySlug } from "@/lib/teams";
import { MatchList } from "../../components/match-list";
import { NewsCard, type NewsArticle } from "../../components/news-card";
import { SectionHeading } from "../../components/section-heading";
import { NextMatchBox } from "../../components/team/next-match";
import { TableExcerptBox } from "../../components/team/table-excerpt";
import { TeamHero } from "../../components/team/team-hero";

export const revalidate = 60;

const NEWS_SHOWN = 6;
const PLAYED_SHOWN = 10;

function currentTime(): Date {
  return new Date();
}

function newsCutoff(): Date {
  return new Date(Date.now() - MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const teamId = teamIdBySlug(slug);
  if (!teamId) return {};
  const db = await getDb();
  const [row] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId));
  return row
    ? {
        title: `${row.name} | Kommunfotbollen`,
        description: `Matcher, tabelläge och nyheter om ${row.name}.`,
      }
    : {};
}

export default async function LagPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const teamId = teamIdBySlug(slug);
  if (!teamId) notFound();

  const db = await getDb();
  const now = currentTime();

  const [teamRows, teamMatches, newsRows] = await Promise.all([
    db
      .select({
        teamId: teams.id,
        name: teams.name,
        logoUrl: teams.logoUrl,
        leagueId: leagues.id,
        leagueName: leagues.name,
        groupId: tableRows.groupId,
        position: tableRows.position,
        pts: tableRows.pts,
        computedAt: tableRows.computedAt,
      })
      .from(teams)
      .leftJoin(tableRows, eq(tableRows.teamId, teams.id))
      .leftJoin(groups, eq(tableRows.groupId, groups.id))
      .leftJoin(leagues, eq(groups.leagueId, leagues.id))
      .where(eq(teams.id, teamId)),
    getMatches({
      where: or(eq(matches.homeTeamId, teamId), eq(matches.awayTeamId, teamId)),
      order: "asc",
    }),
    db
      .select({
        id: articles.id,
        title: articles.title,
        summary: articles.summary,
        source: articles.source,
        publishedAt: articles.publishedAt,
      })
      .from(articles)
      .innerJoin(articleTeams, eq(articleTeams.articleId, articles.id))
      .where(
        and(
          eq(articleTeams.teamId, teamId),
          gte(articles.publishedAt, newsCutoff()),
          // dölj AI-avvisade taggar; visa obedömda (null) och godkända (true)
          or(isNull(articleTeams.relevant), eq(articleTeams.relevant, true)),
        ),
      )
      .orderBy(desc(articles.publishedAt))
      .limit(NEWS_SHOWN),
  ]);

  const [team] = latestRowPerTeam(teamRows);
  if (!team) notFound();

  const groupTable = team.groupId
    ? await db
        .select({
          teamId: tableRows.teamId,
          teamName: teams.name,
          position: tableRows.position,
          pts: tableRows.pts,
        })
        .from(tableRows)
        .innerJoin(teams, eq(tableRows.teamId, teams.id))
        .where(eq(tableRows.groupId, team.groupId))
        .orderBy(asc(tableRows.position))
    : [];

  const [summary] = teamSummaries([team], teamMatches, now);
  const upcoming = teamMatches.filter((m) => m.status === "UPCOMING" && !isResultMissing(m, now));
  const played = teamMatches
    .filter((m) => m.status === "FINISHED" || isResultMissing(m, now))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const news: NewsArticle[] = newsRows.map((r) => ({ ...r, teamNames: [team.name] }));

  return (
    <>
      <section className="bg-surface-dark text-on-dark">
        <TeamHero team={summary} />
        <div className="mx-auto grid max-w-5xl gap-3 px-4 pb-10 md:grid-cols-[1.3fr_1fr]">
          <NextMatchBox next={summary.next} leagueName={team.leagueName} />
          <TableExcerptBox rows={tableExcerpt(groupTable, teamId)} teamId={teamId} leagueId={team.leagueId} />
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 lg:grid-cols-[2fr_1fr]">
        <section className="reveal space-y-6">
          <SectionHeading>Matcher</SectionHeading>
          {teamMatches.length === 0 && (
            <p className="text-sm text-ink-muted">Inga matcher inlästa ännu.</p>
          )}
          {upcoming.length > 0 && (
            <div>
              <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">
                Kommande
              </h3>
              <MatchList matches={upcoming} />
            </div>
          )}
          {played.length > 0 && (
            <div>
              <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">
                Spelade
              </h3>
              <MatchList matches={played.slice(0, PLAYED_SHOWN)} />
              {played.length > PLAYED_SHOWN && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                    Visa fler matcher ({played.length - PLAYED_SHOWN})
                  </summary>
                  <div className="mt-3">
                    <MatchList matches={played.slice(PLAYED_SHOWN)} />
                  </div>
                </details>
              )}
            </div>
          )}
        </section>

        <aside className="reveal">
          <SectionHeading>Nyheter</SectionHeading>
          {news.length === 0 ? (
            <p className="text-sm text-ink-muted">Inga nyheter om laget just nu.</p>
          ) : (
            <div className="space-y-3">
              {news.map((a) => (
                <NewsCard key={a.id} a={a} />
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
```

Obs: `latestRowPerTeam` kräver `computedAt: Date | null`, `teamSummaries` kräver `LocalTeamRow`-fälten — raden ovan har båda (extra fält som `groupId` är okej strukturellt). Om `tsc` klagar på typerna, rapportera exakt fel i stället för att kasta om typer.

- [ ] **Step 8: Kontroller**

Run: `npx tsc --noEmit && npm test`
Expected: inga typfel, alla tester PASS.

Run: `npx eslint app lib instrumentation.ts`
Expected: inga nya problem (kvar: högst `app/systemstatus/page.tsx` impure function och `lib/goals.ts` oanvänd `now`).

- [ ] **Step 9: Commit**

```bash
git add app/components/news-card.tsx app/components/home/news-feed.tsx app/components/home/team-grid.tsx app/components/team "app/lag/[slug]/page.tsx" app/layout.tsx app/components/site-nav.tsx
git commit -m "feat: team pages with poster, next match, table excerpt, matches and news"
```

---

### Task 4: Övriga sidor och städning av gamla tokens

**Files:**
- Create: `app/components/page-header.tsx`
- Modify: `app/components/page-container.tsx`
- Modify: `app/sa-funkar-det/page.tsx`, `app/systemstatus/page.tsx`, `app/not-found.tsx`
- Modify: `app/globals.css`, `app/layout.tsx`

**Interfaces:**
- Produces: `PageHeader({ kicker, title, children? }: { kicker: string; title: string; children?: React.ReactNode })`.

- [ ] **Step 1: Skapa `app/components/page-header.tsx`**

```tsx
// Mörk rubrikrad för textsidor ("Så funkar det", systemstatus): etikett,
// rubrik och valfri ingress. Går kant i kant; innehållet under ligger ljust.
export function PageHeader({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="bg-surface-dark text-on-dark">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-10">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent">
          <span className="h-1 w-4 bg-accent" aria-hidden />
          {kicker}
        </p>
        <h1 className="mt-3 font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl">
          {title}
        </h1>
        {children && (
          <div className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-on-dark-muted">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: `PageContainer` blir lika bred som menyn**

I `app/components/page-container.tsx`: byt `max-w-4xl` mot `max-w-5xl`.

- [ ] **Step 3: "Så funkar det" och systemstatus får `PageHeader`**

I `app/sa-funkar-det/page.tsx`: ta bort `<header className="pb-4">…</header>` (etiketten "Om sajten", `h1` "Så funkar det" och ingresstexten). Rendera i stället, före `PageContainer`, `<PageHeader kicker="Om sajten" title="Så funkar det">` med samma ingresstext som barn. Omslut sidan i ett fragment (`<>…</>`) och lägg sektionerna inuti `PageContainer` i en `<div className="mx-auto max-w-3xl">`.

I `app/systemstatus/page.tsx`: gör motsvarande med `<header className="pt-2">…</header>` → `<PageHeader kicker="Live från servern" title="Systemstatus">` med samma ingresstext; resten ligger kvar i `PageContainer`.

- [ ] **Step 4: Systemstatus-lintfelet**

I `app/systemstatus/page.tsx`, `JobCard` räknar `Date.now()` direkt i renderingen (lintregeln "impure function during render"). Flytta beräkningen till en hjälpfunktion på modulnivå:

```tsx
/** Kördes jobbet inom den senaste halvtimmen? */
function isFresh(lastRun: Date | null): boolean {
  return lastRun != null && Date.now() - lastRun.getTime() < 30 * 60_000;
}
```

och använd `const fresh = isFresh(lastRun);` i `JobCard`.

- [ ] **Step 5: Byt gamla klasser mot nya tokens**

I `app/sa-funkar-det/page.tsx`, `app/systemstatus/page.tsx` och `app/not-found.tsx`, ersätt enligt tabellen (även med opacitet, t.ex. `border-neutral-800/60` → `border-line`, och med `hover:`/`group-hover:`-prefix):

| Gammal | Ny |
|---|---|
| `text-neutral-50`, `-100`, `-200`, `-300` | `text-ink` |
| `text-neutral-400`, `-500`, `-600`, `-700` | `text-ink-muted` |
| `bg-neutral-950` | `bg-surface` |
| `bg-neutral-900` | `bg-surface-raised` |
| `bg-neutral-800` (alla opaciteter) | `bg-line` |
| `bg-neutral-600` | `bg-ink-muted` |
| `border-neutral-*`, `divide-neutral-*` | `border-line`, `divide-line` |
| `text-emerald-*` på etiketter/siffror | `text-ink` (lägg till `font-semibold` om texten ska sticka ut) |
| `hover:text-emerald-*` på länkar | `hover:text-ink` + länken får `underline decoration-accent decoration-2 underline-offset-2` |
| `border-emerald-*` / `hover:border-emerald-*` | `border-line` / `hover:border-ink-muted` |
| `bg-emerald-*` / `hover:bg-emerald-*` | `bg-surface-raised` / `hover:bg-surface-raised` |
| `bg-brand` (alla opaciteter) | `bg-accent` (med `text-ink`/`text-surface-dark` på text ovanpå) |
| `border-brand/*` | `border-accent` |
| `font-mono` | tas bort; lägg till `tabular-nums` där innehållet är siffror/tider |

Etiketter som tidigare var `font-mono text-xs uppercase tracking-widest` blir `font-display text-sm font-bold uppercase tracking-wide text-ink-muted`. `h1` i `app/not-found.tsx` blir `font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl`.

Run: `grep -rnE "neutral-|emerald-|brand|font-mono|rose-|red-500" app`
Expected: inga träffar (utom inga — alla ska vara borta).

- [ ] **Step 6: Ta bort gamla tokens och Geist Mono**

I `app/globals.css`:
- Ta bort alla `--color-neutral-*`, `--color-emerald-*` och `--color-brand` ur `@theme` samt kommentarerna som bara beskriver dem (behåll de nya tokens och kommentaren om dem, men ta bort meningen om att de gamla tas bort i steg 4).
- Ta bort `--font-mono: var(--font-geist-mono);` ur `@theme inline` och regeln `.font-mono { … }`.
- Behåll `::selection` och den globala `:focus-visible`-regeln.

I `app/layout.tsx`: ta bort `Geist_Mono` ur importen, konstanten `geistMono` och `${geistMono.variable}` ur `<html className>`.

Run: `grep -rnE "geist-mono|Geist_Mono|--color-(neutral|emerald|brand)" app`
Expected: inga träffar.

- [ ] **Step 7: Kontroller**

Run: `npx tsc --noEmit && npm test`
Expected: inga typfel, alla tester PASS.

Run: `npx eslint app lib instrumentation.ts`
Expected: bara `lib/goals.ts` oanvänd `now` (varning); systemstatus-felet är borta.

- [ ] **Step 8: Commit**

```bash
git add app/components/page-header.tsx app/components/page-container.tsx app/sa-funkar-det/page.tsx app/systemstatus/page.tsx app/not-found.tsx app/globals.css app/layout.tsx
git commit -m "feat: new style for info pages, remove legacy color tokens and Geist Mono"
```

- [ ] **Step 9 (controller): Visuell kontroll och bygge**

Controllern (inte implementeraren) kontrollerar `/`, `/serie/eswidget-144587`, `/lag/ifk-vastervik`, `/lag/vasterviks-dam`, `/lag/finns-inte` (404), `/sa-funkar-det`, `/systemstatus` på dator och 375 px, konsolen utan nya fel, och kör `npx next build` med dev-servern stoppad.
