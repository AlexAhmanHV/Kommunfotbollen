import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema";

// PGlite = inbäddad Postgres (WASM) som persisterar till .pgdata/.
// Samma pg-dialekt som produktion (Neon/Supabase) — schema.ts flyttar orört.
// Singleton via globalThis så Next.js HMR inte öppnar databasen flera gånger.

const DDL = `
CREATE TABLE IF NOT EXISTS seasons (
  id text PRIMARY KEY,
  slug text NOT NULL,
  label text NOT NULL
);
CREATE TABLE IF NOT EXISTS leagues (
  id text PRIMARY KEY,
  season_id text NOT NULL REFERENCES seasons(id),
  name text NOT NULL,
  level text NOT NULL,
  team_class text NOT NULL,
  district text NOT NULL,
  source_name text NOT NULL,
  source_ref text NOT NULL
);
CREATE TABLE IF NOT EXISTS groups (
  id text PRIMARY KEY,
  league_id text NOT NULL REFERENCES leagues(id),
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  short_name text
);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_url text;
CREATE TABLE IF NOT EXISTS team_entries (
  team_id text NOT NULL REFERENCES teams(id),
  group_id text NOT NULL REFERENCES groups(id),
  PRIMARY KEY (team_id, group_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id text PRIMARY KEY,
  group_id text NOT NULL REFERENCES groups(id),
  round integer,
  starts_at timestamptz NOT NULL,
  status text NOT NULL,
  home_team_id text NOT NULL REFERENCES teams(id),
  away_team_id text NOT NULL REFERENCES teams(id),
  home_score integer,
  away_score integer,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS articles (
  id text PRIMARY KEY,
  title text NOT NULL,
  summary text,
  source text NOT NULL,
  published_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS article_teams (
  article_id text NOT NULL REFERENCES articles(id),
  team_id text NOT NULL REFERENCES teams(id),
  PRIMARY KEY (article_id, team_id)
);
ALTER TABLE article_teams ADD COLUMN IF NOT EXISTS relevant boolean;
ALTER TABLE article_teams ADD COLUMN IF NOT EXISTS checked_at timestamptz;
CREATE TABLE IF NOT EXISTS podcast_episodes (
  id text PRIMARY KEY,
  podcast text NOT NULL,
  title text NOT NULL,
  summary text,
  audio_url text,
  duration_sec integer,
  published_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS match_goals (
  match_id text NOT NULL REFERENCES matches(id),
  ord integer NOT NULL,
  team_id text NOT NULL REFERENCES teams(id),
  player text NOT NULL,
  source_url text,
  PRIMARY KEY (match_id, ord)
);
CREATE TABLE IF NOT EXISTS dv_reports (
  url text PRIMARY KEY,
  match_id text,
  checked_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS table_rows (
  group_id text NOT NULL REFERENCES groups(id),
  team_id text NOT NULL REFERENCES teams(id),
  position integer NOT NULL,
  gp integer NOT NULL, w integer NOT NULL, d integer NOT NULL, l integer NOT NULL,
  gf integer NOT NULL, ga integer NOT NULL, gd integer NOT NULL, pts integer NOT NULL,
  position_status text,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (group_id, team_id)
);
`;

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { __kfDb?: Promise<Db> };

async function createDb(): Promise<Db> {
  // I produktion (Render) pekar PGLITE_DATA_DIR mot en beständig disk, så
  // databasen överlever omstarter/deploys. Lokalt faller det tillbaka till
  // .pgdata i projektroten.
  const pglite = new PGlite(process.env.PGLITE_DATA_DIR ?? "./.pgdata");
  await pglite.exec(DDL);
  return drizzle(pglite, { schema });
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__kfDb) {
    globalForDb.__kfDb = createDb();
  }
  return globalForDb.__kfDb;
}
