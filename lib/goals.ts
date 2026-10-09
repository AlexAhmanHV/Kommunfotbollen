import Anthropic from "@anthropic-ai/sdk";
import { eq, inArray, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { articles, articleTeams, matches, matchGoals, dvReports, teams } from "./db/schema";
import { LOCAL_TEAM_IDS, TEAM_NEWS_ALIASES } from "./local-teams";
import {
  PAPERS,
  type Paper,
  discoverArticleUrls,
  extractArticleText,
  fetchWithTimeout,
  mentionsLocalTeam,
  sleep,
  FETCH_GAP_MS,
} from "./newspaper-sections";

// Målskyttar från fria, server-renderade matchrapporter — Dagens Västervik
// OCH Vimmerby Tidning (verifierat fri från betalvägg, till skillnad från VT).
// Flöde per tidning: hitta fotbollsartiklarna (sitemap/sektionssida, se
// newspaper-sections.ts) → hämta texten → nämns inget lokalt lag: markera
// läst och gå vidare → annars AI-extrahera skyttar →
// koppla till en match i DB (kräver att BÅDE lagnamn och resultat stämmer,
// annars ingen koppling). Fail-open: utan API-nyckel/parsningsfel hoppas steget
// över och rapporten kan försökas igen (men bearbetade URL:er dedupas).

const MODEL = "claude-haiku-4-5";
// Nya artiklar att läsa per tidning och körning. Alla fotbollsartiklar läses
// (inte bara de med lagnamn i rubriken), så gränsen är satt för att rymma en
// hel matchdag — och för att första körningarna ska fylla på bakåt i omgångar.
const MAX_REPORTS_PER_RUN = 40;
// Hur långt bak referat letas (samma fönster som nyhetslistan).
const REPORT_WINDOW_DAYS = 60;

type Db = Awaited<ReturnType<typeof getDb>>;

// AI:n returnerar ibland ett mål med tomt spelarnamn trots instruktionen att
// hoppa över dem. Släng just de målen — inte hela referatet, som annars
// markerades bearbetat och tappades för gott.
// Platshållare som AI:n ibland skriver i stället för att hoppa över målet.
const UNKNOWN_PLAYER = /^(okänd|okänd spelare|okänd målskytt|oklart|ej namngiven|n\/?a|-)$/i;

const namedGoalsSchema = z
  .array(z.object({ team: z.string(), player: z.string() }))
  .transform((goals) =>
    goals
      .map((g) => ({ ...g, player: g.player.trim() }))
      .filter((g) => g.player !== "" && !UNKNOWN_PLAYER.test(g.player)),
  );

const goalSchema = z.object({
  homeTeam: z.string(),
  awayTeam: z.string(),
  homeScore: z.number().int(),
  awayScore: z.number().int(),
  goals: namedGoalsSchema,
});

/** Första kompletta JSON-objektet i AI-svaret (modellen skriver ibland text efter). */
function parseFirstJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("inget JSON-objekt i svaret");
  let depth = 0;
  let inString = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(raw.slice(start, i + 1));
  }
  throw new Error("ofullständigt JSON-objekt i svaret");
}
type Extracted = z.infer<typeof goalSchema>;

const SYSTEM = `Du läser en svensk lokaltidnings matchreferat om fotboll och extraherar målskyttarna.
Svara med ENBART giltig JSON enligt:
{"homeTeam":"","awayTeam":"","homeScore":0,"awayScore":0,"goals":[{"team":"<lagnamn exakt som i texten>","player":"<spelarens namn>"}]}
Regler:
- homeTeam/awayTeam = de två lagen (hemmalag först om det framgår, annars valfri ordning).
- goals listas i den ordning målen gjordes. team = det lag vars spelare gjorde målet (använd lagnamnet som det skrivs i texten).
- Ta bara med RIKTIGA mål i matchen. Uteslut straffläggning efter oavgjort, självmål-oklarheter räknas till det lag som fick målet.
- Självmål: skriv player som "Självmål" (aldrig ett lagnamn).
- Om ett mål saknar namngiven skytt, hoppa över det målet.
- Om texten inte är ett matchreferat med resultat, svara {"homeTeam":"","awayTeam":"","homeScore":0,"awayScore":0,"goals":[]}.`;

// AI:n skriver ibland ett lagnamn som "spelare" när texten bara säger att det
// blev självmål. Spara sådana — och allt som redan heter självmål — enhetligt.
function playerOrOwnGoal(player: string, homeName: string, awayName: string): string {
  const p = normalize(player);
  if (p.includes("självmål") || p === normalize(homeName) || p === normalize(awayName)) {
    return "Självmål";
  }
  return player;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[./\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Matchar ett DB-lag (namn + id för ev. alias) mot lagnamnet som tidningen skrev.
function teamNameMatches(dbName: string, teamId: string, reported: string): boolean {
  const a = normalize(dbName);
  const b = normalize(reported);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // delade särskiljande tokens (t.ex. "tuna", "gunnebo")
  const bTokens = b.split(" ");
  if (a.split(" ").some((w) => w.length >= 4 && bTokens.includes(w))) return true;
  // lokala alias (t.ex. B.O.IF ~ "blackstad odensvi"/"boif")
  for (const alias of TEAM_NEWS_ALIASES[teamId] ?? []) {
    if (b.includes(normalize(alias))) return true;
  }
  return false;
}

export async function syncGoals(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return; // utan nyckel: hoppa över

  const db = await getDb();
  const now = new Date();

  // alla bevakade lags matcher är intressanta — ladda lagnamn en gång
  const allTeams = await db.select({ id: teams.id, name: teams.name }).from(teams);
  const teamName = new Map(allTeams.map((t) => [t.id, t.name]));
  const client = new Anthropic({ apiKey });

  // VT:s brödtext ligger bakom betalvägg — dess rubriker täcks av
  // syncGoalsFromArticles nedan.
  for (const paper of PAPERS.filter((p) => p.bodyReadable)) {
    try {
      await syncGoalsFromPaper(db, client, teamName, now, paper);
    } catch (err) {
      // en trasig tidning ska inte stoppa den andra
      console.error(`[goals] ${paper.name} misslyckades:`, err);
    }
  }
}

async function syncGoalsFromPaper(
  db: Db,
  client: Anthropic,
  teamName: Map<string, string>,
  now: Date,
  paper: Paper,
): Promise<void> {
  const urls = await discoverArticleUrls(paper, REPORT_WINDOW_DAYS, now);
  if (urls.length === 0) return;

  // hoppa över redan bearbetade URL:er (delad dedup över båda tidningarna) —
  // slå bara upp de här URL:erna, inte hela den växande tabellen
  const done = new Set(
    (
      await db.select({ url: dvReports.url }).from(dvReports).where(inArray(dvReports.url, urls))
    ).map((r) => r.url),
  );
  const todo = urls.filter((u) => !done.has(u)).slice(0, MAX_REPORTS_PER_RUN);
  await processReports(db, client, teamName, now, todo);
}

/** Läser om referat från början: tar bort deras sparade skyttar och
 * bearbetningsmarkering och extraherar igen (t.ex. efter en rättad textläsning). */
export async function reextractReports(urls: string[]): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || urls.length === 0) return;

  const db = await getDb();
  await db.delete(matchGoals).where(inArray(matchGoals.sourceUrl, urls));
  await db.delete(dvReports).where(inArray(dvReports.url, urls));

  const allTeams = await db.select({ id: teams.id, name: teams.name }).from(teams);
  const teamName = new Map(allTeams.map((t) => [t.id, t.name]));
  await processReports(db, new Anthropic({ apiKey }), teamName, new Date(), urls);
}

async function processReports(
  db: Db,
  client: Anthropic,
  teamName: Map<string, string>,
  now: Date,
  urls: string[],
): Promise<void> {
  for (const url of urls) {
    await sleep(FETCH_GAP_MS); // artig mot tidningen — undvik rate-limit
    let text: string;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = extractArticleText(await res.text());
    } catch (err) {
      // transient hämtningsfel — lämna obearbetad, försök igen nästa körning
      console.error(`[goals] kunde inte hämta ${url}:`, err);
      continue;
    }

    // Alla fotbollsartiklar läses nu, även andra orters — bara de som nämner
    // ett lokalt lag är värda ett AI-anrop. Markera resten som lästa.
    if (!mentionsLocalTeam(text)) {
      await db
        .insert(dvReports)
        .values({ url, matchId: null, checkedAt: now })
        .onConflictDoNothing();
      continue;
    }

    let data: Extracted;
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: text }],
      });
      const raw = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");
      data = goalSchema.parse(parseFirstJsonObject(raw));
    } catch (err) {
      // API-/parsningsfel: markera bearbetad så vi inte betalar om och om igen
      console.error(`[goals] AI-extraktion misslyckades för ${url}:`, err);
      await db
        .insert(dvReports)
        .values({ url, matchId: null, checkedAt: now })
        .onConflictDoNothing();
      continue;
    }

    const matchId = await linkAndStore(db, data, url, teamName);
    await db
      .insert(dvReports)
      .values({ url, matchId, checkedAt: now })
      .onConflictDoUpdate({ target: dvReports.url, set: { matchId, checkedAt: now } });
  }
}

// Kopplar extraherade skyttar till rätt match och sparar dem. Returnerar
// match-id om kopplingen lyckades, annars null (ingen gissning).
async function linkAndStore(
  db: Db,
  data: Extracted,
  url: string,
  teamName: Map<string, string>,
): Promise<string | null> {
  if (data.goals.length === 0 && data.homeScore === 0 && data.awayScore === 0) {
    return null; // inte ett matchreferat
  }

  // kandidater: färdigspelade matcher vars resultat matchar rapporten (endera
  // orienteringen), och där båda lagnamnen kan resolvas mot rapportens lag.
  // (homeScore/awayScore är nullable i schemat, men en FINISHED match har
  // alltid resultat satt — filtrera bort ev. anomalier och få bort null från typen.)
  const finished = (
    await db
      .select({
        id: matches.id,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
      })
      .from(matches)
      .where(eq(matches.status, "FINISHED"))
  ).filter(
    (m): m is typeof m & { homeScore: number; awayScore: number } =>
      m.homeScore != null && m.awayScore != null,
  );

  type Cand = { id: string; homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number };
  const hits: Cand[] = [];
  for (const m of finished) {
    const hn = teamName.get(m.homeTeamId) ?? "";
    const an = teamName.get(m.awayTeamId) ?? "";
    const scoreDirect =
      m.homeScore === data.homeScore && m.awayScore === data.awayScore;
    const scoreSwapped =
      m.homeScore === data.awayScore && m.awayScore === data.homeScore;
    if (
      scoreDirect &&
      teamNameMatches(hn, m.homeTeamId, data.homeTeam) &&
      teamNameMatches(an, m.awayTeamId, data.awayTeam)
    ) {
      hits.push(m);
    } else if (
      scoreSwapped &&
      teamNameMatches(hn, m.homeTeamId, data.awayTeam) &&
      teamNameMatches(an, m.awayTeamId, data.homeTeam)
    ) {
      hits.push(m);
    }
  }

  if (hits.length !== 1) return null; // ingen entydig match → koppla inte
  const match = hits[0];

  // bara lokala lags matcher är intressanta — övriga lag i samma serier
  // (t.ex. IF Stjärnan–Södra Vi IF) är brus vi inte ska lägga tid/kostnad på
  if (!LOCAL_TEAM_IDS.has(match.homeTeamId) && !LOCAL_TEAM_IDS.has(match.awayTeamId)) {
    return null;
  }

  // redan skyttar sparade för matchen? låt vara.
  const existing = await db
    .select({ n: sql<number>`count(*)` })
    .from(matchGoals)
    .where(eq(matchGoals.matchId, match.id));
  if ((existing[0]?.n ?? 0) > 0) return match.id;

  // resolva varje måls lag till hemma/borta i den funna matchen
  const hn = teamName.get(match.homeTeamId) ?? "";
  const an = teamName.get(match.awayTeamId) ?? "";
  const resolved: { teamId: string; player: string }[] = [];
  for (const g of data.goals) {
    if (teamNameMatches(hn, match.homeTeamId, g.team)) {
      resolved.push({ teamId: match.homeTeamId, player: playerOrOwnGoal(g.player, hn, an) });
    } else if (teamNameMatches(an, match.awayTeamId, g.team)) {
      resolved.push({ teamId: match.awayTeamId, player: playerOrOwnGoal(g.player, hn, an) });
    }
    // okänt lag för målet → droppa (fångas av konsistenskollen nedan)
  }

  // Spärr mot FELAKTIG extraktion: ett lag kan aldrig ha fler namngivna
  // skyttar än sina mål (fångar överextraktion / fel lag-attribuering, t.ex.
  // 3 skyttar på 2 mål). Färre är okej — då visar vi en partiell lista.
  // Kräver minst en resolvad skytt (annars inget att visa).
  const homeGoals = resolved.filter((r) => r.teamId === match.homeTeamId).length;
  const awayGoals = resolved.filter((r) => r.teamId === match.awayTeamId).length;
  if (
    resolved.length === 0 ||
    homeGoals > match.homeScore ||
    awayGoals > match.awayScore
  ) {
    return match.id;
  }

  let ord = 0;
  for (const r of resolved) {
    await db
      .insert(matchGoals)
      .values({ matchId: match.id, ord: ord++, teamId: r.teamId, player: r.player, sourceUrl: url })
      .onConflictDoNothing();
  }
  return match.id;
}

// --- Bakåtfyllnad: skyttar ur redan hämtade nyhetsartiklar -----------------
// Nyhetslistan (lib/news.ts) innehåller även VT:s artiklar, vars brödtext
// ligger bakom betalvägg. Många rubriker namnger målskytten direkt ("Simon
// Sandholm gjorde två i Hjorted/Totebos seger"), så vi slipper hämta något
// alls — bara läsa det vi redan har lagrat (titel + ev. ingress).
//
// En rubrik + ingress innehåller sällan slutresultatet, så AI:n kan inte
// läsa av det ur texten. Vi löser det
// genom att FÖRST hitta en entydig kandidatmatch (ett taggat lag, publicerad
// nära matchdatumet) och ge AI:n det riktiga resultatet som fakta — den
// behöver bara läsa ut namnen, inte gissa siffror.

const ARTICLE_GOAL_SYSTEM = `Du läser en kort sportnotis (rubrik + ev. ingress) om en fotbollsmatch vars lag och slutresultat redan är kända och givna till dig i prompten.
Svara med ENBART giltig JSON: {"goals":[{"team":"<endera lagnamnet, EXAKT som angivet>","player":"<spelarens namn>"}]}
Regler:
- Ta bara med spelare som texten EXPLICIT säger gjorde mål (inte spelare som bara omnämns, byts in, blir utvisade etc).
- "team" måste vara exakt ett av de två lagnamnen som anges i prompten.
- Om texten inte namnger några målskyttar: svara {"goals":[]}.`;

const articleGoalSchema = z.object({ goals: namedGoalsSchema });

// Rapporter kommer EFTER matchen, inte symmetriskt runt den — ett symmetriskt
// fönster fångar ofta både förra och nästa omgångens match för samma lag
// (spelas ~veckovis) och gör kandidaten tvetydig. Matchen ska ligga strax
// FÖRE artikeln (upp till 4 dygn innan), med lite slack för samma kväll.
const ARTICLE_GOAL_BEFORE_MS = 4 * 24 * 60 * 60 * 1000;
const ARTICLE_GOAL_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_ARTICLES_PER_RUN = 25;

// Domäner vi vet servar artikeltext fritt/server-renderat (verifierat manuellt
// — DV har ingen betalvägg, Vimmerby Tidning likaså trots att sidan innehåller
// generisk prenumerations-UI-text). VT är UTESLUTET (bekräftat betalvägg +
// klient-renderat, ingen artikeltext går att hämta server-side).
const FETCHABLE_DOMAINS = new Set(["dagensvastervik.se", "vimmerbytidning.se"]);

function fetchableUrl(articleId: string): string | null {
  try {
    const u = new URL(articleId);
    const host = u.hostname.replace(/^www\./, "");
    return FETCHABLE_DOMAINS.has(host) ? articleId : null;
  } catch {
    return null;
  }
}

async function extractGoalsFromText(
  client: Anthropic,
  prompt: string,
): Promise<z.infer<typeof articleGoalSchema>> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: ARTICLE_GOAL_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  return articleGoalSchema.parse(parseFirstJsonObject(raw));
}

function isReportWindow(matchStartsAt: Date, publishedAt: Date): boolean {
  const diff = publishedAt.getTime() - matchStartsAt.getTime();
  return diff >= -ARTICLE_GOAL_AFTER_MS && diff <= ARTICLE_GOAL_BEFORE_MS;
}

export async function syncGoalsFromArticles(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const db = await getDb();
  const now = new Date();

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      summary: articles.summary,
      publishedAt: articles.publishedAt,
      teamId: articleTeams.teamId,
    })
    .from(articles)
    .innerJoin(articleTeams, eq(articleTeams.articleId, articles.id))
    // redan bearbetade artiklar filtreras i databasen i stället för att hela
    // dv_reports läses in
    .where(
      notExists(
        db.select({ one: sql`1` }).from(dvReports).where(eq(dvReports.url, articles.id)),
      ),
    );

  // gruppera lag-taggar per artikel, hoppa redan bearbetade. Endast lokala
  // lag är intressanta (defensivt filter — TEAM_NEWS_ALIASES täcker redan
  // bara dessa, men skyddar även om det utökas i framtiden).
  const byArticle = new Map<
    string,
    { title: string; summary: string | null; publishedAt: Date; teamIds: string[] }
  >();
  for (const r of rows) {
    if (!LOCAL_TEAM_IDS.has(r.teamId)) continue;
    const existing = byArticle.get(r.id);
    if (existing) existing.teamIds.push(r.teamId);
    else
      byArticle.set(r.id, {
        title: r.title,
        summary: r.summary,
        publishedAt: r.publishedAt,
        teamIds: [r.teamId],
      });
  }

  const candidates = [...byArticle.entries()].slice(0, MAX_ARTICLES_PER_RUN);
  if (candidates.length === 0) return;

  const allTeams = await db.select({ id: teams.id, name: teams.name }).from(teams);
  const teamName = new Map(allTeams.map((t) => [t.id, t.name]));
  const finished = (
    await db
      .select({
        id: matches.id,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
        homeScore: matches.homeScore,
        awayScore: matches.awayScore,
        startsAt: matches.startsAt,
      })
      .from(matches)
      .where(eq(matches.status, "FINISHED"))
  ).filter(
    (m): m is typeof m & { homeScore: number; awayScore: number } =>
      m.homeScore != null && m.awayScore != null,
  );

  const client = new Anthropic({ apiKey });

  for (const [articleId, art] of candidates) {
    // entydig kandidatmatch: ett taggat lag spelade, rapporten publicerad strax efter
    const hits = finished.filter(
      (m) =>
        (art.teamIds.includes(m.homeTeamId) || art.teamIds.includes(m.awayTeamId)) &&
        isReportWindow(m.startsAt, art.publishedAt),
    );
    if (hits.length !== 1) {
      // ingen entydig match → markera bearbetad, ingen koppling
      await db
        .insert(dvReports)
        .values({ url: articleId, matchId: null, checkedAt: now })
        .onConflictDoNothing();
      continue;
    }
    const match = hits[0];

    const existingGoals = await db
      .select({ n: sql<number>`count(*)` })
      .from(matchGoals)
      .where(eq(matchGoals.matchId, match.id));
    if ((existingGoals[0]?.n ?? 0) > 0) {
      await db
        .insert(dvReports)
        .values({ url: articleId, matchId: match.id, checkedAt: now })
        .onConflictDoNothing();
      continue;
    }

    const hn = teamName.get(match.homeTeamId) ?? "";
    const an = teamName.get(match.awayTeamId) ?? "";
    const scoreLine = `Hemmalag: ${hn} (${match.homeScore} mål)\nBortalag: ${an} (${match.awayScore} mål)`;
    const shortPrompt = `${scoreLine}\n\nRubrik: ${art.title}${
      art.summary ? `\nIngress: ${art.summary}` : ""
    }`;

    let parsed: z.infer<typeof articleGoalSchema>;
    try {
      parsed = await extractGoalsFromText(client, shortPrompt);
    } catch (err) {
      // lämna obearbetad — försök igen nästa körning
      console.error(`[goals] artikel-extraktion misslyckades för ${articleId}:`, err);
      continue;
    }

    // Eskalering: titel+ingress gav FÄRRE skyttar än matchens totala målantal
    // (helt tomt, eller bara någon av dem — ingressen nämner ofta bara första
    // målskytten även när referatet räknar upp alla), och artikeln har en
    // URL vi vet kan läsas fritt (DV/Vimmerby T, inte VT:s betalvägg) —
    // hämta hela texten och ge det en andra chans.
    const expectedGoals = match.homeScore + match.awayScore;
    if (parsed.goals.length < expectedGoals) {
      const fullUrl = fetchableUrl(articleId);
      if (fullUrl) {
        await sleep(FETCH_GAP_MS);
        try {
          const res = await fetchWithTimeout(fullUrl);
          if (res.ok) {
            const bodyText = extractArticleText(await res.text());
            const longPrompt = `${scoreLine}\n\n${bodyText}`;
            const longResult = await extractGoalsFromText(client, longPrompt);
            // fulltexten är en strikt utökning — behåll bara om den hittade
            // FLER skyttar, annars är kortversionen minst lika bra.
            if (longResult.goals.length > parsed.goals.length) parsed = longResult;
          }
        } catch (err) {
          // fulltext-hämtningen är ett rent tillägg — misslyckas den behåller
          // vi bara resultatet från titel+ingress
          console.error(`[goals] fulltext-hämtning misslyckades för ${articleId}:`, err);
        }
      }
    }

    const resolved: { teamId: string; player: string }[] = [];
    for (const g of parsed.goals) {
      if (teamNameMatches(hn, match.homeTeamId, g.team)) {
        resolved.push({ teamId: match.homeTeamId, player: playerOrOwnGoal(g.player, hn, an) });
      } else if (teamNameMatches(an, match.awayTeamId, g.team)) {
        resolved.push({ teamId: match.awayTeamId, player: playerOrOwnGoal(g.player, hn, an) });
      }
    }
    const homeGoals = resolved.filter((r) => r.teamId === match.homeTeamId).length;
    const awayGoals = resolved.filter((r) => r.teamId === match.awayTeamId).length;
    if (resolved.length > 0 && homeGoals <= match.homeScore && awayGoals <= match.awayScore) {
      let ord = 0;
      for (const r of resolved) {
        await db
          .insert(matchGoals)
          .values({
            matchId: match.id,
            ord: ord++,
            teamId: r.teamId,
            player: r.player,
            sourceUrl: articleId,
          })
          .onConflictDoNothing();
      }
    }

    await db
      .insert(dvReports)
      .values({ url: articleId, matchId: match.id, checkedAt: now })
      .onConflictDoUpdate({ target: dvReports.url, set: { matchId: match.id, checkedAt: now } });
  }
}

// Skyttar för en uppsättning matcher, grupperade per match och lag.
export async function getGoalsByMatch(
  matchIds: string[],
): Promise<Map<string, { teamId: string; player: string }[]>> {
  const out = new Map<string, { teamId: string; player: string }[]>();
  if (matchIds.length === 0) return out;
  const db = await getDb();
  const rows = await db
    .select({
      matchId: matchGoals.matchId,
      teamId: matchGoals.teamId,
      player: matchGoals.player,
      ord: matchGoals.ord,
    })
    .from(matchGoals)
    .where(inArray(matchGoals.matchId, matchIds))
    .orderBy(matchGoals.matchId, matchGoals.ord);
  for (const r of rows) {
    const list = out.get(r.matchId) ?? [];
    list.push({ teamId: r.teamId, player: r.player });
    out.set(r.matchId, list);
  }
  return out;
}
