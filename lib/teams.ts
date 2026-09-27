// Lokala lags adresser (slug) och tabellutdrag — ren logik utan databas.
// Samma slug används för lagsidan (/lag/<slug>) och lagbilden
// (public/images/lag/<slug>.jpg).
export const TEAM_SLUGS: Record<string, string> = {
  "eswidget-9925": "ifk-vastervik",
  "eswidget-10040": "hjorted-totebo",
  "eswidget-51390": "tjust-if-ff",
  "eswidget-9942": "vasterviks-ff",
  "eswidget-23106": "boif",
  "eswidget-10039": "gunnebo-if",
  "eswidget-224214": "fc-orbacken",
  "eswidget-10249": "overums-ik",
  "eswidget-9982": "ankarsrums-is",
  "eswidget-191798": "vasterviks-dam",
};

const ID_BY_SLUG = new Map(Object.entries(TEAM_SLUGS).map(([id, slug]) => [slug, id]));

export const CLASS_LABEL: Record<string, string> = {
  MEN: "Herrar",
  WOMEN: "Damer",
  BOYS: "Pojkar",
  GIRLS: "Flickor",
  MIX: "Mix",
};

export function teamSlug(teamId: string): string | null {
  return TEAM_SLUGS[teamId] ?? null;
}

export function teamIdBySlug(slug: string): string | null {
  return ID_BY_SLUG.get(slug) ?? null;
}

/**
 * Utdrag ur en tabell (sorterad efter placering): laget med upp till `radius`
 * lag ovanför och under. Vid toppen/botten flyttas fönstret så att
 * 2·radius+1 rader visas om tabellen räcker. Saknas laget → tom lista.
 */
export function tableExcerpt<T extends { teamId: string }>(
  rows: T[],
  teamId: string,
  radius = 2,
): T[] {
  const i = rows.findIndex((r) => r.teamId === teamId);
  if (i < 0) return [];
  const size = Math.min(rows.length, radius * 2 + 1);
  const start = Math.min(Math.max(0, i - radius), rows.length - size);
  return rows.slice(start, start + size);
}
