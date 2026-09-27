import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { groups, leagues, matches, tableRows, teams } from "@/lib/db/schema";
import { getMatches, isResultMissing } from "@/lib/queries";
import { CLASS_LABEL } from "@/lib/teams";
import { LeagueTable } from "../../components/league-table";
import { MatchList } from "../../components/match-list";
import { PageContainer } from "../../components/page-container";
import { SectionHeading } from "../../components/section-heading";

// Datan ändras en gång per dygn (synken kl 22/23) — cacha sidan i stället
// för att fråga databasen vid varje besök.
export const revalidate = 60;

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">
      {children}
    </h3>
  );
}

export default async function SeriePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = await getDb();

  const league = await db.query.leagues.findFirst({ where: eq(leagues.id, id) });
  if (!league) notFound();

  const leagueGroups = await db.select().from(groups).where(eq(groups.leagueId, league.id));
  const groupIds = leagueGroups.map((g) => g.id);

  const table = await db
    .select({
      position: tableRows.position,
      teamId: teams.id,
      teamName: teams.name,
      teamLogo: teams.logoUrl,
      gp: tableRows.gp,
      w: tableRows.w,
      d: tableRows.d,
      l: tableRows.l,
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
  const lastRound = finished.filter((m) => m.startsAt.getTime() >= latestPlayedAt - ROUND_WINDOW_MS);
  const earlier = finished.filter((m) => m.startsAt.getTime() < latestPlayedAt - ROUND_WINDOW_MS);

  return (
    <>
      <section className="bg-surface-dark text-on-dark">
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-8">
          <Link
            href="/"
            className="group inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-on-dark-muted transition-colors hover:text-accent"
          >
            <span className="transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden>
              ←
            </span>
            Alla serier
          </Link>
          <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-on-dark-muted">
            {league.level} · {league.district} · {CLASS_LABEL[league.teamClass] ?? league.teamClass}
          </p>
          <h1 className="mt-2 font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl">
            {league.name}
          </h1>
          <div className="mt-8">
            <SectionHeading tone="dark" count={`${table.length} lag`}>
              Tabell
            </SectionHeading>
            <LeagueTable rows={table} />
          </div>
        </div>
      </section>

      <PageContainer className="reveal">
        <SectionHeading>Spelprogram</SectionHeading>
        {allMatches.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Inga matcher i databasen ännu. Matchdata samlas in varje kväll vid varje synk.
          </p>
        ) : (
          <div className="space-y-6">
            {upcoming.length > 0 && (
              <div>
                <SubHeading>Kommande</SubHeading>
                <MatchList matches={upcoming} />
              </div>
            )}
            {lastRound.length > 0 && (
              <div>
                <SubHeading>Senaste omgången</SubHeading>
                <MatchList matches={lastRound} />
              </div>
            )}
            {earlier.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                  Tidigare resultat ({earlier.length})
                </summary>
                <div className="mt-4">
                  <MatchList matches={earlier} />
                </div>
              </details>
            )}
          </div>
        )}
      </PageContainer>
    </>
  );
}
