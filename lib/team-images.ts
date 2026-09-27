import { existsSync } from "node:fs";
import path from "node:path";

// Lagbilder. Lägg en liggande bild (minst ~1600×900) som
// public/images/lag/<slug>.jpg så används den automatiskt; saknas den visas
// en grafisk reserv. Kontrollen görs en gång per serverprocess.
export const TEAM_IMAGE_SLUGS: Record<string, string> = {
  "eswidget-9925": "ifk-vastervik",
  "eswidget-10040": "hjorted-totebo",
  "eswidget-51390": "tjust-if-ff",
  "eswidget-9942": "vasterviks-ff",
  "eswidget-23106": "boif",
  "eswidget-10039": "gunnebo-if",
  "eswidget-224214": "fc-orbacken",
  "eswidget-10249": "overums-ik",
  "eswidget-9982": "ankarsrums-is",
  "eswidget-191798": "vasterviks-dam",
};

const cache = new Map<string, string | null>();

export function teamImage(teamId: string): string | null {
  const cached = cache.get(teamId);
  if (cached !== undefined) return cached;
  const slug = TEAM_IMAGE_SLUGS[teamId];
  const url =
    slug && existsSync(path.join(process.cwd(), "public", "images", "lag", `${slug}.jpg`))
      ? `/images/lag/${slug}.jpg`
      : null;
  cache.set(teamId, url);
  return url;
}
