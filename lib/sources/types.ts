import { z } from "zod";

// Källans värld — INTE våra DB-typer. Varje MatchSource levererar dessa,
// och lib/sync.ts normaliserar in i databasen. Zod-schemana valideras i
// synken oavsett källa: ändrar ett externt API sin form får vi ett tydligt
// valideringsfel i loggen istället för tyst korrupt data.

export const matchStatusSchema = z.enum([
  "UPCOMING",
  "ONGOING",
  "FINISHED",
  "POSTPONED",
  "CANCELED",
  "INTERRUPTED",
]);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

export const sourceTeamSchema = z.object({
  sourceRef: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  logoUrl: z.string().url().optional(),
});
export type SourceTeam = z.infer<typeof sourceTeamSchema>;

export const sourceGroupSchema = z.object({
  sourceRef: z.string(),
  name: z.string(),
  teams: z.array(sourceTeamSchema),
});
export type SourceGroup = z.infer<typeof sourceGroupSchema>;

export const sourceLeagueSchema = z.object({
  sourceRef: z.string(),
  name: z.string(),
  level: z.string(),
  teamClass: z.enum(["MEN", "WOMEN", "BOYS", "GIRLS", "MIX"]),
  district: z.string(),
  season: z.object({ slug: z.string(), label: z.string() }),
  groups: z.array(sourceGroupSchema),
});
export type SourceLeague = z.infer<typeof sourceLeagueSchema>;

export const sourceMatchSchema = z.object({
  sourceRef: z.string(),
  groupRef: z.string(),
  round: z.number().int().optional(),
  startsAt: z.iso.datetime(),
  status: matchStatusSchema,
  homeTeamRef: z.string(),
  awayTeamRef: z.string(),
  homeScore: z.number().int().nullable(),
  awayScore: z.number().int().nullable(),
});
export type SourceMatch = z.infer<typeof sourceMatchSchema>;

export const sourceTableRowSchema = z.object({
  groupRef: z.string(),
  teamRef: z.string(),
  position: z.number().int(),
  gp: z.number().int(),
  w: z.number().int(),
  d: z.number().int(),
  l: z.number().int(),
  gf: z.number().int(),
  ga: z.number().int(),
  gd: z.number().int(),
  pts: z.number().int(),
  positionStatus: z.string().nullable(),
});
export type SourceTableRow = z.infer<typeof sourceTableRowSchema>;

/**
 * Källagnostiskt ingest-interface. Implementationer:
 *  - SeedSource     (deterministisk demodata — dag 1)
 *  - EverysportSource (api.everysport.com/v1 — när API-nyckeln finns)
 *  - ManualSource   (admin-inmatning — fallback)
 * Appen läser aldrig från en källa direkt, bara från vår egen databas.
 */
export interface MatchSource {
  readonly name: string;
  getLeague(leagueRef: string, season: string): Promise<SourceLeague>;
  getMatches(leagueRef: string, season: string): Promise<SourceMatch[]>;
  getTable(leagueRef: string, season: string): Promise<SourceTableRow[]>;
}
