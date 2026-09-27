import { getDb } from "./db/client";
import {
  seasons,
  leagues,
  groups,
  teams,
  teamEntries,
  matches,
  tableRows,
} from "./db/schema";
import {
  sourceLeagueSchema,
  sourceMatchSchema,
  sourceTableRowSchema,
  type MatchSource,
} from "./sources/types";
import { EverysportWidgetSource } from "./sources/everysport-widget";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";

// Synken är enda skribenten till sportdata-zonen. Den:
//  1. hämtar från källan, 2. Zod-validerar, 3. upsertar idempotent
//  (naturliga id:n "<källa>-<ref>"), 4. ersätter tabellen per grupp.
// Varje tabell skrivs med ett anrop per serie (flerradsinsert), inte ett per rad.

function nid(source: string, ref: string) {
  return `${source}-${ref}`;
}

/** Serien, grupperna, lagen och tabellen — allt kommer från standings-sidan. */
async function syncLeagueTable(source: MatchSource, leagueRef: string, seasonSlug: string) {
  const db = await getDb();

  const league = sourceLeagueSchema.parse(await source.getLeague(leagueRef, seasonSlug));
  const rawTable = z.array(sourceTableRowSchema).parse(await source.getTable(leagueRef, seasonSlug));

  const seasonId = nid(source.name, league.season.slug);
  const leagueId = nid(source.name, league.sourceRef);

  await db
    .insert(seasons)
    .values({ id: seasonId, slug: league.season.slug, label: league.season.label })
    .onConflictDoUpdate({
      target: seasons.id,
      set: { slug: league.season.slug, label: league.season.label },
    });

  await db
    .insert(leagues)
    .values({
      id: leagueId,
      seasonId,
      name: league.name,
      level: league.level,
      teamClass: league.teamClass,
      district: league.district,
      sourceName: source.name,
      sourceRef: league.sourceRef,
    })
    .onConflictDoUpdate({
      target: leagues.id,
      set: { name: league.name, level: league.level, district: league.district },
    });

  const groupRows = league.groups.map((g) => ({
    id: nid(source.name, g.sourceRef),
    leagueId,
    name: g.name,
  }));
  // Keyed by id: Postgres refuses to update the same row twice in one insert.
  const teamRows = new Map<string, typeof teams.$inferInsert>();
  const entryRows: (typeof teamEntries.$inferInsert)[] = [];
  for (const g of league.groups) {
    for (const t of g.teams) {
      const teamId = nid(source.name, t.sourceRef);
      teamRows.set(teamId, {
        id: teamId,
        name: t.name,
        shortName: t.shortName ?? null,
        logoUrl: t.logoUrl ?? null,
      });
      entryRows.push({ teamId, groupId: nid(source.name, g.sourceRef) });
    }
  }

  if (groupRows.length > 0) {
    await db
      .insert(groups)
      .values(groupRows)
      .onConflictDoUpdate({
        target: groups.id,
        set: { name: sql`excluded.name`, leagueId: sql`excluded.league_id` },
      });
  }
  if (teamRows.size > 0) {
    await db
      .insert(teams)
      .values([...teamRows.values()])
      .onConflictDoUpdate({
        target: teams.id,
        set: {
          name: sql`excluded.name`,
          shortName: sql`excluded.short_name`,
          // behåll befintlig logo om ny synk saknar den (lägre divisioner
          // saknar emblem hos Everysport — skriv inte över med null)
          logoUrl: sql`coalesce(excluded.logo_url, teams.logo_url)`,
        },
      });
  }
  if (entryRows.length > 0) {
    await db.insert(teamEntries).values(entryRows).onConflictDoNothing();
  }

  // Tabellen ersätts atomiskt per grupp — källan är alltid facit.
  const now = new Date();
  const groupIds = [...new Set(rawTable.map((r) => nid(source.name, r.groupRef)))];
  if (groupIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.delete(tableRows).where(inArray(tableRows.groupId, groupIds));
    await tx.insert(tableRows).values(
      rawTable.map((r) => ({
        groupId: nid(source.name, r.groupRef),
        teamId: nid(source.name, r.teamRef),
        position: r.position,
        gp: r.gp, w: r.w, d: r.d, l: r.l,
        gf: r.gf, ga: r.ga, gd: r.gd, pts: r.pts,
        positionStatus: r.positionStatus,
        computedAt: now,
      })),
    );
  });
}

// Everysports lagsidor visar resultat ungefär tre veckor bakåt, seriens
// matchlista bara en vecka. Äldre matcher utan resultat går inte att rädda.
const TEAM_PAGE_LOOKBACK_MS = 21 * 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Matcher och resultat. Lagen och grupperna måste redan finnas (syncLeagueTable). */
async function syncLeagueMatches(source: MatchSource, leagueRef: string, seasonSlug: string) {
  const db = await getDb();
  const now = new Date();

  // Matcher som står som kommande fast de spelades för över ett dygn sedan har
  // fallit ur seriens fönster (t.ex. efter ett driftavbrott). Hemmalagets
  // lagsida har resultatet så länge matchen är yngre än ~tre veckor. Normalt
  // finns inga sådana, och då läses inga extra sidor.
  const stale = await db
    .select({ homeTeamId: matches.homeTeamId })
    .from(matches)
    .innerJoin(groups, eq(matches.groupId, groups.id))
    .where(
      and(
        eq(groups.leagueId, nid(source.name, leagueRef)),
        inArray(matches.status, ["UPCOMING", "ONGOING"]),
        lt(matches.startsAt, new Date(now.getTime() - STALE_AFTER_MS)),
        gt(matches.startsAt, new Date(now.getTime() - TEAM_PAGE_LOOKBACK_MS)),
      ),
    );
  const prefix = `${source.name}-`;
  const extraTeamRefs = [...new Set(stale.map((m) => m.homeTeamId.slice(prefix.length)))];

  const rawMatches = z
    .array(sourceMatchSchema)
    .parse(await source.getMatches(leagueRef, seasonSlug, extraTeamRefs));

  // Keyed by id: Postgres refuses to update the same row twice in one insert.
  const rows = new Map<string, typeof matches.$inferInsert>();
  for (const m of rawMatches) {
    const id = nid(source.name, m.sourceRef);
    rows.set(id, {
      id,
      groupId: nid(source.name, m.groupRef),
      round: m.round ?? null,
      startsAt: new Date(m.startsAt),
      status: m.status,
      homeTeamId: nid(source.name, m.homeTeamRef),
      awayTeamId: nid(source.name, m.awayTeamRef),
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      updatedAt: now,
    });
  }
  if (rows.size === 0) return;

  // (Här hör diff-detektering + notiser hemma i v2: jämför status/resultat
  // mot befintlig rad innan upsert och skapa Notification vid förändring.)
  await db
    .insert(matches)
    .values([...rows.values()])
    .onConflictDoUpdate({
      target: matches.id,
      set: {
        startsAt: sql`excluded.starts_at`,
        status: sql`excluded.status`,
        homeScore: sql`excluded.home_score`,
        awayScore: sql`excluded.away_score`,
        round: sql`excluded.round`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

/** Hela serien: tabell (skapar lag/grupper) följt av matcher. */
export async function syncLeague(source: MatchSource, leagueRef: string, seasonSlug: string) {
  await syncLeagueTable(source, leagueRef, seasonSlug);
  await syncLeagueMatches(source, leagueRef, seasonSlug);
}

// En körning i taget per jobb: appens timer och en manuell /api/sync ska inte
// köra samma jobb parallellt (dubbla Everysport-anrop, dubbla AI-anrop).
const globalForSync = globalThis as typeof globalThis & { __kfRunningJobs?: Set<string> };
const runningJobs = (globalForSync.__kfRunningJobs ??= new Set());

async function exclusive(job: string, fn: () => Promise<void>): Promise<boolean> {
  if (runningJobs.has(job)) return false;
  runningJobs.add(job);
  try {
    await fn();
    return true;
  } finally {
    runningJobs.delete(job);
  }
}

// Konfigurerade källor/serier. Ny serie = en rad till.
// (SeedSource finns kvar i lib/sources/seed.ts för test/utveckling.)
// De lokala lagens sidor skördas också — de ser ~3 veckor framåt/bakåt
// mot serie-widgetens ~1 vecka, så "nästa match" fångas tidigare.
const esWidget = new EverysportWidgetSource({
  "144727": ["9925"], // IFK Västervik
  "144587": ["10040", "51390", "9942"], // Hjorted/Totebo, Tjust IF FF, Västerviks FF
  "144652": ["23106"], // B.O.IF
  "144487": ["10039", "224214", "10249", "9982"], // Gunnebo, Örbäcken, Överum, Ankarsrum
  "144822": ["191798"], // Västerviks damfotboll IF
});
const SYNC_TARGETS: { source: MatchSource; ref: string; season: string }[] = [
  { source: esWidget, ref: "144727", season: "2026" }, // Div 3 nordöstra Götaland (IFK Västervik)
  { source: esWidget, ref: "144587", season: "2026" }, // Div 4 Småland norra
  { source: esWidget, ref: "144487", season: "2026" }, // Div 6 Vimmerby
  { source: esWidget, ref: "144652", season: "2026" }, // Div 5 Småland nordöstra
  { source: esWidget, ref: "144822", season: "2026" }, // Div 3 Småland sydöstra (dam)
];

/** Synkar allt som rör lagen: serier, lag, tabeller, matcher/resultat och
 * målskyttar. Körs en gång/dygn (23:00), efter kvällens matcher.
 * En serie som fallerar (t.ex. Everysport svarar konstigt) stoppar inte de andra.
 * Returnerar false om en lagsynk redan pågår. */
export function syncTeams(): Promise<boolean> {
  return exclusive("teams", async () => {
    for (const t of SYNC_TARGETS) {
      try {
        await syncLeague(t.source, t.ref, t.season);
      } catch (err) {
        console.error(`[sync] serie ${t.ref} misslyckades:`, err);
      }
    }
    // efter matcherna (så kopplingen hittar dem) — dv_reports-dedupen gör att
    // AI bara körs på nya rapporter.
    try {
      const { syncGoals } = await import("./goals");
      await syncGoals();
    } catch (err) {
      console.error("[sync] målskyttar misslyckades:", err);
    }
  });
}

/** Hämtar nyheter (+ AI-filter) och poddavsnitt. Körs en gång/dygn (22:00) —
 * täcker båda poddarnas släpp (Nykritat tors, Fotbollsviken fre).
 * Returnerar false om en nyhetssynk redan pågår. */
export function syncNewsAndFilter(): Promise<boolean> {
  return exclusive("news", async () => {
    const { syncNews } = await import("./news");
    await syncNews();
    const { filterRelevance } = await import("./relevance");
    await filterRelevance();
    const { syncPodcasts } = await import("./podcasts");
    await syncPodcasts();
    // Bakåtfyllnad: läser redan hämtade artiklar (bredare recall än DV:s
    // sektionslista i syncGoals) för att hitta målskyttar i rubrik/ingress.
    try {
      const { syncGoalsFromArticles } = await import("./goals");
      await syncGoalsFromArticles();
    } catch (err) {
      console.error("[sync] artikel-baserade målskyttar misslyckades:", err);
    }
  });
}

/** Full synk: lag + nyheter. Används av /api/sync (manuell backup).
 * Varje jobb har sin egen spärr, så inget körs dubbelt parallellt. */
export async function syncAll(): Promise<{ ran: boolean }> {
  const teams = await syncTeams();
  const news = await syncNewsAndFilter();
  return { ran: teams || news };
}

/** Autoseed: synkar de serier som ännu inte finns i databasen (vid serverstart). */
export async function ensureSynced() {
  const db = await getDb();
  for (const t of SYNC_TARGETS) {
    const existing = await db
      .select({ id: leagues.id })
      .from(leagues)
      .where(
        and(
          eq(leagues.sourceName, t.source.name),
          eq(leagues.sourceRef, t.ref),
        ),
      )
      .limit(1);
    if (existing.length === 0) await syncLeague(t.source, t.ref, t.season);
  }
}
