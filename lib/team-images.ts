import { existsSync } from "node:fs";
import path from "node:path";
import { TEAM_SLUGS } from "./teams";

// Lagbilder. Lägg en liggande bild (minst ~1600×900) som
// public/images/lag/<slug>.jpg så används den automatiskt; saknas den visas
// en grafisk reserv. Kontrollen görs en gång per serverprocess.
// Slug-tabellen finns i lib/teams.ts.

const cache = new Map<string, string | null>();

export function teamImage(teamId: string): string | null {
  const cached = cache.get(teamId);
  if (cached !== undefined) return cached;
  const slug = TEAM_SLUGS[teamId];
  const url =
    slug && existsSync(path.join(process.cwd(), "public", "images", "lag", `${slug}.jpg`))
      ? `/images/lag/${slug}.jpg`
      : null;
  cache.set(teamId, url);
  return url;
}
