import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "./db/client";
import { articles, articleTeams, newsChecked } from "./db/schema";
import { TEAM_NEWS_ALIASES } from "./local-teams";
import {
  PAPERS,
  discoverArticleUrls,
  extractArticleText,
  fetchWithTimeout,
  sleep,
  FETCH_GAP_MS,
} from "./newspaper-sections";

// Nyhetsinsamling: läser lokaltidningarnas publika artiklar och sparar
// rubrik + kort ingress för artiklar som nämner något av de bevakade lagen.
// Vi lagrar aldrig artikeltext — sajten länkar alltid vidare till tidningen.
//
// Källor: Dagens Västervik, Vimmerby Tidning och Västerviks-Tidningen. Hur
// artiklarna hittas (sitemap eller sektionssida) avgörs per tidning i
// newspaper-sections.ts. Varje hittad URL läses en gång: rubrik, ingress och
// brödtext kontrolleras mot lagnamnen, och URL:er utan bevakat lag minns i
// news_checked så de inte hämtas igen.

const MAX_SUMMARY_LENGTH = 300;

// Hur långt bak artiklar hämtas (sitemaps) och visas på sajten.
export const MAX_ARTICLE_AGE_DAYS = 60;

// Nya URL:er att läsa per tidning och körning — första körningarna fyller på
// bakåt i omgångar i stället för att hämta hundratals artiklar på en gång.
const MAX_NEW_URLS_PER_PAPER = 60;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aring: "å", auml: "ä", ouml: "ö", Aring: "Å", Auml: "Ä", Ouml: "Ö",
  eacute: "é", Eacute: "É", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function cleanText(s: string): string {
  // vissa flöden HTML-kodar sin markup (&lt;p&gt;) — avkoda innan taggarna
  // rensas, och en gång till efteråt för dubbelkodade entiteter (&amp;nbsp;)
  const text = decodeEntities(
    decodeEntities(s).replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_SUMMARY_LENGTH
    ? text.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd() + "…"
    : text;
}

// Spärr mot sidor som inte är artiklar (paginerade listor, kategorisidor:
// "Sida 15 av 15 - ...", "- Dagens Västervik").
function isJunkTitle(title: string): boolean {
  const s = title.trim();
  if (s.length < 10) return true;
  if (/^sida\s+\d+\s+av\s+\d+/i.test(s)) return true;
  if (/^[-–—|]/.test(s)) return true;
  return false;
}

// Grov spärr mot uppenbart icke-fotboll (mest speedway/motorsport/hockey) som
// annars kan taggas via ett ortnamn i texten. AI-filtret tar resten.
function isOtherSport(text: string): boolean {
  return /\b(speedway|startsju|rospigg|dackarna|vg\s*hockey|ishockey|innebandy|motocross|enduro|folkrace|rally|depån?|heatet?)\b/i.test(
    text,
  );
}

function matchTeams(text: string): string[] {
  const haystack = text.toLowerCase();
  return Object.entries(TEAM_NEWS_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => haystack.includes(a)))
    .map(([teamId]) => teamId);
}

type Db = Awaited<ReturnType<typeof getDb>>;

function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]/g, "");
}

function wordsOf(text: string): Set<string> {
  return new Set(
    text
      .split(/[\s/_\-–—]+/) // bindestreck + en-/em-dash som ordavskiljare
      .map(normalizeWord)
      .filter((w) => w.length >= 3),
  );
}

// VT:s "livematcher"-sidor är tomma widgetinbäddningar utan artikeltext —
// de tillför inget och visas inte alls. Kollas via URL-mönster eller den
// fasta titel-mallen "Se X här".
function isLiveMatchPlaceholder(url: string, title: string): boolean {
  if (/\/livematcher\//i.test(url)) return true;
  return /^se\s.+\shär["”]?$/i.test(title.trim());
}

// Den beskrivande ord-sluggen i en artikel-URL. Sätts vid publicering och
// ändras inte om redaktionen senare byter rubrik — till skillnad från
// title-fältet, vilket annars gör att titel-dedupen missar att det är samma
// artikel (t.ex. Google News har indexerat den gamla rubriken). Sluggen är
// INTE alltid sista path-segmentet — VT lägger en kort artikelkod sist
// ("/artikel/gothia-cup-ar-ett-minne-for-livet/l789epxj/"), medan DV har
// sluggen sist. Välj därför segmentet med flest bindestreck (mest ord).
function slugWords(url: string): Set<string> {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const segments = path.split("/").filter(Boolean);
    const bySlugness = [...segments].sort(
      (a, b) => (b.match(/-/g)?.length ?? 0) - (a.match(/-/g)?.length ?? 0),
    );
    return wordsOf(decodeURIComponent(bySlugness[0] ?? ""));
  } catch {
    return new Set();
  }
}

function diceOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function isGoogleNewsUrl(url: string): boolean {
  return url.startsWith("https://news.google.com/");
}

async function upsertArticle(
  db: Db,
  now: Date,
  item: { link: string; title: string; summary: string | null; pubDate: string },
  source: string,
  teamIds: string[],
): Promise<void> {
  const publishedAt = new Date(item.pubDate);
  if (isNaN(publishedAt.getTime())) return;
  const maxAgeMs = MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (now.getTime() - publishedAt.getTime() > maxAgeMs) return;

  // samma rubrik under annan URL = samma artikel (DV/DVim-syskonen). Äldre
  // Google News-kopior (omdirigeringslänk, ingen ingress) från tiden innan
  // sitemaps användes räknas inte — den riktiga artikeln ersätter dem nedan.
  const sameTitle = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.title, item.title), ne(articles.id, item.link)));
  const googleCopies = sameTitle.map((r) => r.id).filter(isGoogleNewsUrl);
  if (sameTitle.length > googleCopies.length) return;

  // Fuzzy dedupe: samma tidning kan indexeras dubbelt med olika rubrik (t.ex.
  // tidningen byter rubrik efter publicering — Google News har cachat den
  // gamla). Jämför nya titelns ord mot varje befintlig artikels URL-slug
  // (stabil, ändras inte) för samma källa; hög överlappning = samma artikel.
  const candidateWords = wordsOf(item.title);
  if (candidateWords.size >= 4) {
    const sameSource = await db
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.source, source));
    for (const row of sameSource) {
      if (row.id === item.link) continue;
      const existingWords = slugWords(row.id);
      if (existingWords.size < 4) continue;
      if (diceOverlap(candidateWords, existingWords) >= 0.6) return;
    }
  }

  await db
    .insert(articles)
    .values({
      id: item.link,
      title: item.title,
      summary: item.summary,
      source,
      publishedAt,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: articles.id,
      set: { title: item.title, summary: item.summary, publishedAt, fetchedAt: now },
    });

  if (googleCopies.length > 0) {
    await db.delete(articleTeams).where(inArray(articleTeams.articleId, googleCopies));
    await db.delete(articles).where(inArray(articles.id, googleCopies));
  }

  for (const teamId of teamIds) {
    // FK mot teams(id): om matchsynken inte hunnit fylla laget hoppar vi över
    // just den kopplingen (nästa synk fångar den) istället för att fälla allt.
    try {
      await db
        .insert(articleTeams)
        .values({ articleId: item.link, teamId })
        .onConflictDoNothing();
    } catch {
      /* lag saknas ännu — hoppa över kopplingen */
    }
  }
}

// DV:s sidor saknar JSON-LD datePublished helt — datumet finns bara i en
// inline-JS-variabel ("articlePublishedTime = '2026-08-23 19:06:59';"),
// naiv Europe/Stockholm-lokaltid utan zonangivelse. Utan den föll varje DV-
// artikel tillbaka på skraptidpunkten istället för sitt riktiga datum, vilket
// gjorde nyhetslistan felsorterad (Vimmerby Tidnings JSON-LD funkar redan).
function stockholmOffsetMinutes(utcMs: number): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Stockholm",
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = part?.match(/GMT([+-]\d+)/);
  return m ? Number(m[1]) * 60 : 60;
}

function parseStockholmLocalTime(s: string): string | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  // självkorrigerande: gissa UTC, hämta zonens offset för den gissningen,
  // gissa om — stabiliserar över DST-brytpunkter på ett par iterationer.
  let utcMs = Date.UTC(y, mo - 1, d, h, mi, se);
  for (let i = 0; i < 2; i++) {
    utcMs = Date.UTC(y, mo - 1, d, h, mi, se) - stockholmOffsetMinutes(utcMs) * 60_000;
  }
  return new Date(utcMs).toISOString();
}

// Läser ut rubrik, kort ingress och publiceringsdatum ur en artikelsida.
// og:title speglar den AKTUELLA rubriken (uppdateras om redaktionen byter
// den efter publicering, till skillnad från <title> som vi bara faller
// tillbaka på om og:title saknas). datePublished kommer i första hand från
// sidans JSON-LD (Vimmerby Tidning), annars DV:s articlePublishedTime-variabel.
function extractArticleMeta(
  html: string,
): { title: string | null; summary: string | null; publishedAt: string | null } {
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1];
  let title: string | null = null;
  if (ogTitle) {
    title = decodeEntities(ogTitle).trim();
  } else {
    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (titleTag) {
      const decoded = decodeEntities(titleTag);
      const sep = decoded.lastIndexOf(" - ");
      title = (sep > 0 ? decoded.slice(0, sep) : decoded).trim();
    }
  }

  // og:description/meta description är en redaktionellt satt sammanfattning
  // — betydligt pålitligare än att gissa "första stycket" ur HTML:en, vilket
  // ofta råkar plocka upp navigations-/menytext som ligger före själva
  // artikeltaggen (t.ex. "Mina sidor är tyvärr inte tillgänglig i appen.").
  const ogDesc =
    html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1] ??
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1];
  let summary = ogDesc ? cleanText(decodeEntities(ogDesc)) : null;
  if (!summary) {
    // fallback: första riktiga stycket, men bara inom <article> om den finns
    // (undviker samma navigations-text-fälla när description-taggen saknas)
    const scope = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html;
    const paras = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, " ").trim())
      .filter((p) => decodeEntities(p.replace(/&[a-z]+;|&#\d+;/g, "")).trim().length > 20);
    summary = paras[0] ? cleanText(paras[0]) : null;
  }

  const jsonLdDate = html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  const dvDate = html.match(/articlePublishedTime\s*=\s*"([^"]+)"/)?.[1];
  const publishedAt = jsonLdDate ?? (dvDate ? parseStockholmLocalTime(dvDate) : null);
  return { title, summary, publishedAt };
}

async function syncPaper(db: Db, now: Date, paper: (typeof PAPERS)[number]) {
  const urls = await discoverArticleUrls(paper, MAX_ARTICLE_AGE_DAYS, now);
  if (urls.length === 0) return;

  // hoppa över URL:er vi redan sparat eller redan läst utan träff
  const [saved, checked] = await Promise.all([
    db.select({ url: articles.id }).from(articles).where(inArray(articles.id, urls)),
    db.select({ url: newsChecked.url }).from(newsChecked).where(inArray(newsChecked.url, urls)),
  ]);
  const known = new Set([...saved, ...checked].map((r) => r.url));
  const todo = urls.filter((u) => !known.has(u)).slice(0, MAX_NEW_URLS_PER_PAPER);

  for (const url of todo) {
    await sleep(FETCH_GAP_MS); // artig mot tidningen — undvik rate-limit
    let html: string;
    let meta: ReturnType<typeof extractArticleMeta>;
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
      meta = extractArticleMeta(html);
    } catch (err) {
      // hämtnings-/tolkningsfel på en artikel ska inte stoppa resten —
      // lämna oläst, försök igen nästa körning
      console.error(`[news] kunde inte läsa ${url}:`, err);
      continue;
    }
    const teamIds =
      meta.title &&
      !isJunkTitle(meta.title) &&
      !isOtherSport(`${meta.title} ${meta.summary ?? ""}`) &&
      !isLiveMatchPlaceholder(url, meta.title)
        ? // brödtexten räknas också: många rubriker nämner inte laget alls
          // (VT: bara det som syns före betalväggen)
          matchTeams(`${meta.title} ${meta.summary ?? ""} ${extractArticleText(html)}`)
        : [];

    if (teamIds.length === 0) {
      await db.insert(newsChecked).values({ url, checkedAt: now }).onConflictDoNothing();
      continue;
    }

    await upsertArticle(
      db,
      now,
      {
        link: url,
        title: meta.title!,
        summary: meta.summary,
        pubDate: meta.publishedAt ?? now.toISOString(),
      },
      paper.name,
      teamIds,
    );
  }
}

export async function syncNews() {
  const db = await getDb();
  const now = new Date();

  for (const paper of PAPERS) {
    try {
      await syncPaper(db, now, paper);
    } catch (err) {
      // en trasig tidning ska inte stoppa de andra
      console.error(`[news] ${paper.name} misslyckades:`, err);
    }
  }
}
