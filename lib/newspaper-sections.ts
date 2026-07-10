import { TEAM_NEWS_ALIASES } from "./local-teams";

// Delad infrastruktur för att skrapa lokaltidningarnas fotbollssektioner
// direkt (riktiga URL:er, full text) — används av både lib/goals.ts
// (målskyttar) och lib/news.ts (artikellistan). Bara Dagens Västervik och
// Vimmerby Tidning är med: båda verifierat fria från betalvägg och
// server-renderade. VT är UTESLUTET (bekräftat betalvägg + klient-renderat,
// ingen artikeltext går att hämta server-side — täcks bara via Google News
// i news.ts, med de begränsningar det innebär).

export type Section = { name: string; sectionUrl: string; baseUrl: string; urlPattern: RegExp };

// Olika CMS, olika URL-mönster: DV har ett numeriskt id före sluggen
// (/e/{id}/{slugg}/), Vimmerby T har en kort kod EFTER sluggen (samma mönster
// som VT, som vi inte kan använda pga betalvägg).
export const SECTIONS: Section[] = [
  {
    name: "Dagens Västervik",
    sectionUrl: "https://www.dagensvastervik.se/sport/fotboll/",
    baseUrl: "https://www.dagensvastervik.se",
    urlPattern: /\/sport\/fotboll\/e\/\d+\/[a-z0-9-]+\/?/g,
  },
  {
    name: "Vimmerby Tidning",
    sectionUrl: "https://www.vimmerbytidning.se/sport/fotboll/",
    baseUrl: "https://www.vimmerbytidning.se",
    urlPattern: /\/sport\/fotboll\/artikel\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?/g,
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

// Bredare, EXTRA ord som bara får användas för att avgöra om vi ska HÄMTA en
// artikel för målskytte-extraktion — aldrig för nyhetstaggning (TEAM_NEWS_
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

// Endast lokala lag är intressanta — och vi vet inte förrän vi läst
// artikeln. För att slippa hämta (och rate-limita oss själva hos) varje
// enskild fotbollsartikel förfiltreras på länktexten i SEKTIONSLISTAN: bara
// URL:er vars omgivande text nämner ett bevakat lag hämtas alls.
const LINK_CONTEXT_CHARS = 300;

export function extractReportUrls(html: string, section: Section, limit: number): string[] {
  const seen = new Set<string>();
  for (const m of html.matchAll(section.urlPattern)) {
    const start = Math.max(0, (m.index ?? 0) - LINK_CONTEXT_CHARS);
    const context = html.slice(start, (m.index ?? 0) + m[0].length).replace(/<[^>]+>/g, " ");
    if (mentionsLocalTeam(context)) {
      seen.add(section.baseUrl + m[0]);
    }
  }
  return [...seen].slice(0, limit);
}
