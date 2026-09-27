import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { groups, leagues, matches, tableRows, teams } from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { getMatches, isResultMissing } from "@/lib/queries";
import { isLocalTeam } from "@/lib/local-teams";
import { MatchList } from "../../components/match-list";
import { SectionHeading } from "../../components/section-heading";
import { TeamCrest } from "../../components/team-crest";

// Datan ändras en gång per dygn (synken kl 22/23) — cacha sidan i stället
// för att fråga databasen vid varje besök.
export const revalidate = 60;

const zoneStyles: Record<string, string> = {
  promotion: "border-l-2 border-emerald-500",
  playoff: "border-l-2 border-emerald-500/40",
  relegation: "border-l-2 border-red-500/70",
};

export default async function SeriePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getDb();

  const league = await db.query.leagues.findFirst({ where: eq(leagues.id, id) });
  if (!league) notFound();

  const leagueGroups = await db
    .select()
    .from(groups)
    .where(eq(groups.leagueId, league.id));
  const groupIds = leagueGroups.map((g) => g.id);

  const table = await db
    .select({
      groupId: tableRows.groupId,
      position: tableRows.position,
      teamId: teams.id,
      teamName: teams.name,
      teamLogo: teams.logoUrl,
      gp: tableRows.gp,
      w: tableRows.w,
      d: tableRows.d,
      l: tableRows.l,
      gf: tableRows.gf,
      ga: tableRows.ga,
      gd: tableRows.gd,
      pts: tableRows.pts,
      positionStatus: tableRows.positionStatus,
    })
    .from(tableRows)
    .innerJoin(teams, eq(tableRows.teamId, teams.id))
    .where(inArray(tableRows.groupId, groupIds))
    .orderBy(asc(tableRows.position));

  const allMatches = await getMatches({
    where: inArray(matches.groupId, groupIds),
    order: "asc",
  });

  const upcoming = allMatches.filter((m) => m.status === "UPCOMING" && !isResultMissing(m));
  const finished = allMatches
    .filter((m) => m.status === "FINISHED" || isResultMissing(m))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  // Widget-datan saknar omgångsnummer, så "senaste omgången" approximeras:
  // alla spelade matcher inom 4 dygn från seriens senast spelade match
  // (en omgång spelas i praktiken över en helg eller ett par vardagar).
  const ROUND_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;
  const latestPlayedAt = finished[0]?.startsAt.getTime() ?? 0;
  const lastRound = finished.filter(
    (m) => m.startsAt.getTime() >= latestPlayedAt - ROUND_WINDOW_MS,
  );
  const earlier = finished.filter(
    (m) => m.startsAt.getTime() < latestPlayedAt - ROUND_WINDOW_MS,
  );

  return (
    <div className="space-y-14">
      <section className="pt-2">
        <Link
          href="/"
          className="group mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-neutral-500 transition-colors hover:text-emerald-400"
        >
          <span className="transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden>
            ←
          </span>
          Alla serier
        </Link>
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          {league.level} · {league.district} · {league.teamClass === "MEN" ? "Herrar" : league.teamClass}
        </p>
        <h1 className="mt-2 text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          {league.name}
        </h1>
      </section>

      <section className="reveal">
        <SectionHeading count={`${table.length} lag`}>Tabell</SectionHeading>
        <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 font-mono text-xs text-neutral-500">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Lag</th>
                <th className="px-2 py-2 text-right">S</th>
                <th className="px-2 py-2 text-right">V</th>
                <th className="px-2 py-2 text-right">O</th>
                <th className="px-2 py-2 text-right">F</th>
                <th className="px-2 py-2 text-right">+/-</th>
                <th className="px-3 py-2 text-right font-semibold text-neutral-300">P</th>
              </tr>
            </thead>
            <tbody>
              {table.map((row) => {
                const local = isLocalTeam(row.teamId);
                return (
                <tr
                  key={row.teamName}
                  className={`border-b border-neutral-800/60 transition-colors last:border-0 hover:bg-neutral-800/30 ${
                    local ? "bg-brand/[0.07]" : ""
                  } ${
                    zoneStyles[row.positionStatus ?? ""] ?? "border-l-2 border-transparent"
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-neutral-500">{row.position}</td>
                  <td
                    className={`px-3 py-2 font-medium ${local ? "font-semibold text-emerald-400" : ""}`}
                  >
                    <span className="flex items-center gap-2.5">
                      <TeamCrest name={row.teamName} logoUrl={row.teamLogo} size={22} />
                      {row.teamName}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right font-mono">{row.gp}</td>
                  <td className="px-2 py-2 text-right font-mono">{row.w}</td>
                  <td className="px-2 py-2 text-right font-mono">{row.d}</td>
                  <td className="px-2 py-2 text-right font-mono">{row.l}</td>
                  <td className="px-2 py-2 text-right font-mono">
                    {row.gd > 0 ? `+${row.gd}` : row.gd}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">{row.pts}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {table.some((r) => r.positionStatus) && (
          <p className="mt-2 font-mono text-xs text-neutral-600">
            <span className="text-emerald-500">▎</span>uppflyttning ·{" "}
            <span className="text-emerald-500/50">▎</span>kval ·{" "}
            <span className="text-red-500/70">▎</span>nedflyttning
          </p>
        )}
      </section>

      <section className="reveal">
        <SectionHeading>Spelprogram</SectionHeading>
        {allMatches.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Inga matcher i databasen ännu. Matchdata samlas in varje kväll vid
            varje synk.
          </p>
        ) : (
          <div className="space-y-6">
            {upcoming.length > 0 && (
              <div>
                <h3 className="mb-2 font-mono text-xs text-neutral-500">
                  Kommande
                </h3>
                <MatchList matches={upcoming} />
              </div>
            )}
            {lastRound.length > 0 && (
              <div>
                <h3 className="mb-2 font-mono text-xs text-neutral-500">
                  Senaste omgången
                </h3>
                <MatchList matches={lastRound} />
              </div>
            )}
            {earlier.length > 0 && (
              <details>
                <summary className="cursor-pointer font-mono text-xs text-neutral-500 hover:text-neutral-300">
                  Tidigare resultat ({earlier.length})
                </summary>
                <div className="mt-4">
                  <MatchList matches={earlier} />
                </div>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
