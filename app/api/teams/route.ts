import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { groups, leagues, teamEntries, teams } from "@/lib/db/schema";

// Lista alla lag med serie — används av admin/debug och framtida "följ lag".
export async function GET() {
  const db = await getDb();
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      league: leagues.name,
      leagueId: leagues.id,
    })
    .from(teamEntries)
    .innerJoin(teams, eq(teamEntries.teamId, teams.id))
    .innerJoin(groups, eq(teamEntries.groupId, groups.id))
    .innerJoin(leagues, eq(groups.leagueId, leagues.id))
    .orderBy(leagues.name, teams.name);
  return NextResponse.json(rows);
}
