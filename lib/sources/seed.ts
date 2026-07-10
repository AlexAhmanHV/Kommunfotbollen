import type {
  MatchSource,
  SourceLeague,
  SourceMatch,
  SourceTableRow,
  MatchStatus,
} from "./types";

// SeedSource: deterministisk demodata för en påhittad Div 6-säsong.
// Deterministisk = samma matcher och resultat varje körning, så synken
// kan köras hur ofta som helst utan att datan hoppar runt.

const TEAMS = [
  { sourceRef: "vastervik-united", name: "Västervik United", shortName: "VUN" },
  { sourceRef: "gamleby-bk", name: "Gamleby BK", shortName: "GBK" },
  { sourceRef: "ankarsrums-sk", name: "Ankarsrums SK", shortName: "ASK" },
  { sourceRef: "overums-if", name: "Överums IF", shortName: "ÖIF" },
  { sourceRef: "loftahammar-fk", name: "Loftahammar FK", shortName: "LFK" },
  { sourceRef: "hjorteds-ais", name: "Hjorteds AIS", shortName: "HAIS" },
  { sourceRef: "gunnebo-ff", name: "Gunnebo FF", shortName: "GFF" },
  { sourceRef: "tjust-city", name: "Tjust City FC", shortName: "TCFC" },
  { sourceRef: "blackstad-ik", name: "Blackstad IK", shortName: "BIK" },
  { sourceRef: "totebo-aik", name: "Totebo AIK", shortName: "TAIK" },
];

const GROUP_REF = "div6-norra";
const SEASON_START = Date.UTC(2026, 3, 11, 13, 0); // 11 april 2026, 15:00 svensk tid
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Enkel deterministisk hash → pseudoslump för resultat
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function goals(seedStr: string): number {
  // viktad mot låga siffror: 0–4 mål
  const r = hash(seedStr) % 100;
  if (r < 25) return 0;
  if (r < 55) return 1;
  if (r < 80) return 2;
  if (r < 93) return 3;
  return 4;
}

/** Dubbel round-robin med cirkelmetoden: 10 lag → 18 omgångar, lör 15:00. */
function buildSchedule(): SourceMatch[] {
  const n = TEAMS.length;
  const rounds = n - 1;
  const half = n / 2;
  const rotation = TEAMS.map((t) => t.sourceRef);
  const fixed = rotation[0];
  let rest = rotation.slice(1);

  const out: SourceMatch[] = [];
  const now = Date.now();

  for (let leg = 0; leg < 2; leg++) {
    rest = rotation.slice(1);
    for (let r = 0; r < rounds; r++) {
      const roundNo = leg * rounds + r + 1;
      const startsAtMs = SEASON_START + (roundNo - 1) * WEEK_MS;
      const lineup = [fixed, ...rest];
      for (let i = 0; i < half; i++) {
        let home = lineup[i];
        let away = lineup[n - 1 - i];
        // varannan omgång + andra halvan av säsongen byter hemmaplan
        if ((r + leg) % 2 === 1) [home, away] = [away, home];

        const ref = `r${roundNo}-${home}-${away}`;
        const finished = startsAtMs + 2 * 60 * 60 * 1000 < now;
        const ongoing = !finished && startsAtMs <= now;
        const status: MatchStatus = finished
          ? "FINISHED"
          : ongoing
            ? "ONGOING"
            : "UPCOMING";

        out.push({
          sourceRef: ref,
          groupRef: GROUP_REF,
          round: roundNo,
          startsAt: new Date(startsAtMs).toISOString(),
          status,
          homeTeamRef: home,
          awayTeamRef: away,
          homeScore: finished ? goals(ref + "-h") : null,
          awayScore: finished ? goals(ref + "-a") : null,
        });
      }
      // rotera alla utom första
      rest = [rest[rest.length - 1], ...rest.slice(0, -1)];
    }
  }
  return out;
}

export class SeedSource implements MatchSource {
  readonly name = "seed";

  async getLeague(): Promise<SourceLeague> {
    return {
      sourceRef: "div6-norra-2026",
      name: "Division 6 Norra (demo)",
      level: "Division 6",
      teamClass: "MEN",
      district: "Smålands FF",
      season: { slug: "2026", label: "Säsongen 2026" },
      groups: [{ sourceRef: GROUP_REF, name: "Norra", teams: TEAMS }],
    };
  }

  async getMatches(): Promise<SourceMatch[]> {
    return buildSchedule();
  }

  async getTable(): Promise<SourceTableRow[]> {
    const rows = new Map<string, SourceTableRow>();
    for (const t of TEAMS) {
      rows.set(t.sourceRef, {
        groupRef: GROUP_REF,
        teamRef: t.sourceRef,
        position: 0,
        gp: 0, w: 0, d: 0, l: 0,
        gf: 0, ga: 0, gd: 0, pts: 0,
        positionStatus: null,
      });
    }
    for (const m of buildSchedule()) {
      if (m.status !== "FINISHED" || m.homeScore === null || m.awayScore === null) continue;
      const h = rows.get(m.homeTeamRef)!;
      const a = rows.get(m.awayTeamRef)!;
      h.gp++; a.gp++;
      h.gf += m.homeScore; h.ga += m.awayScore;
      a.gf += m.awayScore; a.ga += m.homeScore;
      if (m.homeScore > m.awayScore) { h.w++; a.l++; h.pts += 3; }
      else if (m.homeScore < m.awayScore) { a.w++; h.l++; a.pts += 3; }
      else { h.d++; a.d++; h.pts++; a.pts++; }
    }
    const sorted = [...rows.values()]
      .map((r) => ({ ...r, gd: r.gf - r.ga }))
      .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf);
    sorted.forEach((r, i) => {
      r.position = i + 1;
      r.positionStatus =
        i === 0 ? "promotion" : i === 1 ? "playoff" : i >= sorted.length - 2 ? "relegation" : null;
    });
    return sorted;
  }
}
