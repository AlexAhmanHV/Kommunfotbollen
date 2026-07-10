import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "./db/client";
import { articles, articleTeams } from "./db/schema";
import { TEAM_NEWS_ALIASES } from "./local-teams";
import {
  SECTIONS,
  extractReportUrls,
  fetchWithTimeout,
  sleep,
  FETCH_GAP_MS,
} from "./newspaper-sections";

// Nyhetsinsamling: läser lokaltidningarnas publika artiklar och sparar
// rubrik + kort ingress för artiklar som nämner något av de bevakade lagen.
// Vi lagrar aldrig artikeltext — sajten länkar alltid vidare till tidningen.
//
// Tre källvägar, i fallande prioritet (samma dedup-nyckel = URL, så senare
// steg aldrig skriver över en redan lagrad artikel):
//  1. Sektionsskrapning (DV + Vimmerby T, se newspaper-sections.ts) — riktiga
//     URL:er, full ingress, körs FÖRST och äger fältet när den hittar något.
//  2. Direktflöden (VT + Vimmerby T RSS) — kompletterar med det sektions-
//     skrapningen missar (t.ex. annat än fotboll som ändå taggas ett lag).
//  3. Google News — enda vägen till VT:s innehåll (betalvägg, ingen
//     sektionsskrapning möjlig) och till äldre artiklar som rullat ur både
//     sektionssidorna och RSS-flödena. Ingen ingress, bara rubrik.
const FEEDS = [
  { source: "Västerviks-Tidningen", url: "https://www.vt.se/rss/sport" },
  { source: "Vimmerby Tidning", url: "https://www.vimmerbytidning.se/rss/sport" },
];

const USER_AGENT =
  "kommunfotboll.se dev (portfolioprojekt; kontakt: alexhvahman@gmail.com)";

const MAX_SUMMARY_LENGTH = 300;

// Direktflödena är rullande fönster (DV: ~3 dagar) — artiklar publicerade
// innan sajten började synka finns bara via Google News-sökning per lag.
// Google-träffar saknar användbar ingress och länkar via omdirigering,
// så de är komplement: titel-dedupen låter direktflödena vinna.
export const MAX_ARTICLE_AGE_DAYS = 60;

const rssItemSchema = z.object({
  title: z.string().min(1),
  link: z.url(),
  description: z.string().optional(),
  pubDate: z.string().min(1),
});
type RssItem = z.infer<typeof rssItemSchema>;

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

function unwrapCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

function tagContent(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? unwrapCdata(m[1]).trim() : undefined;
}

/** Minimal RSS 2.0-parser — vi behöver bara title/link/description/pubDate. */
function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const candidate = {
      title: decodeEntities(tagContent(block, "title") ?? ""),
      link: tagContent(block, "link") ?? "",
      description: tagContent(block, "description"),
      pubDate: tagContent(block, "pubDate") ?? "",
    };
    const parsed = rssItemSchema.safeParse(candidate);
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

// Google News indexerar även tidningarnas paginerade sektionslistor och
// kategorisidor ("Sida 15 av 15 - ...", "- Dagens Västervik") — inte artiklar.
function isJunkTitle(title: string): boolean {
  const s = title.trim();
  if (s.length < 10) return true;
  if (/^sida\s+\d+\s+av\s+\d+/i.test(s)) return true;
  if (/^[-–—|]/.test(s)) return true;
  return false;
}

// Grov spärr mot uppenbart icke-fotboll (mest speedway/motorsport/hockey) som
// annars kan taggas via Googles kroppstext-träff. AI-filtret tar resten.
function isOtherSport(text: string): boolean {
  return /\b(speedway|startsju|rospigg|dackarna|vg\s*hockey|ishockey|innebandy|motocross|enduro|folkrace|rally|depån?|heatet?)\b/i.test(
    text,
  );
}

function matchTeams(item: RssItem): string[] {
  const haystack = `${item.title} ${item.description ?? ""}`.toLowerCase();
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
// de tillför inget och visas inte alls. Kollas via URL-mönster (direktflödet,
// där vi har den riktiga länken) eller den fasta titel-mallen "Se X här"
// (Google News, där länken bara är en Google-omdirigering utan äkta URL).
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

  // samma rubrik under annan URL = samma artikel (DV/DVim-syskonen,
  // Google News-kopior av direktflödenas artiklar)
  const dupe = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.title, item.title), ne(articles.id, item.link)))
    .limit(1);
  if (dupe.length > 0) return;

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
      set: { title: item.title, summary: item.summary, fetchedAt: now },
    });

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

// Läser ut rubrik, kort ingress och publiceringsdatum ur en artikelsida.
// og:title speglar den AKTUELLA rubriken (uppdateras om redaktionen byter
// den efter publicering, till skillnad från <title> som vi bara faller
// tillbaka på om og:title saknas). datePublished kommer från sidans JSON-LD.
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

  const dateMatch = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  return { title, summary, publishedAt: dateMatch ? dateMatch[1] : null };
}

// Skrapar DV:s och Vimmerby T:s fotbollssektioner direkt (samma mekanism som
// lib/goals.ts använder för målskyttar): riktiga URL:er + full ingress,
// istället för Google News redirect-länkar utan läsbar text. Förfiltrerad på
// lokala lag redan i extractReportUrls — vi hämtar aldrig artiklar som inte
// nämner ett bevakat lag i sektionslistans länktext.
const MAX_SECTION_ARTICLES_PER_RUN = 12;

async function syncNewspaperSections(db: Db, now: Date) {
  // hoppa artiklar vi redan har, oavsett vilken källa som fann dem först
  const existingIds = new Set(
    (await db.select({ id: articles.id }).from(articles)).map((r) => r.id),
  );

  for (const section of SECTIONS) {
    let sectionHtml: string;
    try {
      const res = await fetchWithTimeout(section.sectionUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sectionHtml = await res.text();
    } catch (err) {
      console.error(`[news] ${section.name}-sektionen gick inte att hämta:`, err);
      continue;
    }

    const urls = extractReportUrls(sectionHtml, section, MAX_SECTION_ARTICLES_PER_RUN).filter(
      (u) => !existingIds.has(u),
    );

    for (const url of urls) {
      await sleep(FETCH_GAP_MS); // artig mot tidningen — undvik rate-limit
      let meta: ReturnType<typeof extractArticleMeta>;
      try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        meta = extractArticleMeta(await res.text());
      } catch (err) {
        console.error(`[news] kunde inte hämta ${url}:`, err);
        continue;
      }
      if (!meta.title || isJunkTitle(meta.title)) continue;
      if (isOtherSport(`${meta.title} ${meta.summary ?? ""}`)) continue;
      if (isLiveMatchPlaceholder(url, meta.title)) continue;

      const teamIds = matchTeams({
        title: meta.title,
        description: meta.summary ?? undefined,
        link: url,
        pubDate: meta.publishedAt ?? now.toISOString(),
      });
      if (teamIds.length === 0) continue;

      await upsertArticle(
        db,
        now,
        {
          link: url,
          title: meta.title,
          summary: meta.summary,
          pubDate: meta.publishedAt ?? now.toISOString(),
        },
        section.name,
        teamIds,
      );
    }
  }
}

// Site-riktade Google News-sökningar mot enbart de tre bevakade tidningarna.
// Ger recall (når artiklar äldre än direktflödenas fönster + DV:s snabbrullande
// flöde). Saknar ingress, så AI-filtret + isOtherSport-spärren håller det rent.
const GOOGLE_NEWS_QUERY_VARIANTS = [
  " site:dagensvastervik.se",
  " site:vt.se",
  " site:vimmerbytidning.se",
];

async function syncGoogleNews(db: Db, now: Date) {
  const queries = Object.entries(TEAM_NEWS_ALIASES).flatMap(([teamId, aliases]) =>
    GOOGLE_NEWS_QUERY_VARIANTS.map((variant) => ({
      teamId,
      alias: aliases[0],
      q: `"${aliases[0]}"${variant}`,
    })),
  );
  for (const { teamId, alias, q } of queries) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=sv&gl=SE&ceid=SE:sv`;
    let xml: string;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      console.error(`[news] Google News för ${alias} gick inte:`, err);
      continue;
    }

    for (const item of parseRssItems(xml)) {
      const sep = item.title.lastIndexOf(" - ");
      const title = sep > 0 ? item.title.slice(0, sep).trim() : item.title;
      const source = sep > 0 ? item.title.slice(sep + 3).trim() : "Google News";
      if (isJunkTitle(title) || isOtherSport(title)) continue;
      if (isLiveMatchPlaceholder(item.link, title)) continue;
      // Sökt lag + ev. andra lag vars namn står i rubriken. Bredare recall;
      // isOtherSport + AI-filtret sållar bort brus.
      const titleTeams = matchTeams({ title, link: item.link, pubDate: item.pubDate });
      await upsertArticle(
        db,
        now,
        { link: item.link, title, summary: null, pubDate: item.pubDate },
        source,
        [...new Set([teamId, ...titleTeams])],
      );
    }
  }
}

export async function syncNews() {
  const db = await getDb();
  const now = new Date();

  // Sektionsskrapning FÖRST — riktiga URL:er + full ingress för DV/Vimmerby T,
  // en trasig sektion stoppar inte resten av synken.
  try {
    await syncNewspaperSections(db, now);
  } catch (err) {
    console.error("[news] sektionsskrapningen misslyckades:", err);
  }

  for (const feed of FEEDS) {
    let xml: string;
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": USER_AGENT },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      // ett trasigt flöde ska inte stoppa de andra
      console.error(`[news] ${feed.source} gick inte att hämta:`, err);
      continue;
    }

    for (const item of parseRssItems(xml)) {
      if (isJunkTitle(item.title)) continue;
      if (isOtherSport(`${item.title} ${item.description ?? ""}`)) continue;
      if (isLiveMatchPlaceholder(item.link, item.title)) continue;
      const teamIds = matchTeams(item);
      if (teamIds.length === 0) continue;

      await upsertArticle(
        db,
        now,
        {
          link: item.link,
          title: item.title,
          summary: item.description ? cleanText(item.description) : null,
          pubDate: item.pubDate,
        },
        feed.source,
        teamIds,
      );
    }
  }

  // Google News efter direktflödena (titel-dedupen föredrar deras ingress-rika versioner)
  await syncGoogleNews(db, now);
}
