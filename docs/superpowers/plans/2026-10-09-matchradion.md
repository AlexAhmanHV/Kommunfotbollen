# Matchradion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ett AI-genererat radioprogram per vecka om de lokala lagens matcher (resultat, skyttar, citat, tabellrunda) som spelas upp på startsidan med jingel och publikljud.

**Architecture:** Citat extraheras i det befintliga Haiku-anropet i `lib/goals.ts` och sparas i `match_quotes` efter en ordagrann-kontroll. Ett dagligt idempotent jobb (`lib/radio/`) bygger veckans underlag ur databasen, låter Claude Sonnet skriva manus, ElevenLabs läsa upp det, laddar upp MP3:n till Supabase Storage och skriver en rad i `radio_episodes`. En klientkomponent mixar jingel + röst + publikbädd med Web Audio.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Drizzle + postgres-js (Supabase Postgres), Zod 4, `@anthropic-ai/sdk`, ElevenLabs REST (fetch), Supabase Storage REST (fetch), Web Audio API, `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-09-matchradion-design.md`

## Global Constraints

- Inga nya npm-beroenden. ElevenLabs och Supabase Storage anropas med `fetch`.
- Manusmodell: `claude-sonnet-5-5`. Citatextraktion fortsätter på befintliga `claude-haiku-4-5`.
- TTS-modell: `eleven_multilingual_v2`, `output_format=mp3_44100_128`.
- Manus: minst 200, högst 4 000 tecken (Zod) innan TTS.
- Citat: högst 2 per match, 10–200 tecken, namngiven talare, måste finnas ordagrant i artikeltexten.
- All tid räknas i `Europe/Stockholm`. Veckan = måndag 00:00 till nästa måndag 00:00 (slut exklusivt). Nyckel = ISO-vecka, `YYYY-Www`.
- Fail-open: saknad nyckel → logga och hoppa över. DB-raden i `radio_episodes` skrivs sist.
- Nya env-variabler: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Storage-bucket: `radio` (publik), filnamn `<veckonyckel>.mp3`.
- Kodkommentarer och UI-text på svenska, som resten av kodbasen.
- `AGENTS.md`: Next.js 16 har brytande ändringar — läs relevant guide i `node_modules/next/dist/docs/` innan du ändrar sidor/komponenter.
- Starta **inte** en egen dev-server (en andra Next-dev-server har frusit maskinen). Be Alex starta den (port 3001) eller använd en som redan kör.
- `DATABASE_URL` i `.env.local` kan peka på produktionsdatabasen. Kör inget som skriver till databasen (generering, re-extraktion, DELETE) utan att Alex sagt ja i chatten.

## Filstruktur

| Fil | Ansvar |
|---|---|
| `lib/radio/week.ts` (ny) | Senast avslutade vecka i svensk tid + ISO-veckonyckel |
| `lib/quotes.ts` (ny) | Ordagrann-kontroll av citat, tidningsnamn ur URL |
| `lib/goals.ts` (ändras) | Haiku-anropet returnerar även citat; sparar dem i `match_quotes` |
| `lib/radio/episode-data.ts` (ny) | Ren funktion: matcher/skyttar/citat/tabell → veckans underlag |
| `lib/radio/script.ts` (ny) | Prompt + Claude-anrop + Zod-validering av manus |
| `lib/radio/voice.ts` (ny) | ElevenLabs TTS + uppladdning till Supabase Storage |
| `lib/radio/generate.ts` (ny) | Orkestrering: DB → underlag → manus → ljud → rad |
| `lib/db/schema.ts`, `lib/db/client.ts` (ändras) | Tabellerna `match_quotes` och `radio_episodes` |
| `lib/sync.ts`, `app/api/sync/route.ts`, `instrumentation.ts`, `.github/workflows/sync.yml` (ändras) | Schemaläggning och manuell körning |
| `scripts/generate-radio-sounds.mts` (ny), `public/radio/*.mp3` (nya) | Jingel och publikbädd, genereras en gång |
| `app/components/home/radio-player.tsx` (ny) | Spelaren (klientkomponent) |
| `app/components/home/sidebar.tsx`, `app/page.tsx`, `app/systemstatus/page.tsx` (ändras) | Visning |

---

### Task 1: Veckologik (`lib/radio/week.ts`)

**Files:**
- Create: `lib/radio/week.ts`
- Test: `lib/radio/week.test.ts`

**Interfaces:**
- Produces: `type RadioWeek = { key: string; start: Date; end: Date }` och `lastCompletedWeek(now: Date): RadioWeek`.

- [ ] **Step 1: Skriv de fallerande testerna**

`lib/radio/week.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lastCompletedWeek } from "./week";

describe("lastCompletedWeek", () => {
  it("måndag kväll ger veckan som just tog slut", () => {
    const w = lastCompletedWeek(new Date("2026-10-12T21:30:00Z")); // mån 23:30 svensk tid
    assert.equal(w.key, "2026-W41");
    assert.equal(w.start.toISOString(), "2026-10-04T22:00:00.000Z");
    assert.equal(w.end.toISOString(), "2026-10-11T22:00:00.000Z");
  });

  it("söndag kväll ger veckan före den pågående", () => {
    const w = lastCompletedWeek(new Date("2026-10-11T20:00:00Z")); // sön 22:00 svensk tid
    assert.equal(w.key, "2026-W40");
    assert.equal(w.start.toISOString(), "2026-09-27T22:00:00.000Z");
    assert.equal(w.end.toISOString(), "2026-10-04T22:00:00.000Z");
  });

  it("räknar datum i svensk tid, inte UTC", () => {
    // sön 22:30 UTC = mån 00:30 svensk tid → vecka 41 är avslutad
    assert.equal(lastCompletedWeek(new Date("2026-10-11T22:30:00Z")).key, "2026-W41");
  });

  it("veckan med övergång till vintertid slutar en timme senare i UTC", () => {
    const w = lastCompletedWeek(new Date("2026-10-27T12:00:00Z"));
    assert.equal(w.key, "2026-W43");
    assert.equal(w.start.toISOString(), "2026-10-18T22:00:00.000Z");
    assert.equal(w.end.toISOString(), "2026-10-25T23:00:00.000Z");
  });

  it("vecka 53 över årsskiftet hör till det gamla året", () => {
    const w = lastCompletedWeek(new Date("2027-01-05T12:00:00Z"));
    assert.equal(w.key, "2026-W53");
    assert.equal(w.start.toISOString(), "2026-12-27T23:00:00.000Z");
    assert.equal(w.end.toISOString(), "2027-01-03T23:00:00.000Z");
  });

  it("första veckan på nya året", () => {
    assert.equal(lastCompletedWeek(new Date("2027-01-12T12:00:00Z")).key, "2027-W01");
  });
});
```

- [ ] **Step 2: Kör testerna och se dem falla**

Run: `npx tsx --test lib/radio/week.test.ts`
Expected: FAIL — `Cannot find module './week'`.

- [ ] **Step 3: Implementera**

`lib/radio/week.ts`:

```ts
// Veckologik för Matchradion — ren, ingen databas. Allt räknas i svensk tid:
// en vecka är måndag 00:00 till nästa måndag 00:00 (slutet exklusivt), och
// nyckeln är ISO-veckan ("2026-W41").

const TZ = "Europe/Stockholm";
const DAY_MS = 24 * 60 * 60 * 1000;

export type RadioWeek = { key: string; start: Date; end: Date };

type YMD = readonly [y: number, m: number, d: number];

/** Svenskt kalenderdatum (månad 1–12) för ett ögonblick. */
function stockholmDate(at: Date): YMD {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return [get("year"), get("month"), get("day")];
}

/** Ögonblicket då kalenderdatumet börjar (00:00) i svensk tid. */
function stockholmMidnight([y, m, d]: YMD): Date {
  const guess = new Date(Date.UTC(y, m - 1, d));
  // Hur långt svensk tid ligger före UTC just då (1 eller 2 timmar).
  const local = new Date(guess.toLocaleString("en-US", { timeZone: TZ }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

function toYMD(date: Date): YMD {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

/** ISO-veckonyckel för ett kalenderdatum: veckan hör till torsdagens år. */
function isoWeekKey([y, m, d]: YMD): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7; // mån=1 … sön=7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // torsdagen samma vecka
  const year = date.getUTCFullYear();
  const dayOfYear = (date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1;
  const week = Math.ceil(dayOfYear / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Senast avslutade veckan före `now`. */
export function lastCompletedWeek(now: Date): RadioWeek {
  // Kalenderräkning på UTC-datum (inga klockslag, så inget sommartidsstrul).
  const [y, m, d] = stockholmDate(now);
  const today = new Date(Date.UTC(y, m - 1, d));
  const dow = today.getUTCDay() || 7;
  const monday = new Date(today.getTime() - (dow - 1 + 7) * DAY_MS); // förra veckans måndag
  const nextMonday = new Date(monday.getTime() + 7 * DAY_MS);
  return {
    key: isoWeekKey(toYMD(monday)),
    start: stockholmMidnight(toYMD(monday)),
    end: stockholmMidnight(toYMD(nextMonday)),
  };
}
```

- [ ] **Step 4: Kör testerna och se dem passera**

Run: `npx tsx --test lib/radio/week.test.ts`
Expected: PASS, 6 tester.

- [ ] **Step 5: Commit**

```bash
git add lib/radio/week.ts lib/radio/week.test.ts
git commit -m "feat(radio): last completed week in Swedish time with ISO week key"
```

---

### Task 2: Ordagrann-kontroll av citat (`lib/quotes.ts`)

**Files:**
- Create: `lib/quotes.ts`
- Test: `lib/quotes.test.ts`

**Interfaces:**
- Produces: `verifiedQuotes<T extends { speaker: string; quote: string }>(quotes: T[], articleText: string): T[]`, `paperName(url: string): string`, konstanterna `MAX_QUOTES_PER_MATCH = 2`, `MIN_QUOTE_CHARS = 10`, `MAX_QUOTE_CHARS = 200`.

- [ ] **Step 1: Skriv de fallerande testerna**

`lib/quotes.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { paperName, verifiedQuotes } from "./quotes";

const ARTICLE =
  "Västerviks FF vann med 3–1 mot Tuna. – Vi var bättre i andra halvlek och förtjänade segern, " +
  "säger tränaren Anna Berg. ”Det här ger oss självförtroende inför derbyt”, sa lagkaptenen Erik Ek.";

describe("verifiedQuotes", () => {
  it("godkänner ett ordagrant citat", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "Vi var bättre i andra halvlek och förtjänade segern" }],
      ARTICLE,
    );
    assert.equal(out.length, 1);
  });

  it("avvisar ett citat där ett ord ändrats", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "Vi var mycket bättre i andra halvlek" }],
      ARTICLE,
    );
    assert.equal(out.length, 0);
  });

  it("bryr sig inte om citattecken och blanksteg, och tar bort dem runt citatet", () => {
    const out = verifiedQuotes(
      [{ speaker: " Erik Ek ", quote: "”Det här ger oss  självförtroende inför derbyt”" }],
      ARTICLE,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].speaker, "Erik Ek");
    assert.equal(out[0].quote, "Det här ger oss  självförtroende inför derbyt");
  });

  it("tar bort inledande pratminus", () => {
    const out = verifiedQuotes(
      [{ speaker: "Anna Berg", quote: "– Vi var bättre i andra halvlek" }],
      ARTICLE,
    );
    assert.equal(out[0].quote, "Vi var bättre i andra halvlek");
  });

  it("avvisar citat utan namngiven talare", () => {
    const out = verifiedQuotes([{ speaker: "  ", quote: "Vi var bättre i andra halvlek" }], ARTICLE);
    assert.equal(out.length, 0);
  });

  it("avvisar för korta och för långa citat", () => {
    const long = "ord ".repeat(60).trim(); // 239 tecken
    const out = verifiedQuotes(
      [
        { speaker: "Anna Berg", quote: "Vi var" },
        { speaker: "Anna Berg", quote: long },
      ],
      `${ARTICLE} ${long}`,
    );
    assert.equal(out.length, 0);
  });

  it("behåller högst två citat per match", () => {
    const out = verifiedQuotes(
      [
        { speaker: "A", quote: "Vi var bättre i andra halvlek" },
        { speaker: "B", quote: "Det här ger oss självförtroende" },
        { speaker: "C", quote: "Västerviks FF vann med 3–1" },
      ],
      ARTICLE,
    );
    assert.deepEqual(out.map((q) => q.speaker), ["A", "B"]);
  });
});

describe("paperName", () => {
  it("känner igen de skrapade tidningarna", () => {
    assert.equal(paperName("https://www.dagensvastervik.se/sport/fotboll/e/1/x/"), "Dagens Västervik");
    assert.equal(paperName("https://vimmerbytidning.se/a/b"), "Vimmerby Tidning");
  });

  it("faller tillbaka på värdnamnet", () => {
    assert.equal(paperName("https://www.vt.se/sport/x"), "vt.se");
  });
});
```

- [ ] **Step 2: Kör testerna och se dem falla**

Run: `npx tsx --test lib/quotes.test.ts`
Expected: FAIL — `Cannot find module './quotes'`.

- [ ] **Step 3: Implementera**

`lib/quotes.ts`:

```ts
// Citat ur tidningarnas matchrapporter (lib/goals.ts). AI:n plockar ut dem,
// men ett citat sparas bara om det står ordagrant i artikeln — om riktiga
// personer får ingenting omformuleras eller hittas på.

export const MAX_QUOTES_PER_MATCH = 2;
export const MIN_QUOTE_CHARS = 10;
export const MAX_QUOTE_CHARS = 200;

/** Jämförelseform: utan citattecken, enhetliga streck och blanksteg, gemener. */
function comparable(s: string): string {
  return s
    .replace(/[”“"'’«»]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Citatet utan omslutande citattecken eller inledande pratminus. */
function stripQuoteMarks(s: string): string {
  return s
    .trim()
    .replace(/^[”“"«–—-]\s*/, "")
    .replace(/\s*[”“"»]$/, "")
    .trim();
}

/** De citat som finns ordagrant i artikeln, städade och begränsade i antal. */
export function verifiedQuotes<T extends { speaker: string; quote: string }>(
  quotes: T[],
  articleText: string,
): T[] {
  const article = comparable(articleText);
  return quotes
    .map((q) => ({ ...q, speaker: q.speaker.trim(), quote: stripQuoteMarks(q.quote) }))
    .filter(
      (q) =>
        q.speaker !== "" &&
        q.quote.length >= MIN_QUOTE_CHARS &&
        q.quote.length <= MAX_QUOTE_CHARS &&
        article.includes(comparable(q.quote)),
    )
    .slice(0, MAX_QUOTES_PER_MATCH);
}

const PAPERS: Record<string, string> = {
  "dagensvastervik.se": "Dagens Västervik",
  "vimmerbytidning.se": "Vimmerby Tidning",
};

/** Tidningens namn för en artikel-URL (för "säger X till Dagens Västervik"). */
export function paperName(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
  return PAPERS[host] ?? host;
}
```

- [ ] **Step 4: Kör testerna och se dem passera**

Run: `npx tsx --test lib/quotes.test.ts`
Expected: PASS, 9 tester.

- [ ] **Step 5: Commit**

```bash
git add lib/quotes.ts lib/quotes.test.ts
git commit -m "feat(quotes): verbatim check for quotes from match reports"
```

---

### Task 3: Citat ur matchrapporterna (`lib/goals.ts` + `match_quotes`)

**Files:**
- Modify: `lib/db/schema.ts` (efter `matchGoals`, ca rad 139)
- Modify: `lib/db/client.ts` (DDL, efter `CREATE TABLE IF NOT EXISTS match_goals`)
- Modify: `lib/goals.ts` (rad 1–5 importer, 43–57 scheman, 78–89 `SYSTEM`, 183–243 `processReports`, 246–362 `linkAndStore`)

**Interfaces:**
- Consumes: `verifiedQuotes` från Task 2.
- Produces: tabellen `matchQuotes` (Drizzle) med kolumnerna `matchId`, `ord`, `speaker`, `role: string | null`, `teamId: string | null`, `quote`, `sourceUrl`.

Ingen enhetstest här — logiken som kan gå fel (ordagrant-kontrollen) testas i Task 2, och AI-anropet verifieras i Task 10.

- [ ] **Step 1: Lägg till tabellen i schemat**

I `lib/db/schema.ts`, direkt efter `matchGoals`-tabellen:

```ts
// Citat från tränare/spelare ur samma matchrapporter som målskyttarna.
// Sparas bara om citatet står ordagrant i artikeln (lib/quotes.ts).
export const matchQuotes = pgTable(
  "match_quotes",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    ord: integer("ord").notNull(), // ordning i rapporten (0-baserad)
    speaker: text("speaker").notNull(),
    role: text("role"), // "tränare", "spelare" … null om okänt
    teamId: text("team_id").references(() => teams.id), // null om laget inte gick att avgöra
    quote: text("quote").notNull(),
    sourceUrl: text("source_url").notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.ord] })],
);
```

- [ ] **Step 2: Lägg till DDL:en**

I `lib/db/client.ts`, i `DDL`-strängen direkt efter `match_goals`-blocket:

```sql
CREATE TABLE IF NOT EXISTS match_quotes (
  match_id text NOT NULL REFERENCES matches(id),
  ord integer NOT NULL,
  speaker text NOT NULL,
  role text,
  team_id text REFERENCES teams(id),
  quote text NOT NULL,
  source_url text NOT NULL,
  PRIMARY KEY (match_id, ord)
);
```

- [ ] **Step 3: Utöka AI-svarets schema**

I `lib/goals.ts`: lägg till `matchQuotes` i schema-importen och importera kontrollen:

```ts
import { articles, articleTeams, matches, matchGoals, matchQuotes, dvReports, teams } from "./db/schema";
import { verifiedQuotes } from "./quotes";
```

Lägg till ovanför `goalSchema` och utöka `goalSchema`:

```ts
const quotesSchema = z
  .array(
    z.object({
      speaker: z.string(),
      role: z.string().default(""),
      team: z.string().default(""),
      quote: z.string(),
    }),
  )
  .default([]);

const goalSchema = z.object({
  homeTeam: z.string(),
  awayTeam: z.string(),
  homeScore: z.number().int(),
  awayScore: z.number().int(),
  goals: namedGoalsSchema,
  quotes: quotesSchema,
});
```

- [ ] **Step 4: Utöka prompten**

Ersätt `SYSTEM` i `lib/goals.ts` med:

```ts
const SYSTEM = `Du läser en svensk lokaltidnings matchreferat om fotboll och extraherar målskyttarna och citat.
Svara med ENBART giltig JSON enligt:
{"homeTeam":"","awayTeam":"","homeScore":0,"awayScore":0,"goals":[{"team":"<lagnamn exakt som i texten>","player":"<spelarens namn>"}],"quotes":[{"speaker":"<talarens namn>","role":"<tränare|spelare|ledare>","team":"<lagnamn som i texten>","quote":"<citatet>"}]}
Regler:
- homeTeam/awayTeam = de två lagen (hemmalag först om det framgår, annars valfri ordning).
- goals listas i den ordning målen gjordes. team = det lag vars spelare gjorde målet (använd lagnamnet som det skrivs i texten).
- Ta bara med RIKTIGA mål i matchen. Uteslut straffläggning efter oavgjort, självmål-oklarheter räknas till det lag som fick målet.
- Självmål: skriv player som "Självmål" (aldrig ett lagnamn).
- Om ett mål saknar namngiven skytt, hoppa över det målet.
- quotes: direkta citat (inom citattecken eller efter pratminus) från namngivna tränare, ledare eller spelare — högst 2, de mest talande. Kopiera citatet EXAKT tecken för tecken ur texten; ändra, korta eller sätt aldrig ihop citat. Hoppa över citat där talaren inte namnges. Inga citat: "quotes":[].
- Om texten inte är ett matchreferat med resultat, svara {"homeTeam":"","awayTeam":"","homeScore":0,"awayScore":0,"goals":[],"quotes":[]}.`;
```

I `processReports`, höj `max_tokens: 1024` till `max_tokens: 1536` (citaten tar plats).

- [ ] **Step 5: Skicka artikeltexten vidare**

I `processReports`, ändra anropet:

```ts
    const matchId = await linkAndStore(db, data, url, teamName, text);
```

och signaturen:

```ts
async function linkAndStore(
  db: Db,
  data: Extracted,
  url: string,
  teamName: Map<string, string>,
  articleText: string,
): Promise<string | null> {
```

- [ ] **Step 6: Spara citaten när matchen kopplats**

I `linkAndStore`, direkt efter blocket `if (!LOCAL_TEAM_IDS.has(match.homeTeamId) && !LOCAL_TEAM_IDS.has(match.awayTeamId)) { return null; }` och **före** kontrollen "redan skyttar sparade för matchen?":

```ts
  // citat sparas även när skyttarna redan fanns (t.ex. från en tidigare rapport)
  await storeQuotes(db, match, data.quotes, articleText, url, teamName);
```

Lägg till funktionen direkt efter `linkAndStore`:

```ts
// Sparar de citat som står ordagrant i rapporten. Finns citat för matchen
// redan (från en annan rapport) läggs inga till.
async function storeQuotes(
  db: Db,
  match: { id: string; homeTeamId: string; awayTeamId: string },
  quotes: Extracted["quotes"],
  articleText: string,
  url: string,
  teamName: Map<string, string>,
): Promise<void> {
  const ok = verifiedQuotes(quotes, articleText);
  if (ok.length === 0) return;

  const existing = await db
    .select({ n: sql<number>`count(*)` })
    .from(matchQuotes)
    .where(eq(matchQuotes.matchId, match.id));
  if (Number(existing[0]?.n ?? 0) > 0) return;

  const hn = teamName.get(match.homeTeamId) ?? "";
  const an = teamName.get(match.awayTeamId) ?? "";
  let ord = 0;
  for (const q of ok) {
    const teamId = teamNameMatches(hn, match.homeTeamId, q.team)
      ? match.homeTeamId
      : teamNameMatches(an, match.awayTeamId, q.team)
        ? match.awayTeamId
        : null;
    await db
      .insert(matchQuotes)
      .values({
        matchId: match.id,
        ord: ord++,
        speaker: q.speaker,
        role: q.role.trim() || null,
        teamId,
        quote: q.quote,
        sourceUrl: url,
      })
      .onConflictDoNothing();
  }
}
```

- [ ] **Step 7: Typkontroll, lint och befintliga tester**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: inga typfel, inga nya lintfel, alla tester gröna.

- [ ] **Step 8: Commit**

```bash
git add lib/db/schema.ts lib/db/client.ts lib/goals.ts
git commit -m "feat(goals): extract verbatim coach/player quotes from match reports into match_quotes"
```

---

### Task 4: Veckans underlag (`lib/radio/episode-data.ts`)

**Files:**
- Create: `lib/radio/episode-data.ts`
- Test: `lib/radio/episode-data.test.ts`

**Interfaces:**
- Consumes: `RadioWeek` (Task 1), `paperName` (Task 2), `UiMatch` från `lib/queries.ts`.
- Produces:
  - `type StandingsSnapshot = Record<string, { position: number; pts: number }>`
  - `type GoalRow = { matchId: string; teamId: string; player: string; ord: number }`
  - `type QuoteRow = { matchId: string; ord: number; teamId: string | null; speaker: string; role: string | null; quote: string; sourceUrl: string }`
  - `type TableRow = { groupId: string; leagueName: string; teamId: string; teamName: string; position: number; pts: number }`
  - `type EpisodeData = { week: number; teams: TeamWeek[]; tables: LeagueTable[] }`
  - `buildEpisodeData(input: { week: RadioWeek; localIds: ReadonlySet<string>; matches: UiMatch[]; goals: GoalRow[]; quotes: QuoteRow[]; table: TableRow[]; previous: StandingsSnapshot | null }): EpisodeData | null`
  - `standingsSnapshot(rows: TableRow[], localIds: ReadonlySet<string>): StandingsSnapshot`

- [ ] **Step 1: Skriv de fallerande testerna**

`lib/radio/episode-data.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UiMatch } from "../queries";
import { buildEpisodeData, standingsSnapshot, type TableRow } from "./episode-data";

const WEEK = {
  key: "2026-W41",
  start: new Date("2026-10-04T22:00:00Z"),
  end: new Date("2026-10-11T22:00:00Z"),
};
const LOCAL = new Set(["L1", "L2"]);
const UPCOMING = { status: "UPCOMING", homeScore: null, awayScore: null } as const;

let seq = 0;
function match(p: Partial<UiMatch>): UiMatch {
  seq++;
  return {
    id: `m${seq}`,
    round: null,
    startsAt: new Date("2026-10-10T13:00:00Z"),
    status: "FINISHED",
    homeId: "L1",
    awayId: "X1",
    homeName: "Lokal Ett",
    awayName: "Gäst",
    homeLogo: null,
    awayLogo: null,
    homeScore: 2,
    awayScore: 1,
    leagueId: "lg",
    leagueName: "Division 4",
    ...p,
  };
}

const base = { week: WEEK, localIds: LOCAL, goals: [], quotes: [], table: [], previous: null };

describe("buildEpisodeData", () => {
  it("ger null när inget lokalt lag spelat", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [match({ ...UPCOMING, startsAt: new Date("2026-10-17T13:00:00Z") })],
    });
    assert.equal(data, null);
  });

  it("ignorerar matcher utanför veckan och ospelade matcher", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [
        match({ startsAt: new Date("2026-10-04T21:59:00Z") }), // sön 23:59 veckan innan
        match({ startsAt: new Date("2026-10-11T22:00:00Z") }), // mån 00:00 veckan efter
        match({ ...UPCOMING }),
      ],
    });
    assert.equal(data, null);
  });

  it("tar med vinst och lagets egna skyttar i rapportordning", () => {
    const m = match({});
    const data = buildEpisodeData({
      ...base,
      matches: [m],
      goals: [
        { matchId: m.id, teamId: "L1", player: "Bertil", ord: 1 },
        { matchId: m.id, teamId: "L1", player: "Adam", ord: 0 },
        { matchId: m.id, teamId: "X1", player: "Gästskytt", ord: 2 },
      ],
    });
    assert.equal(data?.week, 41);
    assert.equal(data?.teams.length, 1);
    assert.equal(data?.teams[0].team, "Lokal Ett");
    assert.equal(data?.teams[0].league, "Division 4");
    assert.deepEqual(data?.teams[0].results, [
      {
        opponent: "Gäst",
        home: true,
        goalsFor: 2,
        goalsAgainst: 1,
        outcome: "vinst",
        scorers: ["Adam", "Bertil"],
        quotes: [],
      },
    ]);
  });

  it("tar med bortamatch utan kända skyttar", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [
        match({ homeId: "X1", homeName: "Värd", awayId: "L1", awayName: "Lokal Ett", homeScore: 3, awayScore: 3 }),
      ],
    });
    assert.deepEqual(data?.teams[0].results[0], {
      opponent: "Värd",
      home: false,
      goalsFor: 3,
      goalsAgainst: 3,
      outcome: "oavgjort",
      scorers: [],
      quotes: [],
    });
  });

  it("lägger ett derby hos båda lagen", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [
        match({ awayId: "L2", awayName: "Lokal Två", homeScore: 0, awayScore: 2 }),
      ],
    });
    assert.equal(data?.teams.length, 2);
    assert.equal(data?.teams[0].results[0].outcome, "förlust");
    assert.equal(data?.teams[1].team, "Lokal Två");
    assert.equal(data?.teams[1].results[0].outcome, "vinst");
    assert.equal(data?.teams[1].results[0].home, false);
  });

  it("kopplar citat till rätt lag med tidningens namn", () => {
    const m = match({});
    const data = buildEpisodeData({
      ...base,
      matches: [m],
      quotes: [
        {
          matchId: m.id,
          ord: 0,
          teamId: "X1",
          speaker: "Gästtränare",
          role: "tränare",
          quote: "Vi borde ha fått straff",
          sourceUrl: "https://www.dagensvastervik.se/a",
        },
        {
          matchId: m.id,
          ord: 1,
          teamId: "L1",
          speaker: "Anna Berg",
          role: "tränare",
          quote: "Vi förtjänade segern",
          sourceUrl: "https://www.dagensvastervik.se/sport/fotboll/e/1/x/",
        },
      ],
    });
    assert.deepEqual(data?.teams[0].results[0].quotes, [
      { speaker: "Anna Berg", role: "tränare", quote: "Vi förtjänade segern", source: "Dagens Västervik" },
    ]);
  });

  it("väljer första kommande match efter veckan som nästa match", () => {
    const data = buildEpisodeData({
      ...base,
      matches: [
        match({}),
        match({
          ...UPCOMING,
          startsAt: new Date("2026-10-24T12:00:00Z"),
          homeId: "X2",
          homeName: "Senare",
          awayId: "L1",
          awayName: "Lokal Ett",
        }),
        match({ ...UPCOMING, startsAt: new Date("2026-10-17T12:00:00Z"), awayName: "Nästa" }),
      ],
    });
    assert.deepEqual(data?.teams[0].next, { opponent: "Nästa", home: true, date: "lördag 17 oktober" });
  });

  it("bygger tabellrundan för serier med lokala lag", () => {
    const table: TableRow[] = [
      { groupId: "g1", leagueName: "Division 4", teamId: "L1", teamName: "Lokal Ett", position: 4, pts: 12 },
      { groupId: "g1", leagueName: "Division 4", teamId: "X1", teamName: "Topp", position: 1, pts: 20 },
      { groupId: "g2", leagueName: "Division 6", teamId: "X3", teamName: "Annan", position: 1, pts: 18 },
    ];
    const withPrevious = buildEpisodeData({
      ...base,
      matches: [match({})],
      table,
      previous: { L1: { position: 6, pts: 9 } },
    });
    assert.deepEqual(withPrevious?.tables, [
      {
        league: "Division 4",
        leader: { team: "Topp", pts: 20 },
        localTeams: [{ team: "Lokal Ett", position: 4, pts: 12, previousPosition: 6 }],
      },
    ]);

    const firstEpisode = buildEpisodeData({ ...base, matches: [match({})], table });
    assert.equal(firstEpisode?.tables[0].localTeams[0].previousPosition, null);
  });
});

describe("standingsSnapshot", () => {
  it("sparar bara de lokala lagen", () => {
    const snap = standingsSnapshot(
      [
        { groupId: "g1", leagueName: "D4", teamId: "L1", teamName: "Lokal Ett", position: 4, pts: 12 },
        { groupId: "g1", leagueName: "D4", teamId: "X1", teamName: "Topp", position: 1, pts: 20 },
      ],
      LOCAL,
    );
    assert.deepEqual(snap, { L1: { position: 4, pts: 12 } });
  });
});
```

- [ ] **Step 2: Kör testerna och se dem falla**

Run: `npx tsx --test lib/radio/episode-data.test.ts`
Expected: FAIL — `Cannot find module './episode-data'`.

- [ ] **Step 3: Implementera**

`lib/radio/episode-data.ts`:

```ts
import type { UiMatch } from "../queries";
import { paperName } from "../quotes";
import type { RadioWeek } from "./week";

// Veckans underlag till Matchradion — ren logik, ingen databas. Allt som
// står här får manuset nämna, och inget annat (se script.ts).

export type StandingsSnapshot = Record<string, { position: number; pts: number }>;

export type GoalRow = { matchId: string; teamId: string; player: string; ord: number };
export type QuoteRow = {
  matchId: string;
  ord: number;
  teamId: string | null;
  speaker: string;
  role: string | null;
  quote: string;
  sourceUrl: string;
};
export type TableRow = {
  groupId: string;
  leagueName: string;
  teamId: string;
  teamName: string;
  position: number;
  pts: number;
};

export type Quote = { speaker: string; role: string | null; quote: string; source: string };
export type TeamResult = {
  opponent: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  outcome: "vinst" | "oavgjort" | "förlust";
  scorers: string[]; // lagets egna skyttar i rapportordning; tom = okända
  quotes: Quote[];
};
export type TeamWeek = {
  team: string;
  league: string;
  results: TeamResult[];
  next: { opponent: string; home: boolean; date: string } | null;
};
export type LeagueTable = {
  league: string;
  leader: { team: string; pts: number };
  localTeams: { team: string; position: number; pts: number; previousPosition: number | null }[];
};
export type EpisodeData = { week: number; teams: TeamWeek[]; tables: LeagueTable[] };

const nextDateFmt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Stockholm",
});

const byStart = (a: UiMatch, b: UiMatch) => a.startsAt.getTime() - b.startsAt.getTime();
const involves = (m: UiMatch, teamId: string) => m.homeId === teamId || m.awayId === teamId;

/** De lokala lagens placering just nu — sparas med avsnittet så att nästa
 * avsnitt kan jämföra (table_rows har ingen historik). */
export function standingsSnapshot(rows: TableRow[], localIds: ReadonlySet<string>): StandingsSnapshot {
  const snap: StandingsSnapshot = {};
  for (const r of rows) {
    if (localIds.has(r.teamId)) snap[r.teamId] = { position: r.position, pts: r.pts };
  }
  return snap;
}

function leagueTables(
  rows: TableRow[],
  localIds: ReadonlySet<string>,
  previous: StandingsSnapshot | null,
): LeagueTable[] {
  const groups = new Map<string, TableRow[]>();
  for (const r of rows) {
    const g = groups.get(r.groupId);
    if (g) g.push(r);
    else groups.set(r.groupId, [r]);
  }
  const tables: LeagueTable[] = [];
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.position - b.position);
    const locals = sorted.filter((r) => localIds.has(r.teamId));
    if (locals.length === 0) continue;
    tables.push({
      league: sorted[0].leagueName,
      leader: { team: sorted[0].teamName, pts: sorted[0].pts },
      localTeams: locals.map((r) => ({
        team: r.teamName,
        position: r.position,
        pts: r.pts,
        previousPosition: previous?.[r.teamId]?.position ?? null,
      })),
    });
  }
  return tables.sort((a, b) => a.league.localeCompare(b.league, "sv"));
}

/** Veckans underlag, eller null om inget lokalt lag spelat (då blir det inget avsnitt).
 * Lagen kommer i `localIds` ordning. */
export function buildEpisodeData(input: {
  week: RadioWeek;
  localIds: ReadonlySet<string>;
  matches: UiMatch[];
  goals: GoalRow[];
  quotes: QuoteRow[];
  table: TableRow[];
  previous: StandingsSnapshot | null;
}): EpisodeData | null {
  const { week, localIds, matches, goals, quotes, table, previous } = input;
  const played = matches
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        m.homeScore !== null &&
        m.awayScore !== null &&
        m.startsAt >= week.start &&
        m.startsAt < week.end,
    )
    .sort(byStart);

  const teams: TeamWeek[] = [];
  for (const teamId of localIds) {
    const own = played.filter((m) => involves(m, teamId));
    if (own.length === 0) continue;

    const results = own.map((m): TeamResult => {
      const home = m.homeId === teamId;
      const goalsFor = (home ? m.homeScore : m.awayScore) as number;
      const goalsAgainst = (home ? m.awayScore : m.homeScore) as number;
      return {
        opponent: home ? m.awayName : m.homeName,
        home,
        goalsFor,
        goalsAgainst,
        outcome: goalsFor > goalsAgainst ? "vinst" : goalsFor === goalsAgainst ? "oavgjort" : "förlust",
        scorers: goals
          .filter((g) => g.matchId === m.id && g.teamId === teamId)
          .sort((a, b) => a.ord - b.ord)
          .map((g) => g.player),
        quotes: quotes
          .filter((q) => q.matchId === m.id && (q.teamId === teamId || q.teamId === null))
          .sort((a, b) => a.ord - b.ord)
          .map((q) => ({ speaker: q.speaker, role: q.role, quote: q.quote, source: paperName(q.sourceUrl) })),
      };
    });

    const next = matches
      .filter((m) => m.status === "UPCOMING" && m.startsAt >= week.end && involves(m, teamId))
      .sort(byStart)[0];
    const first = own[0];
    teams.push({
      team: first.homeId === teamId ? first.homeName : first.awayName,
      league: first.leagueName,
      results,
      next: next
        ? {
            opponent: next.homeId === teamId ? next.awayName : next.homeName,
            home: next.homeId === teamId,
            date: nextDateFmt.format(next.startsAt),
          }
        : null,
    });
  }

  if (teams.length === 0) return null;
  return {
    week: Number(week.key.slice(6)),
    teams,
    tables: leagueTables(table, localIds, previous),
  };
}
```

- [ ] **Step 4: Kör testerna och se dem passera**

Run: `npx tsx --test lib/radio/episode-data.test.ts`
Expected: PASS, 9 tester.

- [ ] **Step 5: Commit**

```bash
git add lib/radio/episode-data.ts lib/radio/episode-data.test.ts
git commit -m "feat(radio): build weekly episode data — results, scorers, quotes, next match, table round"
```

---

### Task 5: Manus med Claude (`lib/radio/script.ts`)

**Files:**
- Create: `lib/radio/script.ts`
- Test: `lib/radio/script.test.ts`

**Interfaces:**
- Consumes: `EpisodeData` (Task 4).
- Produces: `MAX_SCRIPT_CHARS = 4000`, `scriptSchema` (Zod, string → trimmad string), `writeScript(data: EpisodeData, apiKey: string): Promise<string>`.

- [ ] **Step 1: Skriv de fallerande testerna**

`lib/radio/script.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_SCRIPT_CHARS, scriptSchema } from "./script";

describe("scriptSchema", () => {
  it("godkänner och trimmar ett rimligt manus", () => {
    const s = "Hej och välkommen. ".repeat(20).trim();
    assert.equal(scriptSchema.parse(`  ${s}  `), s);
  });

  it("avvisar tomt manus", () => {
    assert.throws(() => scriptSchema.parse("   "));
  });

  it("avvisar för kort manus", () => {
    assert.throws(() => scriptSchema.parse("Kort."));
  });

  it("avvisar för långt manus", () => {
    assert.throws(() => scriptSchema.parse("a".repeat(MAX_SCRIPT_CHARS + 1)));
  });
});
```

- [ ] **Step 2: Kör testerna och se dem falla**

Run: `npx tsx --test lib/radio/script.test.ts`
Expected: FAIL — `Cannot find module './script'`.

- [ ] **Step 3: Implementera**

`lib/radio/script.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { EpisodeData } from "./episode-data";

// Manus till Matchradion. Ett anrop i veckan, så Sonnet (språket är
// produkten). Manuset valideras innan det går till ElevenLabs — ett skenande
// svar får inte bränna röstkrediter.

const MODEL = "claude-sonnet-5-5";
export const MAX_SCRIPT_CHARS = 4000;

export const scriptSchema = z
  .string()
  .trim()
  .min(200, "manuset är för kort")
  .max(MAX_SCRIPT_CHARS, "manuset är för långt");

const SYSTEM = `Du skriver manus till "Matchradion", ett kort veckoprogram om lokal amatörfotboll i Västervik med omnejd. Manuset läses upp av en AI-röst med publikljud i bakgrunden.

Underlaget är JSON:
- teams: varje lokalt lag som spelat i veckan, med results (motståndare, hemma/borta, mål, utfall, scorers, quotes) och next (nästa match).
- tables: tabellrundan per serie — leader (serieledaren) och localTeams (placering, poäng, previousPosition).

Regler:
- Använd ENBART fakta i underlaget. Hitta aldrig på händelser, matchminuter, väder, publiksiffror, skador eller egenskaper hos spelare.
- scorers är lagets målskyttar i ordning. Är listan tom: nämn bara resultatet, gissa aldrig vem som gjorde målen.
- quotes får bara återges ordagrant, och alltid med vem som sa det och källan, t.ex. "– Vi förtjänade segern, säger tränaren Anna Berg till Dagens Västervik." Omformulera eller hitta aldrig på citat. Är role null: nämn bara namnet.
- Avsluta med tabellrundan: för varje serie, nämn serieledaren och de lokala lagens placering. previousPosition är placeringen vid förra avsnittet; är den null, nämn bara nuvarande placering. Säg aldrig "klättrar" eller "tappar" utan att previousPosition visar det.
- Skriv resultat och placeringar så att de låter rätt upplästa, t.ex. "vann med tre–ett", "ligger fyra".
- Börja med en kort hälsning med veckonumret och sluta med en kort avrundning.
- Naturlig, levande svenska som en lokal sportradiokommentator — engagerad men inte överdriven.
- Ren löptext för uppläsning: inga rubriker, listor, emojis eller markdown.
- Längd: 350–450 ord.
- Svara med ENBART manuset.`;

export async function writeScript(data: EpisodeData, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Vecka ${data.week}. Underlag:\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  return scriptSchema.parse(text);
}
```

- [ ] **Step 4: Kör testerna och se dem passera**

Run: `npx tsx --test lib/radio/script.test.ts`
Expected: PASS, 4 tester.

- [ ] **Step 5: Commit**

```bash
git add lib/radio/script.ts lib/radio/script.test.ts
git commit -m "feat(radio): Sonnet script writer with fact-only rules and length validation"
```

---

### Task 6: Röst, lagring och orkestrering (`voice.ts`, `generate.ts`, `radio_episodes`)

**Files:**
- Create: `lib/radio/voice.ts`
- Create: `lib/radio/generate.ts`
- Modify: `lib/db/schema.ts` (lägg till `jsonb` i importen, ny tabell sist i filen)
- Modify: `lib/db/client.ts` (DDL, sist i strängen)

**Interfaces:**
- Consumes: `lastCompletedWeek` (Task 1), `buildEpisodeData`, `standingsSnapshot`, typerna `StandingsSnapshot`, `TableRow` (Task 4), `writeScript` (Task 5), `matchQuotes` (Task 3), `latestRowPerTeam` från `lib/matchday.ts`, `getMatches` från `lib/queries.ts`.
- Produces: `synthesize(text, apiKey, voiceId): Promise<ArrayBuffer>`, `uploadAudio(key, audio, supabaseUrl, serviceKey): Promise<string>`, `generateEpisode(now?: Date): Promise<void>`, tabellen `radioEpisodes` (`id`, `weekStart`, `script`, `audioUrl`, `standings`, `createdAt`).

Ingen enhetstest: allt här är I/O mot databas och externa API:er. Verifieras i Task 10.

- [ ] **Step 1: Lägg till tabellen i schemat**

I `lib/db/schema.ts`, lägg till `jsonb` i importen från `drizzle-orm/pg-core` och sist i filen:

```ts
// Matchradion: ett AI-genererat radioavsnitt per vecka (lib/radio). Id är
// ISO-veckonyckeln ("2026-W41"), så jobbet är idempotent. `standings` är de
// lokala lagens placering när avsnittet gjordes — table_rows har ingen
// historik, så nästa avsnitt jämför mot den här ögonblicksbilden.
export const radioEpisodes = pgTable("radio_episodes", {
  id: text("id").primaryKey(),
  weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
  script: text("script").notNull(),
  audioUrl: text("audio_url").notNull(),
  standings: jsonb("standings")
    .$type<Record<string, { position: number; pts: number }>>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
```

- [ ] **Step 2: Lägg till DDL:en**

I `lib/db/client.ts`, sist i `DDL`-strängen (efter `table_rows`):

```sql
CREATE TABLE IF NOT EXISTS radio_episodes (
  id text PRIMARY KEY,
  week_start timestamptz NOT NULL,
  script text NOT NULL,
  audio_url text NOT NULL,
  standings jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
```

- [ ] **Step 3: Skriv `voice.ts`**

`lib/radio/voice.ts`:

```ts
// Uppläsning (ElevenLabs) och lagring (Supabase Storage) av Matchradion.
// Båda via fetch — inga SDK:er behövs för två anrop.

const TTS_MODEL = "eleven_multilingual_v2";
const BUCKET = "radio";

/** Manus → MP3 med vald röst. */
export async function synthesize(text: string, apiKey: string, voiceId: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: TTS_MODEL }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
  return res.arrayBuffer();
}

/** Laddar upp avsnittet till den publika bucketen och returnerar dess URL. */
export async function uploadAudio(
  key: string,
  audio: ArrayBuffer,
  supabaseUrl: string,
  serviceKey: string,
): Promise<string> {
  const path = `${BUCKET}/${key}.mp3`;
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "audio/mpeg",
      "x-upsert": "true",
    },
    body: audio,
  });
  if (!res.ok) throw new Error(`Supabase Storage ${res.status}: ${await res.text()}`);
  return `${supabaseUrl}/storage/v1/object/public/${path}`;
}
```

- [ ] **Step 4: Skriv `generate.ts`**

`lib/radio/generate.ts`:

```ts
import { desc, eq, inArray, lt, or } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  groups,
  leagues,
  matches,
  matchGoals,
  matchQuotes,
  radioEpisodes,
  tableRows,
  teams,
} from "../db/schema";
import { FEATURED_PRIORITY, LOCAL_TEAM_IDS } from "../local-teams";
import { latestRowPerTeam } from "../matchday";
import { getMatches } from "../queries";
import { buildEpisodeData, standingsSnapshot } from "./episode-data";
import { writeScript } from "./script";
import { synthesize, uploadAudio } from "./voice";
import { lastCompletedWeek } from "./week";

// Matchradion: ett avsnitt för senast avslutade vecka. Körs dagligen men gör
// bara något när avsnittet saknas (i praktiken måndag kväll; misslyckas det
// försöker nästa körning igen).
//
// Robusthet (samma fail-open som relevance.ts):
//  - saknad nyckel → logga och hoppa över, sajten visar bara inget nytt avsnitt
//  - ordning manus → ljud → uppladdning → SIST raden: ett fel i något steg
//    lämnar inget halvfärdigt avsnitt, nästa körning gör om alltihop.

export async function generateEpisode(now: Date = new Date()): Promise<void> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!anthropicKey || !elevenKey || !voiceId || !supabaseUrl || !serviceKey) {
    console.log("[radio] hoppar över: nycklar saknas (Anthropic, ElevenLabs eller Supabase)");
    return;
  }

  const week = lastCompletedWeek(now);
  const db = await getDb();
  const existing = await db
    .select({ id: radioEpisodes.id })
    .from(radioEpisodes)
    .where(eq(radioEpisodes.id, week.key))
    .limit(1);
  if (existing.length > 0) return;

  const localIds = [...LOCAL_TEAM_IDS];
  const [localMatches, tableData, previousRows] = await Promise.all([
    getMatches({
      where: or(inArray(matches.homeTeamId, localIds), inArray(matches.awayTeamId, localIds)),
      order: "asc",
    }),
    db
      .select({
        groupId: tableRows.groupId,
        leagueName: leagues.name,
        teamId: tableRows.teamId,
        teamName: teams.name,
        position: tableRows.position,
        pts: tableRows.pts,
        computedAt: tableRows.computedAt,
      })
      .from(tableRows)
      .innerJoin(teams, eq(tableRows.teamId, teams.id))
      .innerJoin(groups, eq(tableRows.groupId, groups.id))
      .innerJoin(leagues, eq(groups.leagueId, leagues.id)),
    db
      .select({ standings: radioEpisodes.standings })
      .from(radioEpisodes)
      .where(lt(radioEpisodes.weekStart, week.start))
      .orderBy(desc(radioEpisodes.weekStart))
      .limit(1),
  ]);

  const matchIds = localMatches.map((m) => m.id);
  const [goals, quotes] =
    matchIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              matchId: matchGoals.matchId,
              teamId: matchGoals.teamId,
              player: matchGoals.player,
              ord: matchGoals.ord,
            })
            .from(matchGoals)
            .where(inArray(matchGoals.matchId, matchIds)),
          db
            .select({
              matchId: matchQuotes.matchId,
              ord: matchQuotes.ord,
              teamId: matchQuotes.teamId,
              speaker: matchQuotes.speaker,
              role: matchQuotes.role,
              quote: matchQuotes.quote,
              sourceUrl: matchQuotes.sourceUrl,
            })
            .from(matchQuotes)
            .where(inArray(matchQuotes.matchId, matchIds)),
        ]);

  // En tabellrad per lag (en kvarglömd rad från en grupp laget lämnat ska inte räknas).
  const table = latestRowPerTeam(tableData);
  const standings = standingsSnapshot(table, LOCAL_TEAM_IDS);
  const data = buildEpisodeData({
    week,
    localIds: new Set(FEATURED_PRIORITY),
    matches: localMatches,
    goals,
    quotes,
    table,
    previous: previousRows[0]?.standings ?? null,
  });
  if (!data) {
    console.log(`[radio] ${week.key}: inga spelade lokala matcher, inget avsnitt`);
    return;
  }

  const script = await writeScript(data, anthropicKey);
  const audio = await synthesize(script, elevenKey, voiceId);
  const audioUrl = await uploadAudio(week.key, audio, supabaseUrl, serviceKey);
  await db
    .insert(radioEpisodes)
    .values({ id: week.key, weekStart: week.start, script, audioUrl, standings, createdAt: new Date() })
    .onConflictDoNothing();
  console.log(`[radio] ${week.key}: avsnitt klart (${script.length} tecken)`);
}
```

- [ ] **Step 5: Typkontroll, lint och tester**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: inga typfel, inga nya lintfel, alla tester gröna.

- [ ] **Step 6: Commit**

```bash
git add lib/radio/voice.ts lib/radio/generate.ts lib/db/schema.ts lib/db/client.ts
git commit -m "feat(radio): ElevenLabs voice, Supabase upload and idempotent weekly episode generation"
```

---

### Task 7: Schemaläggning, manuell körning och systemstatus

**Files:**
- Modify: `lib/sync.ts` (ny export efter `syncNewsAndFilter`)
- Modify: `app/api/sync/route.ts`
- Modify: `instrumentation.ts`
- Modify: `.github/workflows/sync.yml`
- Modify: `app/systemstatus/page.tsx`

**Interfaces:**
- Consumes: `generateEpisode` (Task 6), `radioEpisodes` (Task 6).
- Produces: `syncRadio(): Promise<boolean>` i `lib/sync.ts`; `POST /api/sync?target=radio`.

- [ ] **Step 1: Lägg till jobbet i `lib/sync.ts`**

Efter `syncNewsAndFilter`:

```ts
/** Matchradion: veckans avsnitt (lib/radio). Körs dagligen 23:30 men gör bara
 * något när senast avslutade veckans avsnitt saknas.
 * Returnerar false om en radiokörning redan pågår. */
export function syncRadio(): Promise<boolean> {
  return exclusive("radio", async () => {
    const { generateEpisode } = await import("./radio/generate");
    await generateEpisode();
  });
}
```

- [ ] **Step 2: Lägg till `target=radio` i routen**

I `app/api/sync/route.ts`:

```ts
import { syncAll, syncNewsAndFilter, syncRadio, syncTeams } from "@/lib/sync";
```

och utöka grenarna:

```ts
    if (target === "teams") {
      await syncTeams();
    } else if (target === "news") {
      await syncNewsAndFilter();
    } else if (target === "radio") {
      await syncRadio();
    } else {
      await syncAll();
    }
```

- [ ] **Step 3: Schemalägg 23:30 i `instrumentation.ts`**

Uppdatera kommentaren högst upp:

```ts
// Körs en gång när Next.js-servern startar (dev och prod).
// Tre schemalagda jobb, appen är sin egen cron:
//   1. Nyheter + AI-relevansfilter en gång per dygn kl 22:00 svensk tid.
//   2. Lagen (tabeller, matcher/resultat, målskyttar) kl 23:00 svensk tid.
//   3. Matchradion kl 23:30 (gör bara något när veckans avsnitt saknas).
// /api/sync kör jobben manuellt (backup / test).
```

Lägg till konstanten under `TEAMS_HOUR_LOCAL`:

```ts
const RADIO_TIME_LOCAL = { hour: 23, minute: 30 }; // efter lagsynken
```

Gör `msUntilNext` minutmedveten:

```ts
/** Millisekunder till nästa `hour`:`minute` svensk tid. */
function msUntilNext(hour: number, minute = 0): number {
```

och i funktionskroppen `target.setHours(hour, 0, 0, 0);` → `target.setHours(hour, minute, 0, 0);`.

Importera jobbet:

```ts
  const { ensureSynced, syncNewsAndFilter, syncRadio, syncTeams } = await import("./lib/sync");
```

Gör `daily` minutmedveten:

```ts
  const daily = (hour: number, label: string, job: () => Promise<boolean>, minute = 0) => {
    const runJob = run(label, job);
    const at = `${hour}:${String(minute).padStart(2, "0")}`;
    const schedule = () => {
      const delay = msUntilNext(hour, minute);
      console.log(`[sync] ${label} schemalagda om ${Math.round(delay / 60000)} min (nästa ${at})`);
      setTimeout(async () => {
        await runJob();
        schedule();
      }, delay);
    };
    schedule();
  };
```

Registrera jobbet och uppdatera loggraden:

```ts
  daily(NEWS_HOUR_LOCAL, "nyheter", syncNewsAndFilter);
  daily(TEAMS_HOUR_LOCAL, "lag", syncTeams);
  daily(RADIO_TIME_LOCAL.hour, "radio", syncRadio, RADIO_TIME_LOCAL.minute);

  console.log(
    "[sync] schemalagt: nyheter kl 22:00, lag (tabeller, matcher, målskyttar) kl 23:00, radio kl 23:30",
  );
```

- [ ] **Step 4: Lägg till valet i workflowen**

I `.github/workflows/sync.yml`, under `options:`:

```yaml
          - teams
          - news
          - radio
```

- [ ] **Step 5: Jobbkort på systemstatus**

I `app/systemstatus/page.tsx`: lägg till `radioEpisodes` i schema-importen. I `Promise.all`-destruktureringen, lägg `lastRadio` direkt efter `lastPodcastFetch`, och motsvarande fråga direkt efter poddfrågan:

```ts
    getMax(db.select({ m: sql<Date | null>`max(${radioEpisodes.createdAt})` }).from(radioEpisodes)),
```

Efter jobbkortet "Poddavsnitt":

```tsx
            <JobCard title="Matchradion" cadence="Veckovis, måndag 23:30" lastRun={lastRadio} />
```

- [ ] **Step 6: Typkontroll, lint och tester**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: inga typfel, inga nya lintfel, alla tester gröna.

- [ ] **Step 7: Commit**

```bash
git add lib/sync.ts app/api/sync/route.ts instrumentation.ts .github/workflows/sync.yml app/systemstatus/page.tsx
git commit -m "feat(radio): schedule daily 23:30, manual target=radio, status card"
```

---

### Task 8: Jingel och publikbädd (`scripts/generate-radio-sounds.mts`)

**Files:**
- Create: `scripts/generate-radio-sounds.mts`
- Modify: `package.json` (scripts)
- Create (genererade): `public/radio/jingle.mp3`, `public/radio/crowd.mp3`

**Interfaces:**
- Produces: de statiska filerna `/radio/jingle.mp3` och `/radio/crowd.mp3` som spelaren (Task 9) hämtar.

Kräver `ELEVENLABS_API_KEY` i `.env`. Kostar ElevenLabs-krediter per körning.

- [ ] **Step 1: Skriv skriptet**

`scripts/generate-radio-sounds.mts`:

```ts
// Genererar Matchradions statiska ljud en gång med ElevenLabs Sound Effects.
// Kör: npm run radio:sounds            (båda)
//      npm run radio:sounds -- crowd   (bara en)
// Lyssna, kör om tills det låter rätt och checka in filerna i public/radio/.
// Varje körning kostar ElevenLabs-krediter.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SOUNDS = {
  jingle: {
    text: "Short upbeat sports radio jingle, punchy brass stab and drum hit, energetic, clean ending, no vocals",
    duration_seconds: 4,
    loop: false,
  },
  crowd: {
    text: "Ambient crowd at a small outdoor amateur football match, a few hundred spectators, murmur and distant cheering, no music, no announcer",
    duration_seconds: 20,
    loop: true,
  },
};

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY saknas i .env");
  process.exit(1);
}

const OUT = path.join(process.cwd(), "public", "radio");
mkdirSync(OUT, { recursive: true });
const wanted = process.argv.slice(2);

for (const [name, body] of Object.entries(SOUNDS)) {
  if (wanted.length > 0 && !wanted.includes(name)) continue;
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, prompt_influence: 0.5 }),
  });
  if (!res.ok) {
    console.error(`${name}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const file = path.join(OUT, `${name}.mp3`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`Skrev ${file}`);
}
```

- [ ] **Step 2: Lägg till npm-skriptet**

I `package.json` under `"scripts"`, efter `"images:lag"`:

```json
    "radio:sounds": "tsx --env-file=.env scripts/generate-radio-sounds.mts"
```

- [ ] **Step 3: Generera ljuden (kräver Alex nyckel)**

Kontrollera att `ELEVENLABS_API_KEY` finns i `.env` (fråga Alex om den saknas — skriv inte in den själv).

Run: `npm run radio:sounds`
Expected: `Skrev …\public\radio\jingle.mp3` och `Skrev …\public\radio\crowd.mp3`.

- [ ] **Step 4: Låt Alex lyssna**

Be Alex lyssna på båda filerna. Kör om enskilda ljud (`npm run radio:sounds -- jingle`) och justera `text` i skriptet tills Alex är nöjd. Gå inte vidare till commit utan Alex ok.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-radio-sounds.mts package.json public/radio/jingle.mp3 public/radio/crowd.mp3
git commit -m "feat(radio): generated jingle and crowd bed (ElevenLabs Sound Effects)"
```

---

### Task 9: Spelaren på startsidan

**Files:**
- Create: `app/components/home/radio-player.tsx`
- Modify: `app/components/home/sidebar.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `radioEpisodes` (Task 6), `/radio/jingle.mp3` och `/radio/crowd.mp3` (Task 8).
- Produces: `RadioPlayer` och `type RadioEpisodeView = { title: string; dateLabel: string; audioUrl: string; script: string }` från `radio-player.tsx`; `Sidebar` får propen `radio: RadioEpisodeView | null`.

Läs först `node_modules/next/dist/docs/` om klientkomponenter (`"use client"`) enligt `AGENTS.md`.

- [ ] **Step 1: Skriv spelaren**

`app/components/home/radio-player.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

// Matchradions spelare. Hela programmet mixas i webbläsaren med Web Audio och
// schemaläggs på ljudklockan vid klicket:
//   jingel → röst (publikbädden tonas in och loopar lågt under) →
//   publiken tonas ut → jingel.
// Paus = suspend() på klockan, så allt håller takten. Inget laddas förrän
// besökaren klickar på play.

const JINGLE_URL = "/radio/jingle.mp3";
const CROWD_URL = "/radio/crowd.mp3";
const CROWD_VOLUME = 0.18;
const FADE_S = 1.5;

export type RadioEpisodeView = { title: string; dateLabel: string; audioUrl: string; script: string };

type Buffers = { jingle: AudioBuffer; crowd: AudioBuffer; voice: AudioBuffer };
type Show = { start: number; total: number };
type State = "idle" | "loading" | "playing" | "paused" | "error";

async function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

/** Lägger ut hela programmet på ljudklockan och returnerar start och längd. */
function scheduleShow(ctx: AudioContext, b: Buffers): Show {
  const t0 = ctx.currentTime + 0.05;
  const voiceAt = t0 + b.jingle.duration;
  const voiceEnd = voiceAt + b.voice.duration;
  const outroAt = voiceEnd + FADE_S;

  const play = (buffer: AudioBuffer, at: number, dest: AudioNode = ctx.destination) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    src.start(at);
    return src;
  };

  play(b.jingle, t0);
  play(b.voice, voiceAt);

  const crowdGain = ctx.createGain();
  crowdGain.connect(ctx.destination);
  crowdGain.gain.setValueAtTime(0, voiceAt);
  crowdGain.gain.linearRampToValueAtTime(CROWD_VOLUME, voiceAt + FADE_S);
  crowdGain.gain.setValueAtTime(CROWD_VOLUME, voiceEnd);
  crowdGain.gain.linearRampToValueAtTime(0, voiceEnd + FADE_S);
  const crowd = play(b.crowd, voiceAt, crowdGain);
  crowd.loop = true;
  crowd.stop(voiceEnd + FADE_S);

  play(b.jingle, outroAt);
  return { start: t0, total: outroAt + b.jingle.duration - t0 };
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M5 3.5v11l9-5.5-9-5.5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M5 3.5h3v11H5zM10 3.5h3v11h-3z" fill="currentColor" />
    </svg>
  );
}

export function RadioPlayer({ title, dateLabel, audioUrl, script }: RadioEpisodeView) {
  // Ett stabilt objekt med föränderliga fält, så att städningen nedan når
  // den AudioContext som skapas först vid klick.
  const audio = useRef<{ ctx: AudioContext | null; buffers: Buffers | null }>({ ctx: null, buffers: null });
  const [state, setState] = useState<State>("idle");
  const [show, setShow] = useState<Show | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const holder = audio.current;
    return () => {
      void holder.ctx?.close();
    };
  }, []);

  // Förloppet följer ljudklockan (står still när den är pausad).
  useEffect(() => {
    if (state !== "playing" || !show) return;
    const id = setInterval(() => {
      const ctx = audio.current.ctx;
      if (!ctx) return;
      const t = ctx.currentTime - show.start;
      if (t >= show.total) {
        setElapsed(0);
        setState("idle");
      } else {
        setElapsed(Math.max(0, t));
      }
    }, 250);
    return () => clearInterval(id);
  }, [state, show]);

  async function onClick() {
    const holder = audio.current;
    if (state === "loading") return;
    if (state === "playing" && holder.ctx) {
      await holder.ctx.suspend();
      setState("paused");
      return;
    }
    if (state === "paused" && holder.ctx) {
      await holder.ctx.resume();
      setState("playing");
      return;
    }
    // idle eller error: (ladda och) spela programmet från början.
    // AudioContext skapas i klicket så att webbläsaren tillåter ljud.
    const ctx = (holder.ctx ??= new AudioContext());
    if (!holder.buffers) {
      setState("loading");
      try {
        const [jingle, crowd, voice] = await Promise.all([
          loadBuffer(ctx, JINGLE_URL),
          loadBuffer(ctx, CROWD_URL),
          loadBuffer(ctx, audioUrl),
        ]);
        holder.buffers = { jingle, crowd, voice };
      } catch (err) {
        console.error("[radio] kunde inte ladda ljudet:", err);
        setState("error");
        return;
      }
    }
    await ctx.resume();
    setElapsed(0);
    setShow(scheduleShow(ctx, holder.buffers));
    setState("playing");
  }

  const playing = state === "playing";
  const progress = show ? Math.min(1, elapsed / show.total) : 0;
  const status =
    state === "error" ? "Kunde inte ladda ljudet – försök igen" : state === "loading" ? "Laddar …" : dateLabel;

  return (
    <div className="rounded-xl border border-line bg-surface-raised p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={state === "loading"}
          aria-label={playing ? `Pausa ${title}` : `Spela ${title}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-surface-dark transition-transform hover:scale-105 disabled:opacity-60"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <p className="text-xs text-ink-muted">{status}</p>
        </div>
        <span className="text-xs tabular-nums text-ink-muted">
          {fmt(elapsed)}
          {show ? ` / ${fmt(show.total)}` : ""}
        </span>
      </div>
      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label="Förlopp"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
          Läs manuset
        </summary>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{script}</p>
      </details>
      <p className="mt-2 text-[11px] text-ink-muted">AI-genererat från veckans resultat · Röst: ElevenLabs</p>
    </div>
  );
}
```

- [ ] **Step 2: Visa spelaren överst i sidospalten**

I `app/components/home/sidebar.tsx`, lägg till importen:

```tsx
import { RadioPlayer, type RadioEpisodeView } from "./radio-player";
```

Ändra signaturen och kommentaren:

```tsx
// Sidospalten: Matchradion, länkar till serierna och de senaste poddavsnitten.
export function Sidebar({
  radio,
  leagues,
  podcasts,
}: {
  radio: RadioEpisodeView | null;
  leagues: { id: string; name: string }[];
  podcasts: PodcastGroup[];
}) {
```

Som första barn i `<aside className="space-y-10">`:

```tsx
      {radio && (
        <section className="reveal">
          <SectionHeading>Matchradion</SectionHeading>
          <RadioPlayer {...radio} />
        </section>
      )}
```

- [ ] **Step 3: Hämta senaste avsnittet på startsidan**

I `app/page.tsx`: lägg till `radioEpisodes` i schema-importen och `import type { RadioEpisodeView } from "./components/home/radio-player";`.

Utöka destruktureringen till `[allLeagues, localTeamRows, standingRows, localMatches, newsRows, podRows, radioRows]` och lägg sist i `Promise.all`:

```ts
      db
        .select({
          id: radioEpisodes.id,
          weekStart: radioEpisodes.weekStart,
          script: radioEpisodes.script,
          audioUrl: radioEpisodes.audioUrl,
        })
        .from(radioEpisodes)
        .orderBy(desc(radioEpisodes.weekStart))
        .limit(1),
```

Ovanför `export default async function Home()`:

```ts
const radioDateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});

/** "Vecka 41" + "5 okt. – 11 okt." för senaste avsnittet. */
function radioView(row: { id: string; weekStart: Date; script: string; audioUrl: string }): RadioEpisodeView {
  // +6,5 dygn landar säkert på söndagen även veckan sommartiden slutar
  const sunday = new Date(row.weekStart.getTime() + 6.5 * 24 * 60 * 60 * 1000);
  return {
    title: `Vecka ${Number(row.id.slice(6))}`,
    dateLabel: `${radioDateFmt.format(row.weekStart)} – ${radioDateFmt.format(sunday)}`,
    audioUrl: row.audioUrl,
    script: row.script,
  };
}
```

Efter `podcasts`-beräkningen:

```ts
  const radio = radioRows[0] ? radioView(radioRows[0]) : null;
```

Och i JSX:

```tsx
        <Sidebar radio={radio} leagues={allLeagues} podcasts={podcasts} />
```

- [ ] **Step 4: Typkontroll, lint och tester**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: inga typfel, inga nya lintfel, alla tester gröna.

- [ ] **Step 5: Commit**

```bash
git add app/components/home/radio-player.tsx app/components/home/sidebar.tsx app/page.tsx
git commit -m "feat(radio): player in home sidebar with Web Audio mix of jingle, voice and crowd"
```

---

### Task 10: Driftsättning och verifiering mot riktig data

Kräver Alex medverkan: nycklar, röstval, ok att skriva till databasen och lyssning. Varje steg som skriver till databasen eller Storage kräver ett uttryckligt ja i chatten.

- [ ] **Step 1: Skapa Storage-bucketen**

Med Alex ok: skapa en publik bucket `radio` i Supabase-projektet `kommunfotboll` (Dashboard → Storage → New bucket, "Public" på), eller via Supabase-MCP:ns `execute_sql`:

```sql
insert into storage.buckets (id, name, public) values ('radio', 'radio', true) on conflict (id) do nothing;
```

- [ ] **Step 2: Välj röst**

Alex väljer en röst i ElevenLabs Voice Library (filtrera på svenska), lägger till den under "My voices" och kopierar röst-id:t. Alex lägger in `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` i `.env` lokalt och i Render (Environment). Skriv aldrig in nycklarna själv.

- [ ] **Step 3: Generera ett avsnitt lokalt**

Kontrollera vilken databas `DATABASE_URL` i `.env.local` pekar på och säg det till Alex. Med Alex ok:

Run: `npx tsx --env-file=.env --env-file=.env.local -e "import('./lib/radio/generate').then(m => m.generateEpisode()).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); })"`
Expected: `[radio] 2026-W40: avsnitt klart (… tecken)` (eller veckan som är senast avslutad), eller `inga spelade lokala matcher` under lågsäsong.

Om uppladdningen ger 400/401/403 med en ny Supabase-nyckel (`sb_secret_…`): pröva den äldre `service_role`-JWT:n från Dashboard → Settings → API.

- [ ] **Step 4: Kontrollera manus och ljud**

Läs manuset ur databasen (`select script from radio_episodes order by week_start desc limit 1`) och jämför varje faktapåstående mot `matches`, `match_goals`, `match_quotes` och `table_rows`. Inga påhittade händelser eller citat får finnas. Öppna `audio_url` och låt Alex lyssna.

Behöver avsnittet göras om (annan röst, promptjustering): med Alex ok, `delete from radio_episodes where id = '<veckonyckel>'` och kör Step 3 igen.

- [ ] **Step 5: Kontrollera citatextraktionen**

Hitta en DV-matchrapport om ett lokalt lag som innehåller citat. Med Alex ok, kör om extraktionen på den:

Run: `npx tsx --env-file=.env --env-file=.env.local -e "import('./lib/goals').then(m => m.reextractReports(['<rapport-url>'])).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); })"`

Kontrollera `select * from match_quotes order by match_id, ord` — citaten ska stå ordagrant i artikeln, högst två per match.

- [ ] **Step 6: Kontrollera spelaren i webbläsaren**

Be Alex starta dev-servern (port 3001) om den inte redan kör — starta den inte själv. Öppna startsidan i den inbyggda webbläsaren:
- Matchradion-sektionen syns överst i sidospalten med "Vecka NN" och datum.
- Klick på play: jingel, sedan röst med publik lågt under, sedan jingel. Paus och fortsätt håller takten. Tid och förloppsindikator rör sig.
- Inga fel i konsolen (särskilt CORS mot Supabase-URL:en).
- "Läs manuset" visar texten. Mobilbredd (375 px): inget horisontellt överflöd.
- `/systemstatus` visar jobbkortet "Matchradion".

Ta en skärmdump som bevis.

- [ ] **Step 7: Commit av eventuella justeringar och push**

Committa eventuella justeringar (prompt, volym, ljud) med beskrivande meddelanden. Pusha bara när Alex ber om det.
