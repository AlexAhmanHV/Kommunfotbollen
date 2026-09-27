import { existsSync } from "node:fs";
import path from "node:path";
import { TEAM_SLUGS } from "./teams";

// Lagbilder, förminskade i förväg med `npm run images:lag` (se
// public/images/lag/README.md) till public/images/lag/<slug>.webp och
// <slug>-640.webp. De visas med `unoptimized` så att servern aldrig kör
// bildoptimering på dem. Saknas bilden visas en grafisk reserv.
// Kontrollen görs en gång per serverprocess. Slug-tabellen finns i lib/teams.ts.

export type TeamImageSize = "large" | "small";

const cache = new Map<string, string | null>();

export function teamImage(teamId: string, size: TeamImageSize = "large"): string | null {
  let slug = cache.get(teamId);
  if (slug === undefined) {
    const s = TEAM_SLUGS[teamId];
    slug = s && existsSync(path.join(process.cwd(), "public", "images", "lag", `${s}.webp`)) ? s : null;
    cache.set(teamId, slug);
  }
  if (!slug) return null;
  return `/images/lag/${slug}${size === "small" ? "-640" : ""}.webp`;
}
