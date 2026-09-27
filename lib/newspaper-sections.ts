import { TEAM_NEWS_ALIASES } from "./local-teams";
import { decodeEntities } from "./html-entities";

// Delad infrastruktur för att hitta och läsa lokaltidningarnas artiklar —
// används av både lib/goals.ts (målskyttar) och lib/news.ts (artikellistan).
// De tre tidningar som bevakar lagen, med två sätt att hitta artiklar:
//  - Sitemap (Vimmerby T, VT): tidningens egen lista över VARJE publicerad
//    artikel per månad. Fullständig, till skillnad från sektionssidan som bara
//    visar de senaste.
//  - Sektionssida (DV): DV:s sitemap är spärrad (403), så fotbollssidan läses.
// VT har betalvägg: rubrik + ingress går att läsa, brödtexten inte — därför
// används VT aldrig för målskytte-extraktion ur fulltext.

type PaperBase = {
  name: string;
  /** Brödtexten går att läsa fritt (ingen betalvägg). */
  bodyReadable: boolean;
};

export type Paper =
  | (PaperBase & {
      kind: "section";
      sectionUrl: string;
      baseUrl: string;
      // Olika CMS, olika URL-mönster: DV har ett numeriskt id före sluggen
      // (/e/{id}/{slugg}/).
      urlPattern: RegExp;
    })
  | (PaperBase & {
      kind: "sitemap";
      /** Månadens sitemap, t.ex. .../sitemap-2026-9.xml */
      sitemapUrl: (year: number, month: number) => string;
    });

export const PAPERS: Paper[] = [
  {
    name: "Dagens Västervik",
    kind: "section",
    bodyReadable: true,
    sectionUrl: "https://www.dagensvastervik.se/sport/fotboll/",
    baseUrl: "https://www.dagensvastervik.se",
    urlPattern: /\/sport\/fotboll\/e\/\d+\/[a-z0-9-]+\/?/g,
  },
  {
    name: "Vimmerby Tidning",
    kind: "sitemap",
    bodyReadable: true,
    sitemapUrl: (y, m) => `https://www.vimmerbytidning.se/sitemap/sitemap-${y}-${m}.xml`,
  },
  {
    name: "Västerviks-Tidningen",
    kind: "sitemap",
    bodyReadable: false,
    sitemapUrl: (y, m) => `https://www.vt.se/sitemap/sitemap-${y}-${m}.xml`,
  },
];

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export const FETCH_GAP_MS = 900; // artig paus mellan artikelhämtningar
const FETCH_TIMEOUT_MS = 10_000; // ingen inbyggd timeout i fetch() — om en
// tidning rate-limitar/hänger kan anropet annars stå och vänta i flera minuter

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

// Alla alias för lokala lag, plattat till en lista för snabb substrängskoll
// (TEAM_NEWS_ALIASES täcker bara de bevakade lokala lagen, så listan är
// redan implicit lokal-scopead).
const LOCAL_ALIASES = Object.values(TEAM_NEWS_ALIASES).flat().map((a) => a.toLowerCase());

// Bredare, EXTRA ord som bara får användas för att avgöra om vi ska köra
// målskytte-extraktion på en artikel — aldrig för nyhetstaggning (TEAM_NEWS_
// ALIASES hålls medvetet strama där, t.ex. undviker bara "Västervik" som
// annars drar in speedway/hockey i nyhetslistan). Här är det ofarligt att
// vara bredare: DV skriver ofta bara "Västervik" om Västerviks FF i rubriker
// ("Västervik vann galen match"), och nedströms (AI-extraktion + strikt
// resultat-/lagnamnsmatchning i linkAndStore) filtrerar ändå bort allt som
// inte faktiskt är ett fotbollsreferat med rätt lag och resultat.
const GOAL_PREFILTER_EXTRA = ["västervik", "tjust", "örbäcken", "gunnebo", "ankarsrum", "hjorted", "totebo"];

export function mentionsLocalTeam(text: string): boolean {
  const t = text.toLowerCase();
  return LOCAL_ALIASES.some((alias) => t.includes(alias)) || GOAL_PREFILTER_EXTRA.some((w) => t.includes(w));
}

/** Rubrik + stycken ur en artikelsida som ren text (max 4000 tecken). */
export function extractArticleText(html: string): string {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    // taggar bort, entiteter AVKODADE (inte bortslängda: "F&auml;lt" ska bli
    // "Fält", inte "F lt" som AI:n sedan gissar på)
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 20);
  return `${title}\n\n${paras.join("\n")}`.slice(0, 4000);
}

// Lagnamn i URL-slug-form ("ifk-vastervik"): i sitemapen hittas även artiklar
// om lagen som ligger utanför fotbollssektionen (t.ex. VT:s nyheter/vastervik).
function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/å|ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
const LOCAL_SLUGS = [...new Set(LOCAL_ALIASES.map(toSlug).filter((s) => s.length >= 3))];

function isFootballOrLocalUrl(url: string): boolean {
  if (url.includes("/sport/fotboll/")) return true;
  const path = `-${toSlug(new URL(url).pathname)}-`;
  return LOCAL_SLUGS.some((slug) => path.includes(`-${slug}-`));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Månaderna (år, månad) som täcker de senaste `days` dagarna. */
function monthsCovering(days: number, now: Date): [number, number][] {
  const out: [number, number][] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  while (true) {
    out.push([cursor.getUTCFullYear(), cursor.getUTCMonth() + 1]);
    if (cursor.getTime() <= cutoff) break;
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return out;
}

/**
 * Tidningens artikel-URL:er om fotboll eller de lokala lagen, nyast först.
 * Sitemap: publicerade de senaste `maxAgeDays` dagarna. Sektionssida: allt
 * som listas där (den visar bara de senaste ändå).
 */
export async function discoverArticleUrls(
  paper: Paper,
  maxAgeDays: number,
  now = new Date(),
): Promise<string[]> {
  if (paper.kind === "section") {
    const html = await fetchText(paper.sectionUrl);
    const urls = [...html.matchAll(paper.urlPattern)].map((m) => paper.baseUrl + m[0]);
    return [...new Set(urls)];
  }

  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const entries: { url: string; lastmod: number }[] = [];
  for (const [year, month] of monthsCovering(maxAgeDays, now)) {
    let xml: string;
    try {
      xml = await fetchText(paper.sitemapUrl(year, month));
    } catch (err) {
      // en saknad/trasig månad ska inte stoppa de andra
      console.error(`[papers] ${paper.name} sitemap ${year}-${month} gick inte att hämta:`, err);
      continue;
    }
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const url = m[1].match(/<loc>([^<]+)<\/loc>/)?.[1]?.trim();
      const lastmod = Date.parse(m[1].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? "");
      if (!url || isNaN(lastmod) || lastmod < cutoff) continue;
      if (isFootballOrLocalUrl(url)) entries.push({ url, lastmod });
    }
  }
  entries.sort((a, b) => b.lastmod - a.lastmod);
  return [...new Set(entries.map((e) => e.url))];
}
