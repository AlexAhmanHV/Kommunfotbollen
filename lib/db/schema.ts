import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

// Sportdata-zonen: skrivs ENDAST av synken (lib/sync.ts).
// Id:n är naturliga nycklar på formen "<källa>-<ref>" så upserts blir idempotenta.

export const seasons = pgTable("seasons", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  label: text("label").notNull(),
});

export const leagues = pgTable("leagues", {
  id: text("id").primaryKey(),
  seasonId: text("season_id")
    .notNull()
    .references(() => seasons.id),
  name: text("name").notNull(),
  level: text("level").notNull(),
  teamClass: text("team_class").notNull(),
  district: text("district").notNull(),
  sourceName: text("source_name").notNull(),
  sourceRef: text("source_ref").notNull(),
});

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  leagueId: text("league_id")
    .notNull()
    .references(() => leagues.id),
  name: text("name").notNull(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name"),
  logoUrl: text("logo_url"), // Everysport-emblem när det finns; annars monogram i UI
});

export const teamEntries = pgTable(
  "team_entries",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.groupId] })],
);

export const matches = pgTable("matches", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  round: integer("round"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(), // UPCOMING | ONGOING | FINISHED | POSTPONED | CANCELED | INTERRUPTED
  homeTeamId: text("home_team_id")
    .notNull()
    .references(() => teams.id),
  awayTeamId: text("away_team_id")
    .notNull()
    .references(() => teams.id),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// Nyhetsartiklar från lokaltidningarnas RSS — endast rubrik + kort ingress
// lagras; läsningen sker hos tidningen (vi länkar alltid vidare).
export const articles = pgTable("articles", {
  id: text("id").primaryKey(), // artikelns URL — naturlig dedupe-nyckel
  title: text("title").notNull(),
  summary: text("summary"),
  source: text("source").notNull(), // tidningens namn
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

export const articleTeams = pgTable(
  "article_teams",
  {
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    // AI-relevansfilter: null = ej bedömd ännu (visas optimistiskt),
    // true = handlar om lagets fotboll, false = brus (döljs i vyn).
    relevant: boolean("relevant"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.teamId] })],
);

// Poddavsnitt från lokala fotbollspoddar (Nykritat, Fotbollsviken). Endast
// metadata + länk lagras; lyssningen sker hos podden (vi länkar alltid vidare).
export const podcastEpisodes = pgTable("podcast_episodes", {
  id: text("id").primaryKey(), // avsnittets länk — naturlig dedupe-nyckel
  podcast: text("podcast").notNull(), // "Nykritat" | "Fotbollsviken"
  title: text("title").notNull(),
  summary: text("summary"),
  audioUrl: text("audio_url"),
  durationSec: integer("duration_sec"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

// Målskyttar per match, extraherade ur Dagens Västeriks fria matchrapporter
// (löptext → AI-extraktion). Kopplas till en match först när både lag OCH
// resultat i rapporten matchar matchen (annars ingen koppling — inga gissningar).
export const matchGoals = pgTable(
  "match_goals",
  {
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id),
    ord: integer("ord").notNull(), // ordning i rapporten (0-baserad)
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    player: text("player").notNull(),
    sourceUrl: text("source_url"),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.ord] })],
);

// Bearbetade DV-rapport-URL:er, så vi inte hämtar + AI-kör samma artikel igen.
export const dvReports = pgTable("dv_reports", {
  url: text("url").primaryKey(),
  matchId: text("match_id"), // satt om rapporten kunde kopplas till en match
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
});

export const tableRows = pgTable(
  "table_rows",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id),
    position: integer("position").notNull(),
    gp: integer("gp").notNull(),
    w: integer("w").notNull(),
    d: integer("d").notNull(),
    l: integer("l").notNull(),
    gf: integer("gf").notNull(),
    ga: integer("ga").notNull(),
    gd: integer("gd").notNull(),
    pts: integer("pts").notNull(),
    positionStatus: text("position_status"), // promotion | playoff | relegation | null
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.teamId] })],
);
