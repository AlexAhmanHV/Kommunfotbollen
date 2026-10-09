// Citat ur tidningarnas matchrapporter (lib/goals.ts). AI:n plockar ut dem,
// men ett citat sparas bara om det står ordagrant och komplett i artikeln
// (efter citattecken/pratminus och före slutcitattecken/skiljetecken, med
// talarens efternamn i texten) — om riktiga personer får ingenting
// omformuleras, kapas eller hittas på.

export const MAX_QUOTES_PER_MATCH = 2;
export const MIN_QUOTE_CHARS = 10;
export const MAX_QUOTE_CHARS = 200;

/**
 * Jämförelseform: enhetliga citattecken, apostrofer och streck, ett blanksteg,
 * gemener. Citattecknen BEHÅLLS — de behövs för att se var ett citat börjar och slutar.
 */
function comparable(s: string): string {
  return s
    .replace(/[”“«»]/g, '"')
    .replace(/’/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Citatet börjar direkt efter ett citattecken eller ett pratminus (ej bindestreck i t.ex. "3-1"). */
function startsLikeQuote(article: string, at: number): boolean {
  const before = article.slice(0, at).trimEnd();
  if (before === "") return false;
  const last = before[before.length - 1];
  if (last === '"') return true;
  return last === "-" && (before.length === 1 || /\s/.test(before[before.length - 2]));
}

/** Citatet slutar före ett slutcitattecken eller . , ! ? ; — eller vid artikelns slut. */
function endsLikeQuote(article: string, at: number): boolean {
  const after = article.slice(at).trimStart();
  return after === "" || /^["\.,!?;]/.test(after);
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
  const occursAsQuote = (quote: string): boolean => {
    const needle = comparable(quote);
    for (let i = article.indexOf(needle); i !== -1; i = article.indexOf(needle, i + 1)) {
      if (startsLikeQuote(article, i) && endsLikeQuote(article, i + needle.length)) return true;
    }
    return false;
  };
  const speakerInArticle = (speaker: string): boolean => {
    const last = speaker.split(/\s+/).pop()!.toLowerCase();
    return article.includes(last);
  };
  return quotes
    .map((q) => ({ ...q, speaker: q.speaker.trim(), quote: stripQuoteMarks(q.quote) }))
    .filter(
      (q) =>
        q.speaker !== "" &&
        q.quote.length >= MIN_QUOTE_CHARS &&
        q.quote.length <= MAX_QUOTE_CHARS &&
        speakerInArticle(q.speaker) &&
        occursAsQuote(q.quote),
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
