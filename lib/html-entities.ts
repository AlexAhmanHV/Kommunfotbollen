// Avkodning av HTML-entiteter, delad av all text vi läser från tidningar och
// poddflöden. Dagens Västervik skriver t.ex. å/ä/ö/ü som &aring;/&auml;/&ouml;/
// &uuml; — en entitet som inte avkodas blir annars ett hål i namnet
// ("Rosenm ller") som AI-extraktionen gissar sig förbi.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", shy: "",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", copy: "©", reg: "®", trade: "™", deg: "°", euro: "€",
};

// Latin-1-bokstäverna (U+00C0–U+00FF) i kodpunktsordning — täcker svenska,
// nordiska och vanliga europeiska namn (ü, é, ø, æ, ñ ...).
const LATIN1_NAMES = [
  "Agrave", "Aacute", "Acirc", "Atilde", "Auml", "Aring", "AElig", "Ccedil",
  "Egrave", "Eacute", "Ecirc", "Euml", "Igrave", "Iacute", "Icirc", "Iuml",
  "ETH", "Ntilde", "Ograve", "Oacute", "Ocirc", "Otilde", "Ouml", "times",
  "Oslash", "Ugrave", "Uacute", "Ucirc", "Uuml", "Yacute", "THORN", "szlig",
  "agrave", "aacute", "acirc", "atilde", "auml", "aring", "aelig", "ccedil",
  "egrave", "eacute", "ecirc", "euml", "igrave", "iacute", "icirc", "iuml",
  "eth", "ntilde", "ograve", "oacute", "ocirc", "otilde", "ouml", "divide",
  "oslash", "ugrave", "uacute", "ucirc", "uuml", "yacute", "thorn", "yuml",
];
LATIN1_NAMES.forEach((name, i) => (NAMED_ENTITIES[name] = String.fromCodePoint(0xc0 + i)));

/** Avkodar namngivna och numeriska entiteter. Okända namngivna lämnas orörda. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}
