import type { UiMatch } from "./queries";

// Ren logik för startsidans matchdagszon — ingen databas, ingen rendering.
// `now` skickas alltid in, så att allt kan testas och lägena kan framkallas
// lokalt med MATCHDAY_NOW.

export type Standing = { position: number; pts: number };
export type MatchdayMode = "upcoming" | "recent" | "offseason";
export type FormLetter = "V" | "O" | "F";

export type LocalTeamRow = {
  teamId: string;
  name: string;
  logoUrl: string | null;
  leagueId: string | null;
  leagueName: string | null;
  position: number | null;
  pts: number | null;
};

export type TeamSummary = LocalTeamRow & {
  form: FormLetter[];
  next: { startsAt: Date; home: boolean; opponent: string } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 7 * DAY_MS;
const FORM_LENGTH = 5;

const byStart = (a: UiMatch, b: UiMatch) => a.startsAt.getTime() - b.startsAt.getTime();

/** Står som kommande ett dygn efter avspark: källan har inget resultat. */
export function isResultMissing(
  m: Pick<UiMatch, "status" | "startsAt">,
  now: Date = new Date(),
): boolean {
  return m.status === "UPCOMING" && m.startsAt.getTime() < now.getTime() - DAY_MS;
}

function isLocalMatch(m: UiMatch, localIds: ReadonlySet<string>): boolean {
  return localIds.has(m.homeId) || localIds.has(m.awayId);
}

function isDerby(m: UiMatch, localIds: ReadonlySet<string>): boolean {
  return localIds.has(m.homeId) && localIds.has(m.awayId);
}

/** Vad matchdagszonen ska visa: kommande omgång, senaste omgången eller säsongsuppehåll. */
export function matchdayMode(
  matches: UiMatch[],
  localIds: ReadonlySet<string>,
  now: Date,
): { mode: MatchdayMode; matches: UiMatch[] } {
  const t = now.getTime();
  const local = matches.filter((m) => isLocalMatch(m, localIds) && !isResultMissing(m, now));

  const upcoming = local
    .filter(
      (m) =>
        (m.status === "UPCOMING" || m.status === "ONGOING") &&
        m.startsAt.getTime() <= t + WINDOW_MS,
    )
    .sort(byStart);
  if (upcoming.length > 0) return { mode: "upcoming", matches: upcoming };

  const recent = local
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        m.startsAt.getTime() <= t &&
        m.startsAt.getTime() >= t - WINDOW_MS,
    )
    .sort(byStart);
  if (recent.length > 0) return { mode: "recent", matches: recent };

  return { mode: "offseason", matches: [] };
}

/** Veckans match: derby först (tidigast), annars bäst placerade lokala laget (lika → tidigast). */
export function pickFeatured(
  matches: UiMatch[],
  standings: ReadonlyMap<string, Standing>,
  localIds: ReadonlySet<string>,
): UiMatch | null {
  if (matches.length === 0) return null;

  const derbies = matches.filter((m) => isDerby(m, localIds)).sort(byStart);
  if (derbies.length > 0) return derbies[0];

  const bestLocalPosition = (m: UiMatch) =>
    Math.min(
      ...[m.homeId, m.awayId]
        .filter((id) => localIds.has(id))
        .map((id) => standings.get(id)?.position ?? Infinity),
    );
  // Infinity - Infinity = NaN, som är falskt → faller igenom till avspark.
  return [...matches].sort(
    (a, b) => bestLocalPosition(a) - bestLocalPosition(b) || byStart(a, b),
  )[0];
}

/** Lagkorten: form (fem senaste, äldst först) och nästa match, sorterat efter placering. */
export function teamSummaries(
  teams: LocalTeamRow[],
  matches: UiMatch[],
  now: Date,
): TeamSummary[] {
  const t = now.getTime();
  const summaries = teams.map((team): TeamSummary => {
    const own = matches.filter((m) => m.homeId === team.teamId || m.awayId === team.teamId);

    const form = own
      .filter((m) => m.status === "FINISHED" && m.homeScore != null && m.awayScore != null)
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .slice(0, FORM_LENGTH)
      .map((m): FormLetter => {
        const home = m.homeId === team.teamId;
        const gf = home ? m.homeScore! : m.awayScore!;
        const ga = home ? m.awayScore! : m.homeScore!;
        return gf > ga ? "V" : gf < ga ? "F" : "O";
      })
      .reverse();

    const nextMatch = own
      .filter((m) => m.status === "UPCOMING" && m.startsAt.getTime() >= t)
      .sort(byStart)[0];
    const next = nextMatch
      ? {
          startsAt: nextMatch.startsAt,
          home: nextMatch.homeId === team.teamId,
          opponent: nextMatch.homeId === team.teamId ? nextMatch.awayName : nextMatch.homeName,
        }
      : null;

    return { ...team, form, next };
  });

  return summaries.sort(
    (a, b) =>
      (a.position ?? Infinity) - (b.position ?? Infinity) || a.name.localeCompare(b.name, "sv"),
  );
}

/** En rad per lag (t.ex. tableRows kan ha en kvarglömd rad från en grupp laget
 * lämnat): behåller raden med senast computedAt, null förlorar alltid mot en
 * daterad rad, och vid oavgjort (allt null) behålls den första. Ordningen på
 * de kvarvarande raderna följer indata. */
export function latestRowPerTeam<T extends { teamId: string; computedAt: Date | null }>(
  rows: T[],
): T[] {
  const bestIndex = new Map<string, number>();
  rows.forEach((row, i) => {
    const currentBest = bestIndex.get(row.teamId);
    if (currentBest === undefined) {
      bestIndex.set(row.teamId, i);
      return;
    }
    const best = rows[currentBest];
    if (
      row.computedAt !== null &&
      (best.computedAt === null || row.computedAt.getTime() > best.computedAt.getTime())
    ) {
      bestIndex.set(row.teamId, i);
    }
  });
  const keepIndices = new Set(bestIndex.values());
  return rows.filter((_, i) => keepIndices.has(i));
}

export type TickerItem = { kind: "result" | "upcoming"; match: UiMatch };

const TICKER_RESULT_DAYS = 14;
const TICKER_MAX_RESULTS = 8;

/** Tickern: senaste lokala resultaten (nyast först) följt av kommande lokala matcher inom 7 dagar. */
export function tickerItems(
  matches: UiMatch[],
  localIds: ReadonlySet<string>,
  now: Date,
): TickerItem[] {
  const t = now.getTime();
  const local = matches.filter((m) => isLocalMatch(m, localIds));
  const results = local
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        m.startsAt.getTime() <= t &&
        m.startsAt.getTime() >= t - TICKER_RESULT_DAYS * DAY_MS,
    )
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .slice(0, TICKER_MAX_RESULTS);
  const upcoming = local
    .filter(
      (m) =>
        m.status === "UPCOMING" &&
        m.startsAt.getTime() >= t &&
        m.startsAt.getTime() <= t + WINDOW_MS,
    )
    .sort(byStart);
  return [
    ...results.map((match): TickerItem => ({ kind: "result", match })),
    ...upcoming.map((match): TickerItem => ({ kind: "upcoming", match })),
  ];
}
