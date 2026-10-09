import type { UiMatch } from "../queries";
import { paperName } from "../quotes";
import type { RadioWeek } from "./week";

// Veckans underlag till Matchradion — ren logik, ingen databas. Allt som
// står här får manuset nämna, och inget annat (se script.ts).

export type StandingsSnapshot = Record<string, { position: number; pts: number }>;

export type GoalRow = { matchId: string; teamId: string; player: string; ord: number };
export type QuoteRow = {
  matchId: string;
  ord: number;
  teamId: string | null;
  speaker: string;
  role: string | null;
  quote: string;
  sourceUrl: string;
};
export type TableRow = {
  groupId: string;
  leagueName: string;
  teamId: string;
  teamName: string;
  position: number;
  pts: number;
};

export type Quote = { speaker: string; role: string | null; quote: string; source: string };
export type TeamResult = {
  opponent: string;
  home: boolean;
  goalsFor: number;
  goalsAgainst: number;
  outcome: "vinst" | "oavgjort" | "förlust";
  scorers: string[]; // lagets egna skyttar i rapportordning; tom = okända
  quotes: Quote[];
};
export type TeamWeek = {
  team: string;
  league: string;
  results: TeamResult[];
  next: { opponent: string; home: boolean; date: string } | null;
};
export type LeagueTable = {
  league: string;
  leader: { team: string; pts: number };
  localTeams: { team: string; position: number; pts: number; previousPosition: number | null }[];
};
export type EpisodeData = { week: number; teams: TeamWeek[]; tables: LeagueTable[] };

const nextDateFmt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Stockholm",
});

const byStart = (a: UiMatch, b: UiMatch) => a.startsAt.getTime() - b.startsAt.getTime();
const involves = (m: UiMatch, teamId: string) => m.homeId === teamId || m.awayId === teamId;

/** De lokala lagens placering just nu — sparas med avsnittet så att nästa
 * avsnitt kan jämföra (table_rows har ingen historik). */
export function standingsSnapshot(rows: TableRow[], localIds: ReadonlySet<string>): StandingsSnapshot {
  const snap: StandingsSnapshot = {};
  for (const r of rows) {
    if (localIds.has(r.teamId)) snap[r.teamId] = { position: r.position, pts: r.pts };
  }
  return snap;
}

function leagueTables(
  rows: TableRow[],
  localIds: ReadonlySet<string>,
  previous: StandingsSnapshot | null,
): LeagueTable[] {
  const groups = new Map<string, TableRow[]>();
  for (const r of rows) {
    const g = groups.get(r.groupId);
    if (g) g.push(r);
    else groups.set(r.groupId, [r]);
  }
  const tables: LeagueTable[] = [];
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.position - b.position);
    const locals = sorted.filter((r) => localIds.has(r.teamId));
    if (locals.length === 0) continue;
    tables.push({
      league: sorted[0].leagueName,
      leader: { team: sorted[0].teamName, pts: sorted[0].pts },
      localTeams: locals.map((r) => ({
        team: r.teamName,
        position: r.position,
        pts: r.pts,
        previousPosition: previous?.[r.teamId]?.position ?? null,
      })),
    });
  }
  return tables.sort((a, b) => a.league.localeCompare(b.league, "sv"));
}

/** Veckans underlag, eller null om inget lokalt lag spelat (då blir det inget avsnitt).
 * Lagen kommer i `localIds` ordning. */
export function buildEpisodeData(input: {
  week: RadioWeek;
  localIds: ReadonlySet<string>;
  matches: UiMatch[];
  goals: GoalRow[];
  quotes: QuoteRow[];
  table: TableRow[];
  previous: StandingsSnapshot | null;
}): EpisodeData | null {
  const { week, localIds, matches, goals, quotes, table, previous } = input;
  const played = matches
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        m.homeScore !== null &&
        m.awayScore !== null &&
        m.startsAt >= week.start &&
        m.startsAt < week.end,
    )
    .sort(byStart);

  const teams: TeamWeek[] = [];
  for (const teamId of localIds) {
    const own = played.filter((m) => involves(m, teamId));
    if (own.length === 0) continue;

    const results = own.map((m): TeamResult => {
      const home = m.homeId === teamId;
      const goalsFor = (home ? m.homeScore : m.awayScore) as number;
      const goalsAgainst = (home ? m.awayScore : m.homeScore) as number;
      return {
        opponent: home ? m.awayName : m.homeName,
        home,
        goalsFor,
        goalsAgainst,
        outcome: goalsFor > goalsAgainst ? "vinst" : goalsFor === goalsAgainst ? "oavgjort" : "förlust",
        scorers: goals
          .filter((g) => g.matchId === m.id && g.teamId === teamId)
          .sort((a, b) => a.ord - b.ord)
          .map((g) => g.player),
        quotes: quotes
          .filter((q) => q.matchId === m.id && (q.teamId === teamId || q.teamId === null))
          .sort((a, b) => a.ord - b.ord)
          .map((q) => ({ speaker: q.speaker, role: q.role, quote: q.quote, source: paperName(q.sourceUrl) })),
      };
    });

    const next = matches
      .filter((m) => m.status === "UPCOMING" && m.startsAt >= week.end && involves(m, teamId))
      .sort(byStart)[0];
    const first = own[0];
    teams.push({
      team: first.homeId === teamId ? first.homeName : first.awayName,
      league: first.leagueName,
      results,
      next: next
        ? {
            opponent: next.homeId === teamId ? next.awayName : next.homeName,
            home: next.homeId === teamId,
            date: nextDateFmt.format(next.startsAt),
          }
        : null,
    });
  }

  if (teams.length === 0) return null;
  return {
    week: Number(week.key.slice(6)),
    teams,
    tables: leagueTables(table, localIds, previous),
  };
}
