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
import { and, eq } from "drizzle-orm";
import { z } from "zod";

// Synken är enda skribenten till sportdata-zonen. Den:
//  1. hämtar från källan, 2. Zod-validerar, 3. upsertar idempotent
//  (naturliga id:n "<källa>-<ref>"), 4. ersätter tabellen per grupp.

function nid(source: string, ref: string) {
  return `${source}-${ref}`;
}

export async function syncLeague(source: MatchSource, leagueRef: string, seasonSlug: string) {
  const db = await getDb();

  const league = sourceLeagueSchema.parse(await source.getLeague(leagueRef, seasonSlug));
  const rawMatches = z.array(sourceMatchSchema).parse(await source.getMatches(leagueRef, seasonSlug));
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

  for (const g of league.groups) {
    const groupId = nid(source.name, g.sourceRef);
    await db
      .insert(groups)
      .values({ id: groupId, leagueId, name: g.name })
      .onConflictDoUpdate({ target: groups.id, set: { name: g.name, leagueId } });

    for (const t of g.teams) {
      const teamId = nid(source.name, t.sourceRef);
      await db
        .insert(teams)
        .values({
          id: teamId,
          name: t.name,
          shortName: t.shortName ?? null,
          logoUrl: t.logoUrl ?? null,
        })
        .onConflictDoUpdate({
          target: teams.id,
          // behåll befintlig logo om ny synk saknar den (lägre divisioner
          // saknar emblem hos Everysport — skriv inte över med null)
          set: {
            name: t.name,
            shortName: t.shortName ?? null,
            ...(t.logoUrl ? { logoUrl: t.logoUrl } : {}),
          },
        });
      await db
        .insert(teamEntries)
        .values({ teamId, groupId })
        .onConflictDoNothing();
    }
  }

  const now = new Date();
  for (const m of rawMatches) {
    const row = {
      id: nid(source.name, m.sourceRef),
      groupId: nid(source.name, m.groupRef),
      round: m.round ?? null,
      startsAt: new Date(m.startsAt),
      status: m.status,
      homeTeamId: nid(source.name, m.homeTeamRef),
      awayTeamId: nid(source.name, m.awayTeamRef),
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      updatedAt: now,
    };
    // (Här hör diff-detektering + notiser hemma i v2: jämför status/resultat
    // mot befintlig rad innan upsert och skapa Notification vid förändring.)
    await db
      .insert(matches)
      .values(row)
      .onConflictDoUpdate({
        target: matches.id,
        set: {
          startsAt: row.startsAt,
          status: row.status,
          homeScore: row.homeScore,
          awayScore: row.awayScore,
          round: row.round,
          updatedAt: now,
        },
      });
  }

  // Tabellen ersätts atomiskt per grupp — källan är alltid facit.
  const groupIds = new Set(rawTable.map((r) => nid(source.name, r.groupRef)));
  for (const groupId of groupIds) {
    await db.delete(tableRows).where(eq(tableRows.groupId, groupId));
  }
  for (const r of rawTable) {
    await db.insert(tableRows).values({
      groupId: nid(source.name, r.groupRef),
      teamId: nid(source.name, r.teamRef),
      position: r.position,
      gp: r.gp, w: r.w, d: r.d, l: r.l,
      gf: r.gf, ga: r.ga, gd: r.gd, pts: r.pts,
      positionStatus: r.positionStatus,
      computedAt: now,
    });
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

/** Synkar matchdata (tabeller/matcher) + målskyttar. Körs ofta (var 15:e min)
 * så skyttarna dyker upp snabbt efter DV:s matchrapporter (~2 h efter match).
 * En serie som fallerar (t.ex. Everysport svarar konstigt) stoppar inte de andra. */
export async function syncMatches() {
  for (const t of SYNC_TARGETS) {
    try {
      await syncLeague(t.source, t.ref, t.season);
    } catch (err) {
      console.error(`[sync] serie ${t.ref} misslyckades:`, err);
    }
  }
  // efter matcherna (så kopplingen hittar dem) — billig i steady state:
  // dv_reports-dedupen gör att AI bara körs på nya rapporter.
  try {
    const { syncGoals } = await import("./goals");
    await syncGoals();
  } catch (err) {
    console.error("[sync] målskyttar misslyckades:", err);
  }
}

/** Hämtar nyheter (+ AI-filter) och poddavsnitt. Körs en gång/dygn (22:00) —
 * täcker båda poddarnas släpp (Nykritat tors, Fotbollsviken fre). */
export async function syncNewsAndFilter() {
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
}

/** Full synk: matcher + nyheter + filter. Används av /api/sync (manuell/cron-backup).
 * Vakt: bara en synk i taget — samtidiga anrop returnerar direkt (skyddar mot
 * överlappande körningar som annars rate-limitar Everysport). */
export async function syncAll(): Promise<{ ran: boolean }> {
  const g = globalThis as typeof globalThis & { __kfSyncing?: boolean };
  if (g.__kfSyncing) return { ran: false };
  g.__kfSyncing = true;
  try {
    await syncMatches();
    await syncNewsAndFilter();
    return { ran: true };
  } finally {
    g.__kfSyncing = false;
  }
}

/** Autoseed: synkar de serier som ännu inte finns i databasen (första sidladdning). */
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
