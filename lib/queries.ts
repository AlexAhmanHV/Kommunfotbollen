import { alias } from "drizzle-orm/pg-core";
import { asc, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "./db/client";
import { groups, leagues, matches, teams } from "./db/schema";

export type UiMatch = {
  id: string;
  round: number | null;
  startsAt: Date;
  status: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  homeLogo: string | null;
  awayLogo: string | null;
  homeScore: number | null;
  awayScore: number | null;
  leagueId: string;
  leagueName: string;
};

// Flyttad till lib/matchday.ts (ren logik, testbar); återexporteras så att
// befintliga importer fungerar.
export { isResultMissing } from "./matchday";

const home = alias(teams, "home");
const away = alias(teams, "away");

export async function getMatches(opts: {
  where?: SQL;
  order?: "asc" | "desc";
  limit?: number;
}): Promise<UiMatch[]> {
  const db = await getDb();
  let q = db
    .select({
      id: matches.id,
      round: matches.round,
      startsAt: matches.startsAt,
      status: matches.status,
      homeId: matches.homeTeamId,
      awayId: matches.awayTeamId,
      homeName: home.name,
      awayName: away.name,
      homeLogo: home.logoUrl,
      awayLogo: away.logoUrl,
      homeScore: matches.homeScore,
      awayScore: matches.awayScore,
      leagueId: leagues.id,
      leagueName: leagues.name,
    })
    .from(matches)
    .innerJoin(home, eq(matches.homeTeamId, home.id))
    .innerJoin(away, eq(matches.awayTeamId, away.id))
    .innerJoin(groups, eq(matches.groupId, groups.id))
    .innerJoin(leagues, eq(groups.leagueId, leagues.id))
    .orderBy(opts.order === "desc" ? desc(matches.startsAt) : asc(matches.startsAt))
    .$dynamic();
  if (opts.where) q = q.where(opts.where);
  if (opts.limit) q = q.limit(opts.limit);
  return q;
}
