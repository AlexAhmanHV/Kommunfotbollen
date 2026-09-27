# Redesign steg 1: visuell grund + startsida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ge Kommunfotbollen en "matchdag"-design: mörk matchdagszon överst på startsidan (veckans match, omgången, lokala lag) och ljusa läszoner under (nyheter, serier, poddar), plus ett gemensamt visuellt system (färger, typsnitt, navigering, sidfot, matchlista).

**Architecture:** Ren logik i `lib/matchday.ts` (urval av veckans match, lägen, lagsammanfattningar) med `now` som parameter och enhetstester. Startsidan (`app/page.tsx`) hämtar data och sätter ihop nya komponenter i `app/components/home/`. Nya namngivna färgtokens läggs bredvid de gamla omskrivna Tailwind-färgerna, som andra sidor fortfarande använder.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, Tailwind CSS v4 (`@theme`), Drizzle ORM + Postgres (Supabase), `next/font/google`, Nodes testkörare via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-27-redesign-steg1-design.md`

## Global Constraints

- Signaturfärg `accent` = `#c6f432`. Får vara **text** på mörka ytor, bara **fyllning** på ljusa (med `ink`-text ovanpå).
- Mörka tokens: `surface-dark #0e1116`, `surface-dark-raised #171b22`, `line-dark #2a2f38`, `on-dark #f2f2f0`, `on-dark-muted #9aa0a8`. Ljusa: `surface #f4f2f2`, `surface-raised #fbfafa`, `line #e4e2e3`, `ink #1d2128`, `ink-muted #565459`. Formruta "O": `form-draw #4a515c`.
- Typsnitt: **Barlow Condensed** (600/700/800) för lagnamn, siffror, sektionsrubriker, lagetiketter, toppnyhetens rubrik (Tailwind-klass `font-display`). **Geist** för brödtext. Geist Mono används inte i ny kod.
- Lokala lag markeras med fetstil (inte teal-text, inget grönt streck).
- De gamla tokens (`neutral-*`, `emerald-*`, `brand` i `app/globals.css`) **tas inte bort** i det här steget; ny kod använder dem inte.
- Veckans match: fönster 7 dagar. Derby (båda lagen lokala) vinner, flera derbyn → tidigast. Annars bästa (lägsta) tabellplacering för ett lokalt lag, lika → tidigast avspark.
- Lägen: `upcoming` → `recent` → `offseason` enligt specens tabell. Matcher där `isResultMissing` är sann räknas inte.
- Arena visas inte (finns inte i datan).
- All text i gränssnittet på svenska.
- Ingen query-parameter för att framkalla lägen; bara miljövariabeln `MATCHDAY_NOW`, lokalt.
- Kör aldrig två Next.js dev-servrar samtidigt på maskinen (har frusit datorn tidigare). Stoppa en innan en annan startas.

## File Structure

| Fil | Ansvar |
|---|---|
| `lib/matchday.ts` (ny) | Ren logik: `isResultMissing`, `matchdayMode`, `pickFeatured`, `teamSummaries` |
| `lib/matchday.test.ts` (ny) | Enhetstester för ovan |
| `lib/queries.ts` (ändras) | `UiMatch` får `leagueId`/`leagueName`; `isResultMissing` flyttas till `lib/matchday.ts` och återexporteras |
| `package.json` (ändras) | Script `test` |
| `app/globals.css` (ändras) | Nya färgtokens + `font-display` |
| `app/layout.tsx` (ändras) | Barlow Condensed, mörk header, `<main>` utan behållare, `SiteFooter` |
| `app/components/page-container.tsx` (ny) | Standardbehållaren (`max-w-4xl`) som tidigare låg i `<main>` |
| `app/components/site-footer.tsx` (ny) | Mörk sidfot |
| `app/components/site-nav.tsx` (skrivs om) | Mörk navigering med nya länkar |
| `app/components/section-heading.tsx` (skrivs om) | Barlow-versaler med grönt streck, ljus/mörk ton |
| `app/components/team-crest.tsx` (ändras) | Monogram i ny stil |
| `app/components/match-list.tsx` (skrivs om) | Matchlistan i ny stil |
| `app/serie/[id]/page.tsx`, `app/sa-funkar-det/page.tsx`, `app/systemstatus/page.tsx`, `app/not-found.tsx` (ändras) | Rot-elementet blir `PageContainer` |
| `app/components/home/matchday-hero.tsx` (ny) | Veckans match / senaste omgången / säsongen slut |
| `app/components/home/round-strip.tsx` (ny) | Omgångens övriga lokala matcher |
| `app/components/home/team-grid.tsx` (ny) | Lagkorten (`TeamGrid` + `TeamCard`) |
| `app/components/home/news-feed.tsx` (ny) | Toppnyhet i mörkt kort + lista |
| `app/components/home/sidebar.tsx` (ny) | Serier + poddar |
| `app/page.tsx` (skrivs om) | Datahämtning + sammansättning |

---

### Task 1: Matchdagslogik med tester

**Files:**
- Create: `lib/matchday.ts`
- Create: `lib/matchday.test.ts`
- Modify: `lib/queries.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `UiMatch` från `lib/queries.ts` (utökas i detta task med `leagueId: string; leagueName: string`).
- Produces (i `lib/matchday.ts`):
  - `type Standing = { position: number; pts: number }`
  - `type MatchdayMode = "upcoming" | "recent" | "offseason"`
  - `type FormLetter = "V" | "O" | "F"`
  - `type LocalTeamRow = { teamId: string; name: string; logoUrl: string | null; leagueId: string | null; leagueName: string | null; position: number | null; pts: number | null }`
  - `type TeamSummary = LocalTeamRow & { form: FormLetter[]; next: { startsAt: Date; home: boolean; opponent: string } | null }`
  - `isResultMissing(m: Pick<UiMatch, "status" | "startsAt">, now?: Date): boolean`
  - `matchdayMode(matches: UiMatch[], localIds: ReadonlySet<string>, now: Date): { mode: MatchdayMode; matches: UiMatch[] }` — returnerade matcher är sorterade efter avspark, stigande.
  - `pickFeatured(matches: UiMatch[], standings: ReadonlyMap<string, Standing>, localIds: ReadonlySet<string>): UiMatch | null`
  - `teamSummaries(teams: LocalTeamRow[], matches: UiMatch[], now: Date): TeamSummary[]`
- `lib/queries.ts` fortsätter exportera `isResultMissing` (återexport), så befintliga importer fungerar.

- [ ] **Step 1: Lägg till testscript i `package.json`**

Ändra `"scripts"` till:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "tsx --test \"lib/**/*.test.ts\""
  },
```

- [ ] **Step 2: Utöka `UiMatch` och `getMatches` i `lib/queries.ts` med serie**

Ersätt hela filen `lib/queries.ts` med:

```ts
import { alias } from "drizzle-orm/pg-core";
import { asc, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "./db/client";
import { groups, leagues, matches, teams } from "./db/schema";

export type UiMatch = {
  id: string;
  round: number | null;
  startsAt: Date;
  status: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  homeScore: number | null;
  awayScore: number | null;
  leagueId: string;
  leagueName: string;
};

// Flyttad till lib/matchday.ts (ren logik, testbar); återexporteras så att
// befintliga importer fungerar.
export { isResultMissing } from "./matchday";

const home = alias(teams, "home");
const away = alias(teams, "away");

export async function getMatches(opts: {
  where?: SQL;
  order?: "asc" | "desc";
  limit?: number;
}): Promise<UiMatch[]> {
  const db = await getDb();
  let q = db
    .select({
      id: matches.id,
      round: matches.round,
      startsAt: matches.startsAt,
      status: matches.status,
      homeId: matches.homeTeamId,
      awayId: matches.awayTeamId,
      homeName: home.name,
      awayName: away.name,
      homeLogo: home.logoUrl,
      awayLogo: away.logoUrl,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      leagueId: leagues.id,
      leagueName: leagues.name,
    })
    .from(matches)
    .innerJoin(home, eq(matches.homeTeamId, home.id))
    .innerJoin(away, eq(matches.awayTeamId, away.id))
    .innerJoin(groups, eq(matches.groupId, groups.id))
    .innerJoin(leagues, eq(groups.leagueId, leagues.id))
    .orderBy(opts.order === "desc" ? desc(matches.startsAt) : asc(matches.startsAt))
    .$dynamic();
  if (opts.where) q = q.where(opts.where);
  if (opts.limit) q = q.limit(opts.limit);
  return q;
}
```

- [ ] **Step 3: Skriv testerna (`lib/matchday.test.ts`)**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UiMatch } from "./queries";
import {
  isResultMissing,
  matchdayMode,
  pickFeatured,
  teamSummaries,
  type LocalTeamRow,
  type Standing,
} from "./matchday";

const NOW = new Date("2026-10-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const LOCAL = new Set(["L1", "L2"]);

let seq = 0;
function match(p: Partial<UiMatch>): UiMatch {
  seq++;
  return {
    id: `m${seq}`,
    round: null,
    startsAt: at(1),
    status: "UPCOMING",
    homeId: "X1",
    awayId: "X2",
    homeName: "Hemma",
    awayName: "Borta",
    homeLogo: null,
    awayLogo: null,
    homeScore: null,
    awayScore: null,
    leagueId: "lg",
    leagueName: "Division 4 Småland norra",
    ...p,
  };
}

describe("isResultMissing", () => {
  it("kommande match mer än ett dygn efter avspark saknar resultat", () => {
    assert.equal(isResultMissing(match({ startsAt: at(-2) }), NOW), true);
  });
  it("kommande match mindre än ett dygn efter avspark saknar inte resultat än", () => {
    assert.equal(isResultMissing(match({ startsAt: at(-0.5) }), NOW), false);
  });
  it("spelad match saknar aldrig resultat", () => {
    assert.equal(isResultMissing(match({ status: "FINISHED", startsAt: at(-3) }), NOW), false);
  });
});

describe("matchdayMode", () => {
  it("upcoming när en lokal match spelas inom 7 dagar", () => {
    const local = match({ homeId: "L1", startsAt: at(3) });
    const other = match({ startsAt: at(2) });
    const r = matchdayMode([other, local], LOCAL, NOW);
    assert.equal(r.mode, "upcoming");
    assert.deepEqual(r.matches.map((m) => m.id), [local.id]);
  });
  it("exakt 7 dagar fram räknas, en millisekund till gör det inte", () => {
    const edge = match({ homeId: "L1", startsAt: at(7) });
    assert.equal(matchdayMode([edge], LOCAL, NOW).mode, "upcoming");
    const beyond = match({ homeId: "L1", startsAt: new Date(at(7).getTime() + 1) });
    assert.equal(matchdayMode([beyond], LOCAL, NOW).mode, "offseason");
  });
  it("upcoming sorteras efter avspark", () => {
    const later = match({ homeId: "L1", startsAt: at(5) });
    const sooner = match({ awayId: "L2", startsAt: at(1) });
    const r = matchdayMode([later, sooner], LOCAL, NOW);
    assert.deepEqual(r.matches.map((m) => m.id), [sooner.id, later.id]);
  });
  it("recent när inget är kommande men en lokal match spelats senaste 7 dagarna", () => {
    const played = match({ homeId: "L1", status: "FINISHED", startsAt: at(-2), homeScore: 2, awayScore: 1 });
    const r = matchdayMode([played], LOCAL, NOW);
    assert.equal(r.mode, "recent");
    assert.deepEqual(r.matches.map((m) => m.id), [played.id]);
  });
  it("exakt 7 dagar bakåt räknas, en millisekund till gör det inte", () => {
    const edge = match({ homeId: "L1", status: "FINISHED", startsAt: at(-7), homeScore: 0, awayScore: 0 });
    assert.equal(matchdayMode([edge], LOCAL, NOW).mode, "recent");
    const older = match({ homeId: "L1", status: "FINISHED", startsAt: new Date(at(-7).getTime() - 1), homeScore: 0, awayScore: 0 });
    assert.equal(matchdayMode([older], LOCAL, NOW).mode, "offseason");
  });
  it("matcher utan resultat räknas inte", () => {
    const missing = match({ homeId: "L1", startsAt: at(-3) });
    assert.equal(matchdayMode([missing], LOCAL, NOW).mode, "offseason");
  });
  it("offseason utan lokala matcher", () => {
    const r = matchdayMode([], LOCAL, NOW);
    assert.equal(r.mode, "offseason");
    assert.deepEqual(r.matches, []);
  });
});

describe("pickFeatured", () => {
  const standings = new Map<string, Standing>([
    ["L1", { position: 6, pts: 27 }],
    ["L2", { position: 1, pts: 48 }],
  ]);

  it("derby vinner över bättre placerat lag", () => {
    const derby = match({ homeId: "L1", awayId: "L2", startsAt: at(5) });
    const top = match({ homeId: "L2", startsAt: at(1) });
    assert.equal(pickFeatured([top, derby], standings, LOCAL)?.id, derby.id);
  });
  it("flera derbyn: det tidigaste", () => {
    const late = match({ homeId: "L1", awayId: "L2", startsAt: at(6) });
    const early = match({ homeId: "L2", awayId: "L1", startsAt: at(2) });
    assert.equal(pickFeatured([late, early], standings, LOCAL)?.id, early.id);
  });
  it("utan derby: bäst placerade lokala laget", () => {
    const l1 = match({ homeId: "L1", startsAt: at(1) });
    const l2 = match({ awayId: "L2", startsAt: at(4) });
    assert.equal(pickFeatured([l1, l2], standings, LOCAL)?.id, l2.id);
  });
  it("lika placering: tidigast avspark", () => {
    const same = new Map<string, Standing>([
      ["L1", { position: 3, pts: 20 }],
      ["L2", { position: 3, pts: 20 }],
    ]);
    const later = match({ homeId: "L1", startsAt: at(4) });
    const sooner = match({ awayId: "L2", startsAt: at(2) });
    assert.equal(pickFeatured([later, sooner], same, LOCAL)?.id, sooner.id);
  });
  it("lag utan tabellrad hamnar efter lag med placering", () => {
    const unplaced = match({ homeId: "L1", startsAt: at(1) });
    const placed = match({ awayId: "L2", startsAt: at(3) });
    const only = new Map<string, Standing>([["L2", { position: 9, pts: 5 }]]);
    assert.equal(pickFeatured([unplaced, placed], only, LOCAL)?.id, placed.id);
  });
  it("inga matcher ger null", () => {
    assert.equal(pickFeatured([], standings, LOCAL), null);
  });
});

describe("teamSummaries", () => {
  const teams: LocalTeamRow[] = [
    { teamId: "L1", name: "Ankarsrums IS", logoUrl: null, leagueId: "lg", leagueName: "Div 6", position: 9, pts: 12 },
    { teamId: "L2", name: "Gunnebo IF", logoUrl: null, leagueId: "lg", leagueName: "Div 6", position: 1, pts: 41 },
    { teamId: "L3", name: "Blackstads IF", logoUrl: null, leagueId: null, leagueName: null, position: null, pts: null },
  ];

  it("form: fem senaste spelade, äldst först, ur lagets perspektiv", () => {
    const played = [
      match({ homeId: "L1", status: "FINISHED", startsAt: at(-30), homeScore: 5, awayScore: 0 }), // för gammal (6:e)
      match({ homeId: "L1", status: "FINISHED", startsAt: at(-25), homeScore: 1, awayScore: 0 }), // V
      match({ awayId: "L1", status: "FINISHED", startsAt: at(-20), homeScore: 2, awayScore: 0 }), // F (borta)
      match({ homeId: "L1", status: "FINISHED", startsAt: at(-15), homeScore: 1, awayScore: 1 }), // O
      match({ awayId: "L1", status: "FINISHED", startsAt: at(-10), homeScore: 0, awayScore: 3 }), // V (borta)
      match({ homeId: "L1", status: "FINISHED", startsAt: at(-5), homeScore: 0, awayScore: 1 }), // F
    ];
    const l1 = teamSummaries(teams, played, NOW).find((t) => t.teamId === "L1");
    assert.deepEqual(l1?.form, ["V", "F", "O", "V", "F"]);
  });
  it("nästa match: tidigaste kommande, hemma/borta och motståndare", () => {
    const later = match({ homeId: "L1", awayName: "Storebro IF", startsAt: at(9) });
    const next = match({ awayId: "L1", homeName: "Gunnebo IF", startsAt: at(2) });
    const l1 = teamSummaries(teams, [later, next], NOW).find((t) => t.teamId === "L1");
    assert.deepEqual(l1?.next, { startsAt: next.startsAt, home: false, opponent: "Gunnebo IF" });
  });
  it("lag utan kommande match får next = null", () => {
    const l2 = teamSummaries(teams, [], NOW).find((t) => t.teamId === "L2");
    assert.equal(l2?.next, null);
    assert.deepEqual(l2?.form, []);
  });
  it("sorteras efter placering, lag utan placering sist", () => {
    assert.deepEqual(
      teamSummaries(teams, [], NOW).map((t) => t.teamId),
      ["L2", "L1", "L3"],
    );
  });
});
```

- [ ] **Step 4: Kör testerna och se dem misslyckas**

Run: `npm test`
Expected: FAIL — `Cannot find module './matchday'` (eller motsvarande ERR_MODULE_NOT_FOUND).

- [ ] **Step 5: Implementera `lib/matchday.ts`**

```ts
import type { UiMatch } from "./queries";

// Ren logik för startsidans matchdagszon — ingen databas, ingen rendering.
// `now` skickas alltid in, så att allt kan testas och lägena kan framkallas
// lokalt med MATCHDAY_NOW.

export type Standing = { position: number; pts: number };
export type MatchdayMode = "upcoming" | "recent" | "offseason";
export type FormLetter = "V" | "O" | "F";

export type LocalTeamRow = {
  teamId: string;
  name: string;
  logoUrl: string | null;
  leagueId: string | null;
  leagueName: string | null;
  position: number | null;
  pts: number | null;
};

export type TeamSummary = LocalTeamRow & {
  form: FormLetter[];
  next: { startsAt: Date; home: boolean; opponent: string } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 7 * DAY_MS;
const FORM_LENGTH = 5;

const byStart = (a: UiMatch, b: UiMatch) => a.startsAt.getTime() - b.startsAt.getTime();

/** Står som kommande ett dygn efter avspark: källan har inget resultat. */
export function isResultMissing(
  m: Pick<UiMatch, "status" | "startsAt">,
  now: Date = new Date(),
): boolean {
  return m.status === "UPCOMING" && m.startsAt.getTime() < now.getTime() - DAY_MS;
}

function isLocalMatch(m: UiMatch, localIds: ReadonlySet<string>): boolean {
  return localIds.has(m.homeId) || localIds.has(m.awayId);
}

function isDerby(m: UiMatch, localIds: ReadonlySet<string>): boolean {
  return localIds.has(m.homeId) && localIds.has(m.awayId);
}

/** Vad matchdagszonen ska visa: kommande omgång, senaste omgången eller säsongsuppehåll. */
export function matchdayMode(
  matches: UiMatch[],
  localIds: ReadonlySet<string>,
  now: Date,
): { mode: MatchdayMode; matches: UiMatch[] } {
  const t = now.getTime();
  const local = matches.filter((m) => isLocalMatch(m, localIds) && !isResultMissing(m, now));

  const upcoming = local
    .filter(
      (m) =>
        (m.status === "UPCOMING" || m.status === "ONGOING") &&
        m.startsAt.getTime() <= t + WINDOW_MS,
    )
    .sort(byStart);
  if (upcoming.length > 0) return { mode: "upcoming", matches: upcoming };

  const recent = local
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        m.startsAt.getTime() <= t &&
        m.startsAt.getTime() >= t - WINDOW_MS,
    )
    .sort(byStart);
  if (recent.length > 0) return { mode: "recent", matches: recent };

  return { mode: "offseason", matches: [] };
}

/** Veckans match: derby först (tidigast), annars bäst placerade lokala laget (lika → tidigast). */
export function pickFeatured(
  matches: UiMatch[],
  standings: ReadonlyMap<string, Standing>,
  localIds: ReadonlySet<string>,
): UiMatch | null {
  if (matches.length === 0) return null;

  const derbies = matches.filter((m) => isDerby(m, localIds)).sort(byStart);
  if (derbies.length > 0) return derbies[0];

  const bestLocalPosition = (m: UiMatch) =>
    Math.min(
      ...[m.homeId, m.awayId]
        .filter((id) => localIds.has(id))
        .map((id) => standings.get(id)?.position ?? Infinity),
    );
  // Infinity - Infinity = NaN, som är falskt → faller igenom till avspark.
  return [...matches].sort(
    (a, b) => bestLocalPosition(a) - bestLocalPosition(b) || byStart(a, b),
  )[0];
}

/** Lagkorten: form (fem senaste, äldst först) och nästa match, sorterat efter placering. */
export function teamSummaries(
  teams: LocalTeamRow[],
  matches: UiMatch[],
  now: Date,
): TeamSummary[] {
  const t = now.getTime();
  const summaries = teams.map((team): TeamSummary => {
    const own = matches.filter((m) => m.homeId === team.teamId || m.awayId === team.teamId);

    const form = own
      .filter((m) => m.status === "FINISHED" && m.homeScore != null && m.awayScore != null)
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .slice(0, FORM_LENGTH)
      .map((m): FormLetter => {
        const home = m.homeId === team.teamId;
        const gf = home ? m.homeScore! : m.awayScore!;
        const ga = home ? m.awayScore! : m.homeScore!;
        return gf > ga ? "V" : gf < ga ? "F" : "O";
      })
      .reverse();

    const nextMatch = own
      .filter((m) => m.status === "UPCOMING" && m.startsAt.getTime() >= t)
      .sort(byStart)[0];
    const next = nextMatch
      ? {
          startsAt: nextMatch.startsAt,
          home: nextMatch.homeId === team.teamId,
          opponent: nextMatch.homeId === team.teamId ? nextMatch.awayName : nextMatch.homeName,
        }
      : null;

    return { ...team, form, next };
  });

  return summaries.sort(
    (a, b) =>
      (a.position ?? Infinity) - (b.position ?? Infinity) || a.name.localeCompare(b.name, "sv"),
  );
}
```

- [ ] **Step 6: Kör testerna och se dem gå igenom**

Run: `npm test`
Expected: PASS — alla tester i `isResultMissing`, `matchdayMode`, `pickFeatured`, `teamSummaries`, `# fail 0`.

- [ ] **Step 7: Typkontroll**

Run: `npx tsc --noEmit`
Expected: inga fel (sidor som använder `getMatches` får bara nya fält).

- [ ] **Step 8: Commit**

```bash
git add package.json lib/matchday.ts lib/matchday.test.ts lib/queries.ts
git commit -m "feat: matchday logic for the home page (featured match, modes, team summaries) with tests"
```

---

### Task 2: Visuell grund (tokens, typsnitt, layout, nav, sidfot, rubriker, emblem, matchlista)

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Create: `app/components/page-container.tsx`
- Create: `app/components/site-footer.tsx`
- Rewrite: `app/components/site-nav.tsx`
- Rewrite: `app/components/section-heading.tsx`
- Modify: `app/components/team-crest.tsx`
- Rewrite: `app/components/match-list.tsx`
- Modify: `app/serie/[id]/page.tsx`, `app/sa-funkar-det/page.tsx`, `app/systemstatus/page.tsx`, `app/not-found.tsx`, `app/page.tsx` (bara rot-elementet / en rubrik)

**Interfaces:**
- Consumes: `UiMatch`, `isResultMissing` från `@/lib/queries` (Task 1).
- Produces:
  - Tailwind-klasser: `bg-surface-dark`, `bg-surface-dark-raised`, `bg-line-dark`, `text-on-dark`, `text-on-dark-muted`, `bg-surface`, `bg-surface-raised`, `border-line`, `divide-line`, `text-ink`, `text-ink-muted`, `bg-accent`, `text-accent`, `bg-form-draw`, `font-display`.
  - `PageContainer({ children, className? })`
  - `SiteFooter()`
  - `SectionHeading({ children, count?, tone?: "light" | "dark" })` — `variant`-propen finns inte längre.
  - `TeamCrest({ name, logoUrl?, size? })` (oförändrad signatur)
  - `MatchList({ matches }: { matches: UiMatch[] })` (oförändrad signatur)

- [ ] **Step 1: Nya färgtokens och display-typsnitt i `app/globals.css`**

Lägg till följande rader **sist i det första `@theme { ... }`-blocket** (direkt efter raden `--color-brand: #ff9e20;`):

```css

  /* Redesign steg 1: namngivna färger. De omskrivna neutral/emerald/brand
     ovan används fortfarande av seriesidan, "Så funkar det" och systemstatus
     och tas bort i steg 4. Ny kod använder bara dessa. */
  --color-surface-dark: #0e1116;
  --color-surface-dark-raised: #171b22;
  --color-line-dark: #2a2f38;
  --color-on-dark: #f2f2f0;
  --color-on-dark-muted: #9aa0a8;
  --color-surface: #f4f2f2;
  --color-surface-raised: #fbfafa;
  --color-line: #e4e2e3;
  --color-ink: #1d2128;
  --color-ink-muted: #565459;
  --color-accent: #c6f432; /* text på mörkt, bara fyllning på ljust */
  --color-form-draw: #4a515c;
```

Och i `@theme inline { ... }`-blocket, lägg till raden efter `--font-mono: var(--font-geist-mono);`:

```css
  --font-display: var(--font-barlow-condensed);
```

- [ ] **Step 2: Skapa `app/components/page-container.tsx`**

```tsx
// Standardbehållaren med lugn läsbredd som tidigare låg i <main> i layouten.
// Startsidan har egna zoner som går kant i kant och använder den inte.
export function PageContainer({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-4xl px-4 py-8 ${className}`}>{children}</div>;
}
```

- [ ] **Step 3: Skapa `app/components/site-footer.tsx`**

```tsx
import Image from "next/image";

export function SiteFooter() {
  return (
    <footer className="border-t border-line-dark bg-surface-dark py-8 text-on-dark">
      <div className="mx-auto flex max-w-5xl items-center justify-center px-4">
        <a
          href="https://alexahman.se"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-2 text-on-dark-muted transition-colors hover:text-on-dark"
        >
          <Image
            src="/alexahman-logo.svg"
            alt="AlexAhman"
            width={28}
            height={28}
            className="rounded-md"
          />
          <span className="text-xs">Skapad av AlexAhman</span>
        </a>
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Skriv om `app/components/site-nav.tsx`**

Ersätt hela filen med:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TeamCrest } from "./team-crest";

type League = { id: string; name: string };
type Team = { id: string; name: string; leagueId: string; logoUrl: string | null };

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="transition-transform duration-200 group-aria-expanded:rotate-180"
      aria-hidden
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SiteNav({ leagues, teams }: { leagues: League[]; teams: Team[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(null);
        setMobileOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const close = () => {
    setOpen(null);
    setMobileOpen(false);
  };

  // Gemensam stil: grön understrykning vid hover/öppen meny.
  const itemCls =
    "group relative inline-flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wide text-on-dark-muted transition-colors hover:text-on-dark aria-expanded:text-on-dark";
  const underline =
    "after:absolute after:-bottom-1.5 after:left-0 after:h-0.5 after:w-full after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-200 group-hover:after:scale-x-100 group-aria-expanded:after:scale-x-100";

  const leagueItems = leagues.map((l) => ({ label: l.name, href: `/serie/${l.id}` }));

  return (
    <nav ref={ref} className="flex items-center gap-4">
      {/* Desktop */}
      <div className="hidden items-center gap-6 md:flex">
        <Dropdown
          id="serier"
          label="Serier"
          open={open === "serier"}
          onToggle={() => setOpen(open === "serier" ? null : "serier")}
          itemCls={itemCls}
          underline={underline}
        >
          {leagueItems.map((l) => (
            <DropdownLink key={l.href} href={l.href} onClick={close}>
              {l.label}
            </DropdownLink>
          ))}
        </Dropdown>

        <Dropdown
          id="lag"
          label="Lag"
          open={open === "lag"}
          onToggle={() => setOpen(open === "lag" ? null : "lag")}
          itemCls={itemCls}
          underline={underline}
          wide
        >
          {teams.map((t) => (
            <DropdownLink key={t.id} href={`/serie/${t.leagueId}`} onClick={close}>
              <span className="flex items-center gap-2.5">
                <TeamCrest name={t.name} logoUrl={t.logoUrl} size={22} />
                {t.name}
              </span>
            </DropdownLink>
          ))}
        </Dropdown>

        <Link href="/#nyheter" onClick={close} className={`${itemCls} ${underline}`}>
          Nyheter
        </Link>

        <Link href="/#poddar" onClick={close} className={`${itemCls} ${underline}`}>
          Poddar
        </Link>

        <Dropdown
          id="om"
          label="Om"
          open={open === "om"}
          onToggle={() => setOpen(open === "om" ? null : "om")}
          itemCls={itemCls}
          underline={underline}
          align="right"
        >
          <DropdownLink href="/sa-funkar-det" onClick={close}>
            Så funkar det
          </DropdownLink>
          <DropdownLink href="/systemstatus" onClick={close}>
            Systemstatus
          </DropdownLink>
        </Dropdown>
      </div>

      {/* Mobil: hamburgare */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={mobileOpen ? "Stäng meny" : "Öppna meny"}
        aria-expanded={mobileOpen}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line-dark text-on-dark-muted transition-colors hover:text-on-dark md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          {mobileOpen ? (
            <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          ) : (
            <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {mobileOpen && (
        <div className="absolute inset-x-0 top-full border-b border-line-dark bg-surface-dark md:hidden">
          <div className="mx-auto max-w-5xl space-y-5 px-4 py-5">
            <MobileGroup label="Serier">
              {leagueItems.map((l) => (
                <MobileLink key={l.href} href={l.href} onClick={close}>
                  {l.label}
                </MobileLink>
              ))}
            </MobileGroup>
            <MobileGroup label="Lag">
              {teams.map((t) => (
                <MobileLink key={t.id} href={`/serie/${t.leagueId}`} onClick={close}>
                  <span className="flex items-center gap-2.5">
                    <TeamCrest name={t.name} logoUrl={t.logoUrl} size={20} />
                    {t.name}
                  </span>
                </MobileLink>
              ))}
            </MobileGroup>
            <div className="flex flex-col gap-3 border-t border-line-dark pt-4 font-display text-base font-bold uppercase tracking-wide">
              <Link href="/#nyheter" onClick={close} className="text-on-dark hover:text-accent">
                Nyheter
              </Link>
              <Link href="/#poddar" onClick={close} className="text-on-dark hover:text-accent">
                Poddar
              </Link>
              <Link href="/sa-funkar-det" onClick={close} className="text-on-dark hover:text-accent">
                Så funkar det
              </Link>
              <Link href="/systemstatus" onClick={close} className="text-on-dark hover:text-accent">
                Systemstatus
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

function Dropdown({
  id,
  label,
  open,
  onToggle,
  children,
  itemCls,
  underline,
  wide,
  align = "left",
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  itemCls: string;
  underline: string;
  wide?: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`menu-${id}`}
        onClick={onToggle}
        className={`${itemCls} ${underline}`}
      >
        {label}
        <Chevron />
      </button>
      {open && (
        <div
          id={`menu-${id}`}
          className={`absolute top-full z-50 mt-3 max-h-[70vh] overflow-y-auto rounded-xl border border-line-dark bg-surface-dark-raised p-1.5 shadow-xl shadow-black/30 ${
            align === "right" ? "right-0" : "left-0"
          } ${wide ? "w-64" : "w-56"}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block rounded-lg px-3 py-2 text-sm text-on-dark transition-colors hover:bg-line-dark"
    >
      {children}
    </Link>
  );
}

function MobileGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-on-dark-muted">
        {label}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function MobileLink({
  href,
  children,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} className="rounded-lg px-2 py-2 text-sm text-on-dark hover:bg-line-dark">
      {children}
    </Link>
  );
}
```

- [ ] **Step 5: Uppdatera `app/layout.tsx`**

5a. Byt typsnittsimporten (rad 2) till:

```tsx
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
```

5b. Lägg till importen efter raden `import { SiteNav } from "./components/site-nav";`:

```tsx
import { SiteFooter } from "./components/site-footer";
```

5c. Lägg till typsnittet direkt efter `const geistMono = Geist_Mono({ ... });`:

```tsx
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});
```

5d. Ersätt hela `return (...)` i `RootLayout` med:

```tsx
  return (
    <html
      lang="sv"
      className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-surface text-ink">
        <header className="sticky top-0 z-40 border-b border-line-dark bg-surface-dark text-on-dark">
          <div className="relative mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link
              href="/"
              className="flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-wide text-on-dark"
            >
              <span className="h-3.5 w-3.5 rounded-[3px] bg-accent" aria-hidden />
              Kommunfotbollen
            </Link>
            <SiteNav leagues={nav.leagues} teams={nav.teams} />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
```

5e. Ta bort `import Image from "next/image";` från `app/layout.tsx` (används inte längre där; sidfoten har egen import).

- [ ] **Step 6: Skriv om `app/components/section-heading.tsx`**

```tsx
// Sektionsrubrik: versaler i Barlow Condensed med ett kort grönt streck
// framför. `tone` väljer färg för mörk respektive ljus bakgrund.
export function SectionHeading({
  children,
  count,
  tone = "light",
}: {
  children: React.ReactNode;
  count?: React.ReactNode;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2
        className={`flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-wide ${
          dark ? "text-on-dark" : "text-ink"
        }`}
      >
        <span className="h-1 w-4 bg-accent" aria-hidden />
        {children}
      </h2>
      {count != null && (
        <span className={`text-xs ${dark ? "text-on-dark-muted" : "text-ink-muted"}`}>{count}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Monogram i ny stil i `app/components/team-crest.tsx`**

7a. Ändra kommentaren överst (raderna 3–5) till:

```tsx
// Lagemblem: riktig Everysport-logo när den finns, annars ett monogram med
// lagets initialer. Garanterar att varje lag har ett konsekvent märke utan
// trasiga bilder eller licensproblem.
```

7b. I logo-grenen, byt `ring-1 ring-neutral-800` mot `ring-1 ring-line`.

7c. Ersätt monogrammets `className` (i sista `return`) med:

```tsx
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-line-dark font-display font-bold text-on-dark"
```

- [ ] **Step 8: Skriv om `app/components/match-list.tsx`**

```tsx
import { isResultMissing, type UiMatch } from "@/lib/queries";
import { isLocalTeam } from "@/lib/local-teams";
import { getGoalsByMatch } from "@/lib/goals";
import { TeamCrest } from "./team-crest";

const dateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

// Flera mål av samma spelare slås ihop: "Albin Kito, Albin Kito" → "Albin Kito (2)",
// och den som gjort flest mål listas först.
function formatScorers(players: string[]): string {
  const counts = new Map<string, number>();
  for (const p of players) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name} (${n})` : name))
    .join(", ");
}

// Lagnamn; lokala lag i fetstil med ett kort grönt streck framför.
function TeamName({ id, name, align }: { id: string; name: string; align: "left" | "right" }) {
  const local = isLocalTeam(id);
  return (
    <span
      className={`flex min-w-0 items-center gap-1.5 ${align === "right" ? "justify-end" : ""} ${
        local ? "font-semibold text-ink" : "text-ink"
      }`}
    >
      {local && <span className="h-3 w-1 shrink-0 rounded-sm bg-accent" aria-hidden />}
      <span className="truncate">{name}</span>
    </span>
  );
}

export async function MatchList({ matches }: { matches: UiMatch[] }) {
  if (matches.length === 0) {
    return <p className="text-sm text-ink-muted">Inga matcher.</p>;
  }

  const finishedIds = matches
    .filter((m) => m.status === "FINISHED")
    .map((m) => m.id);
  const goals = await getGoalsByMatch(finishedIds);

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-raised">
      {matches.map((m) => {
        const g = goals.get(m.id);
        const resultMissing = isResultMissing(m);
        const homeScorers = g?.filter((x) => x.teamId === m.homeId).map((x) => x.player) ?? [];
        const awayScorers = g?.filter((x) => x.teamId === m.awayId).map((x) => x.player) ?? [];
        // Målskyttar letas bara för de lokala lagens matcher — bara där är det
        // värt att säga att de saknas, så ingen tror att något är trasigt.
        const scorersMissing =
          m.status === "FINISHED" &&
          (m.homeScore ?? 0) + (m.awayScore ?? 0) > 0 &&
          homeScorers.length === 0 &&
          awayScorers.length === 0 &&
          (isLocalTeam(m.homeId) || isLocalTeam(m.awayId));
        return (
          <li key={m.id} className="px-4 py-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="w-14 shrink-0 text-xs tabular-nums text-ink-muted">
                {dateFmt.format(m.startsAt)}
              </span>
              <span className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <TeamName id={m.homeId} name={m.homeName} align="right" />
                <TeamCrest name={m.homeName} logoUrl={m.homeLogo} size={20} />
              </span>
              <span className="w-14 shrink-0 text-center font-display text-lg font-extrabold tabular-nums text-ink">
                {m.status === "FINISHED" ? (
                  `${m.homeScore}–${m.awayScore}`
                ) : resultMissing ? (
                  <span className="text-ink-muted" title="Resultat saknas">–</span>
                ) : m.status === "ONGOING" ? (
                  <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-ink">
                    live
                  </span>
                ) : (
                  <span className="text-base font-bold text-ink-muted">{timeFmt.format(m.startsAt)}</span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <TeamCrest name={m.awayName} logoUrl={m.awayLogo} size={20} />
                <TeamName id={m.awayId} name={m.awayName} align="left" />
              </span>
            </div>

            {(homeScorers.length > 0 || awayScorers.length > 0) && (
              <div className="mt-1.5 flex items-start gap-3 text-[11px] leading-snug text-ink-muted">
                <span className="w-14 shrink-0" aria-hidden />
                <span className="flex-1 text-right">{formatScorers(homeScorers)}</span>
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  title="Målskyttar (från lokaltidningarnas matchreferat)"
                  aria-hidden
                />
                <span className="flex-1">{formatScorers(awayScorers)}</span>
              </div>
            )}

            {resultMissing && (
              <p className="mt-1.5 text-center text-[11px] leading-snug text-ink-muted">
                Resultat saknas
              </p>
            )}

            {scorersMissing && (
              <p className="mt-1.5 text-center text-[11px] leading-snug text-ink-muted">
                Målskyttar ej rapporterade
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 9: Lägg övriga sidor i `PageContainer`**

I var och en av filerna nedan: lägg till importen, byt det **yttersta** elementet som `export default`-funktionen returnerar mot `PageContainer` (behåll dess befintliga `className`), och byt dess avslutande `</div>` (sista `</div>` före `);` i filen) mot `</PageContainer>`.

| Fil | Import att lägga till | Yttersta element före → efter |
|---|---|---|
| `app/serie/[id]/page.tsx` | `import { PageContainer } from "../../components/page-container";` | `<div className="space-y-14">` → `<PageContainer className="space-y-14">` |
| `app/sa-funkar-det/page.tsx` | `import { PageContainer } from "../components/page-container";` | `<div className="space-y-2">` → `<PageContainer className="space-y-2">` |
| `app/systemstatus/page.tsx` | `import { PageContainer } from "../components/page-container";` | `<div className="space-y-14">` → `<PageContainer className="space-y-14">` |
| `app/not-found.tsx` | `import { PageContainer } from "./components/page-container";` | `<div className="flex min-h-[60vh] flex-col items-center justify-center text-center">` → `<PageContainer className="flex min-h-[60vh] flex-col items-center justify-center text-center">` |
| `app/page.tsx` | `import { PageContainer } from "./components/page-container";` | `<div className="space-y-14">` → `<PageContainer className="space-y-14">` (tillfälligt; startsidan skrivs om i Task 4) |

Obs för `app/serie/[id]/page.tsx` och `app/systemstatus/page.tsx`: bara det element som står direkt efter `return (` i `export default`-funktionen ska bytas, inte andra `<div className="space-y-14">` i filen.

Dessutom i `app/page.tsx`: byt `<SectionHeading variant="feature" count={`${localTeams.length} lag`}>` mot `<SectionHeading count={`${localTeams.length} lag`}>` (propen `variant` finns inte längre).

- [ ] **Step 10: Typkontroll, lint och tester**

Run: `npx tsc --noEmit && npm test`
Expected: inga typfel, alla tester PASS.

Run: `npx eslint app lib instrumentation.ts`
Expected: högst de tre befintliga problemen (`app/page.tsx` impure function, `app/systemstatus/page.tsx` impure function, `lib/goals.ts` oanvänd `now`), inga nya.

- [ ] **Step 11: Visuell kontroll**

Dev-servern för projektet körs på port 3001 (`.claude/launch.json`, namn `kommunfotboll`); starta den med preview-verktyget om den inte redan körs — aldrig en andra samtidig. Kontrollera:
- `/`: mörk header med grön markör och länkarna Serier, Lag, Nyheter, Poddar, Om; mörk sidfot; innehållet i centrerad bredd som förut.
- `/serie/eswidget-144587`: tabell och matchlista; matchlistans resultat i Barlow Condensed, lokala lag med grönt streck.
- `/sa-funkar-det`, `/systemstatus`, `/finns-inte`: samma bredd som före, inga layoutfel.
- Mobilbredd (375 px): hamburgermenyn öppnar en mörk panel.
- Konsolen: inga fel.

- [ ] **Step 12: Commit**

```bash
git add app/globals.css app/layout.tsx app/components/page-container.tsx app/components/site-footer.tsx app/components/site-nav.tsx app/components/section-heading.tsx app/components/team-crest.tsx app/components/match-list.tsx "app/serie/[id]/page.tsx" app/sa-funkar-det/page.tsx app/systemstatus/page.tsx app/not-found.tsx app/page.tsx
git commit -m "feat: visual foundation for the redesign (tokens, Barlow Condensed, dark nav and footer, match list)"
```

---

### Task 3: Den mörka zonen (veckans match, omgången, lagkort)

**Files:**
- Create: `app/components/home/matchday-hero.tsx`
- Create: `app/components/home/round-strip.tsx`
- Create: `app/components/home/team-grid.tsx`

**Interfaces:**
- Consumes: `UiMatch` (`@/lib/queries`), `MatchdayMode`, `Standing`, `TeamSummary`, `FormLetter` (`@/lib/matchday`), `TeamCrest` (`../team-crest`), tokens och `font-display` (Task 2).
- Produces:
  - `MatchdayHero({ mode, featured, standings }: { mode: MatchdayMode; featured: UiMatch | null; standings: ReadonlyMap<string, Standing> })`
  - `RoundStrip({ mode, matches }: { mode: MatchdayMode; matches: UiMatch[] })` — renderar inget om `matches` är tom.
  - `TeamGrid({ teams }: { teams: TeamSummary[] })`

Komponenterna renderas först på sidan i Task 4; det här tasket levererar dem typkontrollerade.

- [ ] **Step 1: Skapa `app/components/home/matchday-hero.tsx`**

```tsx
import type { UiMatch } from "@/lib/queries";
import type { MatchdayMode, Standing } from "@/lib/matchday";
import { TeamCrest } from "../team-crest";

const dayFmt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

function HeroTeam({
  name,
  logoUrl,
  standing,
}: {
  name: string;
  logoUrl: string | null;
  standing?: Standing;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <TeamCrest name={name} logoUrl={logoUrl} size={56} />
      <span className="font-display text-2xl font-extrabold uppercase leading-none sm:text-3xl">
        {name}
      </span>
      {standing && (
        <span className="text-xs text-on-dark-muted">
          {standing.position}:a · {standing.pts} p
        </span>
      )}
    </div>
  );
}

// Veckans match (upcoming), mest intressanta spelade matchen (recent) eller
// säsongsuppehåll (offseason). Urvalet görs i lib/matchday.ts.
export function MatchdayHero({
  mode,
  featured,
  standings,
}: {
  mode: MatchdayMode;
  featured: UiMatch | null;
  standings: ReadonlyMap<string, Standing>;
}) {
  if (mode === "offseason" || !featured) {
    return (
      <div className="py-4">
        <p className="font-display text-sm font-bold uppercase tracking-widest text-accent">
          Kommunfotbollen
        </p>
        <h1 className="mt-2 font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl">
          Säsongen är slut
        </h1>
        <p className="mt-3 max-w-xl text-on-dark-muted">
          Här är slutplaceringarna för de lokala lagen. Nästa säsong syns här så
          fort spelprogrammet är klart.
        </p>
      </div>
    );
  }

  const center =
    mode === "recent"
      ? `${featured.homeScore}–${featured.awayScore}`
      : timeFmt.format(featured.startsAt);

  return (
    <div>
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-widest text-on-dark-muted">
        <span className="rounded bg-accent px-2 py-1 font-display text-sm font-bold tracking-wide text-surface-dark">
          {mode === "recent" ? "Senaste omgången" : "Veckans match"}
        </span>
        {featured.leagueName} · {dayFmt.format(featured.startsAt)}
      </p>
      <div className="mt-6 grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <HeroTeam
          name={featured.homeName}
          logoUrl={featured.homeLogo}
          standing={standings.get(featured.homeId)}
        />
        <span className="text-center font-display text-6xl font-extrabold tabular-nums text-accent sm:text-7xl">
          {center}
        </span>
        <HeroTeam
          name={featured.awayName}
          logoUrl={featured.awayLogo}
          standing={standings.get(featured.awayId)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Skapa `app/components/home/round-strip.tsx`**

```tsx
import type { UiMatch } from "@/lib/queries";
import type { MatchdayMode } from "@/lib/matchday";

const weekdayFmt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "short",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

// "Division 4 Småland norra" → "Div 4"
function shortLeague(name: string): string {
  const m = name.match(/^Division (\d+)/);
  return m ? `Div ${m[1]}` : name;
}

// Omgångens övriga lokala matcher: tid före avspark, resultat i läget "recent".
export function RoundStrip({ mode, matches }: { mode: MatchdayMode; matches: UiMatch[] }) {
  if (matches.length === 0) return null;
  return (
    <ul className="mt-8 grid grid-cols-2 gap-2 md:grid-cols-4">
      {matches.map((m) => (
        <li key={m.id} className="rounded-lg bg-surface-dark-raised px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {m.homeName} – {m.awayName}
            </span>
            <span className="shrink-0 font-display text-lg font-extrabold tabular-nums text-accent">
              {mode === "recent"
                ? `${m.homeScore}–${m.awayScore}`
                : timeFmt.format(m.startsAt)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-on-dark-muted">
            {shortLeague(m.leagueName)} · {weekdayFmt.format(m.startsAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Skapa `app/components/home/team-grid.tsx`**

```tsx
import Link from "next/link";
import type { FormLetter, TeamSummary } from "@/lib/matchday";
import { TeamCrest } from "../team-crest";

const weekdayFmt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "short",
  timeZone: "Europe/Stockholm",
});
const dayMonthFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "numeric",
  timeZone: "Europe/Stockholm",
});

const FORM_STYLE: Record<FormLetter, string> = {
  V: "bg-accent text-surface-dark",
  O: "bg-form-draw text-on-dark",
  F: "bg-line-dark text-on-dark-muted",
};
const FORM_LABEL: Record<FormLetter, string> = { V: "Vinst", O: "Oavgjort", F: "Förlust" };

function Form({ form }: { form: FormLetter[] }) {
  if (form.length === 0) return null;
  return (
    <div
      className="mt-2 flex gap-1"
      aria-label={`Form, senaste matcherna: ${form.map((f) => FORM_LABEL[f]).join(", ")}`}
    >
      {form.map((f, i) => (
        <span
          key={i}
          title={FORM_LABEL[f]}
          className={`grid h-4 w-4 place-items-center rounded-[3px] text-[9px] font-bold ${FORM_STYLE[f]}`}
        >
          {f}
        </span>
      ))}
    </div>
  );
}

function TeamCard({ team }: { team: TeamSummary }) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <TeamCrest name={team.name} logoUrl={team.logoUrl} size={22} />
        <span className="min-w-0 truncate font-display text-base font-bold uppercase leading-none">
          {team.name}
        </span>
        <span className="ml-auto shrink-0 font-display text-2xl font-extrabold leading-none tabular-nums">
          {team.position ?? "–"}
          {team.position != null && (
            <small className="font-sans text-[10px] font-medium text-on-dark-muted">:a</small>
          )}
        </span>
      </div>
      <Form form={team.form} />
      <div className="mt-2.5 flex flex-col gap-0.5">
        {team.next ? (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">
              Nästa · {weekdayFmt.format(team.next.startsAt)} {dayMonthFmt.format(team.next.startsAt)}
            </span>
            <span className="truncate text-sm font-semibold text-on-dark">
              <span className="font-normal text-on-dark-muted">{team.next.home ? "hemma" : "borta"}</span>{" "}
              {team.next.opponent}
            </span>
          </>
        ) : (
          <span className="text-sm text-on-dark-muted">Ingen match inlagd</span>
        )}
      </div>
    </>
  );

  const cls = "block rounded-lg bg-surface-dark-raised p-3 transition-colors";
  return team.leagueId ? (
    <Link href={`/serie/${team.leagueId}`} className={`${cls} hover:bg-line-dark`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// De lokala lagen sorterade efter placering (sorteringen görs i lib/matchday.ts).
export function TeamGrid({ teams }: { teams: TeamSummary[] }) {
  if (teams.length === 0) {
    return <p className="text-sm text-on-dark-muted">Inga lag eller tabeller inlästa ännu.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {teams.map((t) => (
        <TeamCard key={t.teamId} team={t} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Typkontroll**

Run: `npx tsc --noEmit`
Expected: inga fel.

- [ ] **Step 5: Commit**

```bash
git add app/components/home/matchday-hero.tsx app/components/home/round-strip.tsx app/components/home/team-grid.tsx
git commit -m "feat: dark matchday zone components (featured match, round strip, team cards)"
```

---

### Task 4: Ljusa zonen och ny startsida

**Files:**
- Create: `app/components/home/news-feed.tsx`
- Create: `app/components/home/sidebar.tsx`
- Rewrite: `app/page.tsx`

**Interfaces:**
- Consumes: allt från Task 1–3: `matchdayMode`, `pickFeatured`, `teamSummaries`, `LocalTeamRow`, `Standing` (`@/lib/matchday`); `getMatches` (`@/lib/queries`); `MatchdayHero`, `RoundStrip`, `TeamGrid`; `SectionHeading` med `tone`; `MAX_ARTICLE_AGE_DAYS` (`@/lib/news`); `LOCAL_TEAM_IDS` (`@/lib/local-teams`).
- Produces:
  - `type NewsArticle = { id: string; title: string; summary: string | null; source: string; publishedAt: Date; teamNames: string[] }` och `NewsFeed({ articles }: { articles: NewsArticle[] })` (sektion med `id="nyheter"`)
  - `type PodEpisode = { id: string; podcast: string; title: string; durationSec: number | null; publishedAt: Date }`, `type PodcastGroup = { name: string; day: string; recent: PodEpisode[]; older: PodEpisode[] }` och `Sidebar({ leagues, podcasts }: { leagues: { id: string; name: string }[]; podcasts: PodcastGroup[] })` (poddsektion med `id="poddar"`)

- [ ] **Step 1: Skapa `app/components/home/news-feed.tsx`**

```tsx
import { SectionHeading } from "../section-heading";

export type NewsArticle = {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  publishedAt: Date;
  teamNames: string[];
};

const SHOWN = 10; // toppnyhet + 9 i listan, resten bakom "Visa äldre"

const dateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});

function Tags({ names }: { names: string[] }) {
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

function Lead({ a }: { a: NewsArticle }) {
  return (
    <a
      href={a.id}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl bg-surface-dark p-5 text-on-dark transition-colors hover:bg-surface-dark-raised"
    >
      <Tags names={a.teamNames} />
      <h3 className="mt-3 font-display text-2xl font-extrabold uppercase leading-none sm:text-3xl">
        {a.title}
      </h3>
      {a.summary && <p className="mt-3 line-clamp-3 text-sm text-on-dark-muted">{a.summary}</p>}
      <p className="mt-3 text-xs text-on-dark-muted">
        {a.source} · {dateFmt.format(a.publishedAt)}
      </p>
    </a>
  );
}

function Item({ a }: { a: NewsArticle }) {
  return (
    <li>
      <a href={a.id} target="_blank" rel="noopener noreferrer" className="group block py-3">
        <Tags names={a.teamNames} />
        <h4 className="mt-1.5 font-semibold text-ink group-hover:underline">{a.title}</h4>
        {a.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{a.summary}</p>}
        <p className="mt-1 text-xs text-ink-muted">
          {a.source} · {dateFmt.format(a.publishedAt)}
        </p>
      </a>
    </li>
  );
}

// Nyheterna om lagen: senaste som toppnyhet i ett mörkt kort, resten i lista.
export function NewsFeed({ articles }: { articles: NewsArticle[] }) {
  const [lead, ...rest] = articles;
  const list = rest.slice(0, SHOWN - 1);
  const older = rest.slice(SHOWN - 1);

  return (
    <section id="nyheter" className="scroll-mt-24">
      <SectionHeading count={articles.length > 0 ? `${articles.length} artiklar` : undefined}>
        Nyheter
      </SectionHeading>
      {!lead ? (
        <p className="text-sm text-ink-muted">Inga nyheter om lagen just nu.</p>
      ) : (
        <>
          <Lead a={lead} />
          {list.length > 0 && (
            <ul className="mt-2 divide-y divide-line">
              {list.map((a) => (
                <Item key={a.id} a={a} />
              ))}
            </ul>
          )}
          {older.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                Visa äldre nyheter ({older.length})
              </summary>
              <ul className="mt-2 divide-y divide-line">
                {older.map((a) => (
                  <Item key={a.id} a={a} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Skapa `app/components/home/sidebar.tsx`**

```tsx
import Link from "next/link";
import { SectionHeading } from "../section-heading";

export type PodEpisode = {
  id: string;
  podcast: string;
  title: string;
  durationSec: number | null;
  publishedAt: Date;
};

export type PodcastGroup = {
  name: string;
  day: string;
  recent: PodEpisode[];
  older: PodEpisode[];
};

const dateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});

function Episode({ e }: { e: PodEpisode }) {
  return (
    <li>
      <a
        href={e.id}
        target="_blank"
        rel="noopener noreferrer"
        className="group block px-3 py-2.5 transition-colors hover:bg-surface"
      >
        <span className="block text-sm font-medium text-ink group-hover:underline">{e.title}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">
          {dateFmt.format(e.publishedAt)}
          {e.durationSec ? ` · ${Math.round(e.durationSec / 60)} min` : ""}
        </span>
      </a>
    </li>
  );
}

// Sidospalten: länkar till serierna och de senaste poddavsnitten.
export function Sidebar({
  leagues,
  podcasts,
}: {
  leagues: { id: string; name: string }[];
  podcasts: PodcastGroup[];
}) {
  return (
    <aside className="space-y-10">
      <section>
        <SectionHeading>Serier</SectionHeading>
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-raised">
          {leagues.map((l) => (
            <li key={l.id}>
              <Link
                href={`/serie/${l.id}`}
                className="group flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-ink transition-colors hover:bg-surface"
              >
                <span className="font-medium">{l.name}</span>
                <span
                  className="text-ink-muted transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {podcasts.length > 0 && (
        <section id="poddar" className="scroll-mt-24">
          <SectionHeading>Poddar</SectionHeading>
          <div className="space-y-6">
            {podcasts.map((p) => (
              <div key={p.name}>
                <h3 className="mb-2 flex items-baseline gap-2">
                  <span className="font-display text-lg font-extrabold uppercase text-ink">{p.name}</span>
                  <span className="text-xs text-ink-muted">{p.day}</span>
                </h3>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-raised">
                  {p.recent.map((e) => (
                    <Episode key={e.id} e={e} />
                  ))}
                </ul>
                {p.older.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                      Visa äldre avsnitt ({p.older.length})
                    </summary>
                    <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-raised">
                      {p.older.map((e) => (
                        <Episode key={e.id} e={e} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Skriv om `app/page.tsx`**

Ersätt hela filen med:

```tsx
import { and, asc, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  articles,
  articleTeams,
  groups,
  leagues,
  matches,
  podcastEpisodes,
  tableRows,
  teams,
} from "@/lib/db/schema";
import { LOCAL_TEAM_IDS } from "@/lib/local-teams";
import {
  matchdayMode,
  pickFeatured,
  teamSummaries,
  type LocalTeamRow,
  type Standing,
} from "@/lib/matchday";
import { MAX_ARTICLE_AGE_DAYS } from "@/lib/news";
import { getMatches } from "@/lib/queries";
import { MatchdayHero } from "./components/home/matchday-hero";
import { NewsFeed, type NewsArticle } from "./components/home/news-feed";
import { RoundStrip } from "./components/home/round-strip";
import { Sidebar, type PodcastGroup } from "./components/home/sidebar";
import { TeamGrid } from "./components/home/team-grid";
import { SectionHeading } from "./components/section-heading";

// Datan ändras en gång per dygn (synken kl 22/23) — cacha sidan i stället
// för att fråga databasen vid varje besök.
export const revalidate = 60;

const PODCAST_RECENT = 3; // senaste avsnitten per podd, resten bakom "visa äldre"
const PODCASTS = [
  { name: "Nykritat", day: "torsdagar" },
  { name: "Fotbollsviken", day: "fredagar" },
] as const;

// Tiden som matchdagszonen utgår från. MATCHDAY_NOW (ISO-datum) används bara
// lokalt för att framkalla lägena "recent"/"offseason"; sätt den aldrig i Render.
function matchdayNow(): Date {
  const override = process.env.MATCHDAY_NOW;
  return override ? new Date(override) : new Date();
}

function newsCutoff(): Date {
  return new Date(Date.now() - MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000);
}

export default async function Home() {
  const db = await getDb();
  const now = matchdayNow();
  const localIds = [...LOCAL_TEAM_IDS];

  const [allLeagues, localTeamRows, standingRows, localMatches, newsRows, podRows] =
    await Promise.all([
      db.select({ id: leagues.id, name: leagues.name }).from(leagues).orderBy(asc(leagues.name)),
      db
        .select({
          teamId: teams.id,
          name: teams.name,
          logoUrl: teams.logoUrl,
          leagueId: leagues.id,
          leagueName: leagues.name,
          position: tableRows.position,
          pts: tableRows.pts,
        })
        .from(teams)
        .leftJoin(tableRows, eq(tableRows.teamId, teams.id))
        .leftJoin(groups, eq(tableRows.groupId, groups.id))
        .leftJoin(leagues, eq(groups.leagueId, leagues.id))
        .where(inArray(teams.id, localIds)),
      db
        .select({ teamId: tableRows.teamId, position: tableRows.position, pts: tableRows.pts })
        .from(tableRows),
      getMatches({
        where: or(inArray(matches.homeTeamId, localIds), inArray(matches.awayTeamId, localIds)),
        order: "asc",
      }),
      db
        .select({
          id: articles.id,
          title: articles.title,
          summary: articles.summary,
          source: articles.source,
          publishedAt: articles.publishedAt,
          teamName: teams.name,
        })
        .from(articles)
        .innerJoin(articleTeams, eq(articleTeams.articleId, articles.id))
        .innerJoin(teams, eq(articleTeams.teamId, teams.id))
        .where(
          and(
            gte(articles.publishedAt, newsCutoff()),
            // dölj AI-avvisade taggar; visa obedömda (null) och godkända (true)
            or(isNull(articleTeams.relevant), eq(articleTeams.relevant, true)),
          ),
        )
        .orderBy(desc(articles.publishedAt)),
      db
        .select({
          id: podcastEpisodes.id,
          podcast: podcastEpisodes.podcast,
          title: podcastEpisodes.title,
          durationSec: podcastEpisodes.durationSec,
          publishedAt: podcastEpisodes.publishedAt,
        })
        .from(podcastEpisodes)
        .orderBy(desc(podcastEpisodes.publishedAt)),
    ]);

  // Matchdagszonen
  const standings = new Map<string, Standing>(
    standingRows.map((r) => [r.teamId, { position: r.position, pts: r.pts }]),
  );
  const { mode, matches: modeMatches } = matchdayMode(localMatches, LOCAL_TEAM_IDS, now);
  const featured = pickFeatured(modeMatches, standings, LOCAL_TEAM_IDS);
  const others = modeMatches.filter((m) => m.id !== featured?.id);
  const summaries = teamSummaries(localTeamRows as LocalTeamRow[], localMatches, now);

  // Nyheter: en rad per artikel med alla taggade lag
  const byArticle = new Map<string, NewsArticle>();
  for (const r of newsRows) {
    const existing = byArticle.get(r.id);
    if (existing) existing.teamNames.push(r.teamName);
    else byArticle.set(r.id, { ...r, teamNames: [r.teamName] });
  }
  const news = [...byArticle.values()]; // redan sorterad nyast först

  const podcasts: PodcastGroup[] = PODCASTS.map((p) => {
    const eps = podRows.filter((e) => e.podcast === p.name);
    return {
      name: p.name,
      day: p.day,
      recent: eps.slice(0, PODCAST_RECENT),
      older: eps.slice(PODCAST_RECENT),
    };
  }).filter((p) => p.recent.length > 0);

  return (
    <>
      <section className="bg-surface-dark text-on-dark">
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-8">
          <MatchdayHero mode={mode} featured={featured} standings={standings} />
          <RoundStrip mode={mode} matches={others} />
          <div className="mt-10">
            <SectionHeading tone="dark" count={`${summaries.length} lag`}>
              Lokala lag
            </SectionHeading>
            <TeamGrid teams={summaries} />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 lg:grid-cols-[2fr_1fr]">
        <NewsFeed articles={news} />
        <Sidebar leagues={allLeagues} podcasts={podcasts} />
      </div>
    </>
  );
}
```

Obs: `localTeamRows` får `string | null` för `leagueId`/`leagueName` och `number | null` för `position`/`pts` genom `leftJoin`, vilket är exakt `LocalTeamRow`. Om `tsc` ändå klagar på typen, ta bort `as LocalTeamRow[]` och låt TypeScript visa den faktiska skillnaden innan något ändras.

- [ ] **Step 4: Typkontroll, tester och lint**

Run: `npx tsc --noEmit && npm test`
Expected: inga typfel, alla tester PASS.

Run: `npx eslint app lib instrumentation.ts`
Expected: inga fel i `app/page.tsx` eller `app/components/home/*` (det tidigare `Date.now()`-felet i `app/page.tsx` ska vara borta; tiden hämtas i hjälpfunktioner). Kvar: högst `app/systemstatus/page.tsx` impure function och `lib/goals.ts` oanvänd `now`.

- [ ] **Step 5: Visuell kontroll, läget `upcoming`**

Med dev-servern på port 3001 (se Task 2 Step 11), på `/`:
- Mörk zon: etiketten "Veckans match", serie och datum, två lag med emblem, placering och poäng, grön avsparkstid; omgångsraden med övriga lokala matcher; tio lagkort sorterade efter placering med formrutor och "Nästa · <dag> <d/m>" + "hemma/borta <motståndare>".
- Ljus zon: toppnyhet i mörkt kort med gröna lagetiketter, lista under, "Visa äldre nyheter"; sidospalt med serier och poddar.
- Menylänkarna "Nyheter" och "Poddar" hoppar till rätt sektion.
- Mobilbredd 375 px: veckans match staplad (lag – tid – lag), omgång och lagkort i två kolumner, sidospalten under nyheterna, ingen horisontell scroll.
- Konsolen: inga fel.

- [ ] **Step 6: Visuell kontroll, lägena `recent` och `offseason`**

Sista inlagda lokala matchen spelas 2026-10-04. Skapa `.env.development.local` i projektroten (ignoreras av git via `.env*`):

```
MATCHDAY_NOW=2026-10-06T12:00:00Z
```

Next läser om env-filer i dev; ladda om `/`. Förväntat: etiketten "Senaste omgången", den mest intressanta matchen den senaste veckan stort med resultat i grönt, övriga med resultat i omgångsraden.

Ändra till `MATCHDAY_NOW=2026-10-20T12:00:00Z`, ladda om. Förväntat: rubriken "Säsongen är slut", ingen omgångsrad, lagkorten kvar.

Ta bort filen `.env.development.local` och ladda om; läget ska vara tillbaka till `upcoming`.

Run: `git status --short`
Expected: `.env.development.local` listas inte.

- [ ] **Step 7: Produktionsbygge**

Stoppa dev-servern först (aldrig bygge och dev-server parallellt på den här maskinen), sedan:

Run: `npx next build`
Expected: bygget lyckas; `/` visas som statisk sida med revalidate (`○` eller `ISR`), inga typ- eller byggfel. Starta därefter dev-servern igen om den ska användas.

- [ ] **Step 8: Commit**

```bash
git add app/components/home/news-feed.tsx app/components/home/sidebar.tsx app/page.tsx
git commit -m "feat: new home page with dark matchday zone and light reading zone"
```
