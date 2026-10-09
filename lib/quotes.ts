// Citat ur tidningarnas matchrapporter (lib/goals.ts). AI:n plockar ut dem,
// men ett citat sparas bara om det står ordagrant och komplett i artikeln
// (efter citattecken/pratminus och före slutcitattecken/skiljetecken, med
// talarens efternamn i texten) — om riktiga personer får ingenting
// omformuleras, kapas eller hittas på.

export const MAX_QUOTES_PER_MATCH = 2;
export const MIN_QUOTE_CHARS = 10;
export const MAX_QUOTE_CHARS = 200;

const SPEECH_VERBS =
  "säger|sa|sade|berättar|menar|konstaterar|fortsätter|förklarar|tillägger|skrattar|suckar";

/**
 * Jämförelseform: enhetliga citattecken, apostrofer och streck, ett blanksteg,
 * gemener. Citattecknen BEHÅLLS — de behövs för att se var ett citat börjar och slutar.
 * Radbrytningar (nya stycken) BEHÅLLS också — de visar var ett pratminus får stå.
 */
function comparable(s: string): string {
  return s
    .replace(/[”“«»]/g, '"')
    .replace(/’/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim()
    .toLowerCase();
}

/** Strecket vid `dashAt` är ett pratminus: först i artikeln eller efter radbrytning, . ! ? : eller citattecken. */
function isSpeechDash(before: string, dashAt: number): boolean {
  const prev = before.slice(0, dashAt).replace(/ +$/, "");
  return prev === "" || /[\n.!?:"]$/.test(prev);
}

/** Citatet börjar efter ett inledande citattecken (udda antal före) eller ett pratminus. */
function startsLikeQuote(article: string, at: number): boolean {
  const before = article.slice(0, at).trimEnd();
  if (before === "") return false;
  const last = before[before.length - 1];
  if (last === '"') return (before.match(/"/g) ?? []).length % 2 === 1;
  return last === "-" && isSpeechDash(before, before.length - 1);
}

/** Efter ett kommatecken: ett talverb eller ett slutcitattecken, annars är det ett kommatecken mitt i citatet. */
function commaClosesQuote(afterComma: string): boolean {
  return new RegExp(`^\\s*(?:"|(?:${SPEECH_VERBS})(?!\\p{L}))`, "u").test(afterComma);
}

/**
 * Citatet är komplett: det slutar med eget skiljetecken, eller följs av slutcitattecken
 * eller . ! ? ; — ett kommatecken räknas bara före talverb/slutcitattecken. Artikelns
 * slut räknas inte (texten kan vara avkapad).
 */
function endsLikeQuote(article: string, at: number, needle: string): boolean {
  const after = article.slice(at).replace(/^ +/, "");
  if (/,$/.test(needle)) return commaClosesQuote(after);
  if (/[.!?;…]$/.test(needle)) return true;
  if (after.startsWith(",")) return commaClosesQuote(after.slice(1));
  return /^["\.!?;]/.test(after);
}

/** Efternamnet förekommer som helt ord i artikeln ("Ek" ska inte träffa "bekväma"). */
function hasWholeWord(article: string, word: string): boolean {
  const escaped = comparable(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "iu").test(article);
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
    const needle = comparable(quote.replace(/\s+/g, " "));
    for (let i = article.indexOf(needle); i !== -1; i = article.indexOf(needle, i + 1)) {
      if (startsLikeQuote(article, i) && endsLikeQuote(article, i + needle.length, needle)) {
        return true;
      }
    }
    return false;
  };
  const speakerInArticle = (speaker: string): boolean =>
    hasWholeWord(article, speaker.split(/\s+/).pop()!);
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
