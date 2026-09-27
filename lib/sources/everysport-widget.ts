import { z } from "zod";
import type {
  MatchSource,
  SourceLeague,
  SourceMatch,
  SourceTableRow,
} from "./types";

// EverysportWidgetSource: interimskälla tills officiell API-nyckel finns.
// Läser server-renderad __NEXT_DATA__-JSON från Everysports publika
// embed-widget (avsedd att bäddas in på egna sajter) — ingen auth kringgås.
//
// Begränsning: widgeten exponerar bara matcher i ett rullande fönster
// (~1 vecka framåt + senaste resultaten). Tabellen är alltid komplett.
// Den schemalagda synken ackumulerar därför matcher över tid i vår databas;
// full historik backfillas när EverysportSource (riktiga API:et) tar över.

const WIDGET_BASE = "https://www.everysport.com/widget";
// Widgeten är avsedd att bäddas in i webbläsare; en webbläsar-UA ger
// konsekventa renderingar (custom UA:n triggade ibland tom sida).
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// -- Zod-scheman för de delar av widgetens payload vi konsumerar --

const wTeam = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().nullish(),
  logo: z.string().nullish(),
});

const wSeries = z.object({
  id: z.string(),
  name: z.string(),
  class: z.enum(["MEN", "WOMEN", "BOYS", "GIRLS", "MIX"]).catch("MIX"),
  year: z.string(),
  teams: z.array(wTeam),
  division: z.object({ name: z.string() }),
});

const wStandingRow = z.object({
  position: z.number().int(),
  lineThicknessBelow: z.number().nullish(),
  team: wTeam.pick({ id: true, name: true, logo: true }),
  stats: z.array(z.object({ name: z.string(), value: z.string() })),
});

const wSeriesWithStandings = z.object({
  groups: z.array(z.object({ standings: z.array(wStandingRow) })),
});

// `standings` (med teamId) nästlar serien under series[]; `seriesStandings`
// (utan teamId) är serie-objektet direkt. Normalisera till samma form.
const wStandings = z
  .union([
    z.object({ series: z.array(wSeriesWithStandings).min(1) }),
    wSeriesWithStandings,
  ])
  .transform((v) => ("series" in v ? v.series[0] : v));

const wGame = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  status: z.string(),
  startDate: z.string(),
  homeTeam: wTeam.pick({ id: true, name: true }),
  awayTeam: wTeam.pick({ id: true, name: true }),
  score: z
    .object({
      homeTeam: z.number().nullable(),
      awayTeam: z.number().nullable(),
    })
    .nullish(),
  // lagsidor blandar serier (och ev. cuper) — id:t låter oss filtrera
  series: z.object({ id: z.string() }).nullish(),
});

const wGamesResult = z.object({ games: z.array(wGame) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serialisera alla Everysport-anrop (en i taget, med liten paus) — samtidiga
// skurar rate-limitar deras widget så att sidor renderas tomma.
let esQueue: Promise<unknown> = Promise.resolve();
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = esQueue.then(() => sleep(250)).then(fn);
  esQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Everysports widget renderar ibland en tom sida (fälten null) vid transient
// last/rate-limit. `isValid` låter anroparen kräva att rätt fält finns; annars
// försöker vi igen med backoff innan vi ger upp.
async function fetchNextData(
  url: string,
  isValid?: (pp: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  let lastPp: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    const res = await throttle(() =>
      fetch(url, { headers: { "User-Agent": USER_AGENT }, cache: "no-store" }),
    );
    if (!res.ok) continue;
    const html = await res.text();
    const m = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/,
    );
    if (!m) continue;
    lastPp = JSON.parse(m[1]).props.pageProps;
    if (!isValid || isValid(lastPp)) return lastPp;
  }
  return lastPp; // sista försöket — Zod ger ett tydligt fel om det ändå är tomt
}

// pageProps.standings kan vara objekt eller array med ett element
function first<T>(v: T | T[]): T {
  return Array.isArray(v) ? v[0] : v;
}

function mapStatus(s: string): SourceMatch["status"] {
  const known = [
    "UPCOMING",
    "ONGOING",
    "FINISHED",
    "POSTPONED",
    "CANCELED",
    "INTERRUPTED",
  ] as const;
  return (known as readonly string[]).includes(s)
    ? (s as SourceMatch["status"])
    : "UPCOMING";
}

export class EverysportWidgetSource implements MatchSource {
  readonly name = "eswidget";

  // Lagsidor (everysport.com/sport/fotboll/team/x/{id}) SSR:ar ett större
  // fönster än serie-widgeten: ~3 veckor framåt + ~3 veckor bakåt. Genom att
  // skörda de bevakade lagens sidor fångar vi "nästa match" tidigare.
  // Sluggen i URL:en ignoreras av deras router — id:t räcker.
  constructor(
    private readonly teamRefsByLeague: Record<string, string[]> = {},
  ) {}

  // getLeague och getTable läser samma standings-sida. Den hämtas en gång och
  // delas under en kort stund, så en synk inte hämtar den två gånger.
  private readonly standingsCache = new Map<string, { at: number; pp: Promise<Record<string, unknown>> }>();

  private fetchStandings(leagueRef: string) {
    const hit = this.standingsCache.get(leagueRef);
    if (hit && Date.now() - hit.at < 60_000) return hit.pp;
    const pp = fetchNextData(
      this.standingsUrl(leagueRef),
      (p) => p.series != null && (p.standings != null || p.seriesStandings != null),
    );
    pp.catch(() => this.standingsCache.delete(leagueRef));
    this.standingsCache.set(leagueRef, { at: Date.now(), pp });
    return pp;
  }

  private standingsUrl(leagueRef: string) {
    return `${WIDGET_BASE}?seriesId=${leagueRef}&type=standings`;
  }
  private gamesUrl(leagueRef: string) {
    return `${WIDGET_BASE}?seriesId=${leagueRef}&type=games`;
  }
  private teamUrl(teamRef: string) {
    return `https://www.everysport.com/sport/fotboll/team/x/${teamRef}`;
  }

  async getLeague(leagueRef: string): Promise<SourceLeague> {
    const pp = await this.fetchStandings(leagueRef);
    const series = wSeries.parse(pp.series);

    // Lag-emblemen ligger på standings-raderna (team.logo), inte på
    // series.teams. Samma payload innehåller båda, så vi bygger en id→logo-map.
    const logoByTeam = new Map<string, string>();
    try {
      const standings = wStandings.parse(first(pp.standings ?? pp.seriesStandings));
      for (const g of standings.groups) {
        for (const r of g.standings) {
          if (r.team.logo) logoByTeam.set(r.team.id, r.team.logo);
        }
      }
    } catch {
      /* ingen standings i payloaden — lagen får monogram-fallback i UI:t */
    }

    return {
      sourceRef: series.id,
      name: `${series.division.name} ${series.name}`,
      level: series.division.name,
      teamClass: series.class,
      district: series.name,
      season: { slug: series.year, label: `Säsongen ${series.year}` },
      groups: [
        {
          sourceRef: series.id,
          name: series.name,
          teams: series.teams.map((t) => ({
            sourceRef: t.id,
            name: t.name,
            shortName: t.shortName ?? undefined,
            logoUrl: logoByTeam.get(t.id) ?? t.logo ?? undefined,
          })),
        },
      ],
    };
  }

  async getMatches(leagueRef: string): Promise<SourceMatch[]> {
    // sekventiellt (via throttle-kön) — inga samtidiga skurar mot Everysport
    const pages = [await fetchNextData(this.gamesUrl(leagueRef))];
    for (const t of this.teamRefsByLeague[leagueRef] ?? []) {
      pages.push(await fetchNextData(this.teamUrl(t)));
    }

    // slå ihop serie-widgetens och lagsidornas fönster, dedupe på match-id
    const byId = new Map<string, z.infer<typeof wGame>>();
    for (const pp of pages) {
      const upcoming = wGamesResult.parse(pp.games ?? { games: [] });
      const finished = wGamesResult.parse(pp.gamesResult ?? { games: [] });
      for (const g of [...upcoming.games, ...finished.games]) {
        // lagsidor visar även andra serier/cuper — behåll bara denna serie
        if (g.series && g.series.id !== leagueRef) continue;
        byId.set(g.id, g);
      }
    }

    return [...byId.values()].map((g) => ({
      sourceRef: g.id,
      groupRef: leagueRef,
      startsAt: new Date(g.startDate).toISOString(),
      status: mapStatus(g.status),
      homeTeamRef: g.homeTeam.id,
      awayTeamRef: g.awayTeam.id,
      homeScore: g.score?.homeTeam ?? null,
      awayScore: g.score?.awayTeam ?? null,
    }));
  }

  async getTable(leagueRef: string): Promise<SourceTableRow[]> {
    const pp = await this.fetchStandings(leagueRef);
    // utan teamId-param SSR:ar widgeten tabellen som `seriesStandings`
    const standings = wStandings.parse(first(pp.standings ?? pp.seriesStandings));
    const rows = standings.groups.flatMap((g) => g.standings);

    return rows.map((r) => {
      const stat = (name: string) => {
        const v = r.stats.find((s) => s.name === name)?.value;
        return v !== undefined ? parseInt(v, 10) : 0;
      };
      return {
        groupRef: leagueRef,
        teamRef: r.team.id,
        position: r.position,
        gp: stat("gp"),
        w: stat("w"),
        d: stat("d"),
        l: stat("l"),
        gf: stat("gf"),
        ga: stat("ga"),
        gd: stat("gd"),
        pts: stat("pts"),
        // Widgeten exponerar bara kosmetiska zonstreck (lineThicknessBelow),
        // inte zonernas betydelse — semantiken skiljer per division, så vi
        // gissar inte. Riktiga positionStatuses kommer med officiella API:et.
        positionStatus: null,
      };
    });
  }
}
