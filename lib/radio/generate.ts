import { and, desc, eq, gte, inArray, lt, or } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  groups,
  leagues,
  matches,
  matchGoals,
  matchQuotes,
  radioEpisodes,
  tableRows,
  teams,
} from "../db/schema";
import { FEATURED_PRIORITY, LOCAL_TEAM_IDS } from "../local-teams";
import { latestRowPerTeam } from "../matchday";
import { getMatches } from "../queries";
import { buildEpisodeData, standingsSnapshot } from "./episode-data";
import { writeScript } from "./script";
import { storageReachable, synthesize, uploadAudio } from "./voice";
import { lastCompletedWeek } from "./week";

// Matchradion: ett avsnitt för senast avslutade vecka. Körs dagligen men gör
// bara något när avsnittet saknas (i praktiken måndag kväll; misslyckas det
// försöker nästa körning igen).
//
// Robusthet (samma fail-open som relevance.ts):
//  - saknad nyckel → logga och hoppa över, sajten visar bara inget nytt avsnitt
//  - ordning manus → ljud → uppladdning → SIST raden: ett fel i något steg
//    lämnar inget halvfärdigt avsnitt, nästa körning gör om alltihop.

// Äldre än så räknas förra avsnittet inte som "förra veckan" (t.ex. över
// vinteruppehållet) och tabellförändringar nämns inte.
const PREVIOUS_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;

// Betalda försök per veckonyckel i denna process — ett ihållande fel (t.ex. fel
// röst eller trasig lagring) ska inte bränna krediter varje natt. Nollställs vid omstart.
const MAX_PAID_ATTEMPTS = 2;
const paidAttempts = new Map<string, number>();

export async function generateEpisode(now: Date = new Date()): Promise<void> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [
    ["ANTHROPIC_API_KEY", anthropicKey],
    ["ELEVENLABS_API_KEY", elevenKey],
    ["ELEVENLABS_VOICE_ID", voiceId],
    ["SUPABASE_URL", supabaseUrl],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
  ]
    .filter(([, v]) => !v)
    .map(([name]) => name);
  if (!anthropicKey || !elevenKey || !voiceId || !supabaseUrl || !serviceKey) {
    console.log(`[radio] hoppar över: nycklar saknas (${missing.join(", ")})`);
    return;
  }

  const week = lastCompletedWeek(now);
  const db = await getDb();
  const existing = await db
    .select({ id: radioEpisodes.id })
    .from(radioEpisodes)
    .where(eq(radioEpisodes.id, week.key))
    .limit(1);
  if (existing.length > 0) return;
  if ((paidAttempts.get(week.key) ?? 0) >= MAX_PAID_ATTEMPTS) {
    console.log(`[radio] ${week.key}: hoppar över, ${MAX_PAID_ATTEMPTS} misslyckade försök — väntar på omstart`);
    return;
  }

  const localIds = [...LOCAL_TEAM_IDS];
  const [localMatches, tableData, previousRows] = await Promise.all([
    getMatches({
      where: or(inArray(matches.homeTeamId, localIds), inArray(matches.awayTeamId, localIds)),
      order: "asc",
    }),
    db
      .select({
        groupId: tableRows.groupId,
        leagueName: leagues.name,
        teamId: tableRows.teamId,
        teamName: teams.name,
        position: tableRows.position,
        pts: tableRows.pts,
        computedAt: tableRows.computedAt,
      })
      .from(tableRows)
      .innerJoin(teams, eq(tableRows.teamId, teams.id))
      .innerJoin(groups, eq(tableRows.groupId, groups.id))
      .innerJoin(leagues, eq(groups.leagueId, leagues.id)),
    db
      .select({ standings: radioEpisodes.standings })
      .from(radioEpisodes)
      // Bara ett färskt avsnitt duger att jämföra tabellen mot — annars skulle
      // vårens första avsnitt jämföra med förra säsongens slutplaceringar.
      .where(
        and(
          lt(radioEpisodes.weekStart, week.start),
          gte(radioEpisodes.weekStart, new Date(week.start.getTime() - PREVIOUS_MAX_AGE_MS)),
        ),
      )
      .orderBy(desc(radioEpisodes.weekStart))
      .limit(1),
  ]);

  const matchIds = localMatches.map((m) => m.id);
  const [goals, quotes] =
    matchIds.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              matchId: matchGoals.matchId,
              teamId: matchGoals.teamId,
              player: matchGoals.player,
              ord: matchGoals.ord,
            })
            .from(matchGoals)
            .where(inArray(matchGoals.matchId, matchIds)),
          db
            .select({
              matchId: matchQuotes.matchId,
              ord: matchQuotes.ord,
              teamId: matchQuotes.teamId,
              speaker: matchQuotes.speaker,
              role: matchQuotes.role,
              quote: matchQuotes.quote,
              sourceUrl: matchQuotes.sourceUrl,
            })
            .from(matchQuotes)
            .where(inArray(matchQuotes.matchId, matchIds)),
        ]);

  // En tabellrad per lag (en kvarglömd rad från en grupp laget lämnat ska inte räknas).
  const table = latestRowPerTeam(tableData);
  const standings = standingsSnapshot(table, LOCAL_TEAM_IDS);
  const data = buildEpisodeData({
    week,
    localIds: new Set(FEATURED_PRIORITY),
    matches: localMatches,
    goals,
    quotes,
    table,
    previous: previousRows[0]?.standings ?? null,
  });
  if (!data) {
    console.log(`[radio] ${week.key}: inga spelade lokala matcher, inget avsnitt`);
    return;
  }

  // Kolla lagringen INNAN något betalt anrop görs
  const reachable = await storageReachable(supabaseUrl, serviceKey);
  if (reachable !== true) {
    console.log(`[radio] hoppar över: Storage-bucketen radio nås inte (${reachable})`);
    return;
  }

  paidAttempts.set(week.key, (paidAttempts.get(week.key) ?? 0) + 1);
  const script = await writeScript(data, anthropicKey);
  const audio = await synthesize(script, elevenKey, voiceId);
  const audioUrl = await uploadAudio(week.key, audio, supabaseUrl, serviceKey);
  await db
    .insert(radioEpisodes)
    .values({ id: week.key, weekStart: week.start, script, audioUrl, standings, createdAt: new Date() })
    .onConflictDoNothing();
  console.log(`[radio] ${week.key}: avsnitt klart (${script.length} tecken)`);
}
