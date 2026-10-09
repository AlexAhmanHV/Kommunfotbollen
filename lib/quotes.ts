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
