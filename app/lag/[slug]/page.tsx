import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gte, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { articles, articleTeams, groups, leagues, matches, tableRows, teams } from "@/lib/db/schema";
import { isResultMissing, latestRowPerTeam, teamSummaries } from "@/lib/matchday";
import { MAX_ARTICLE_AGE_DAYS } from "@/lib/news";
import { getMatches } from "@/lib/queries";
import { tableExcerpt, teamIdBySlug } from "@/lib/teams";
import { MatchList } from "../../components/match-list";
import { NewsCard, type NewsArticle } from "../../components/news-card";
import { SectionHeading } from "../../components/section-heading";
import { NextMatchBox } from "../../components/team/next-match";
import { TableExcerptBox } from "../../components/team/table-excerpt";
import { TeamHero } from "../../components/team/team-hero";

export const revalidate = 60;

const NEWS_SHOWN = 6;
const PLAYED_SHOWN = 10;

function currentTime(): Date {
  return new Date();
}

function newsCutoff(): Date {
  return new Date(Date.now() - MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const teamId = teamIdBySlug(slug);
  if (!teamId) return {};
  const db = await getDb();
  const [row] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId));
  return row
    ? {
        title: `${row.name} | Kommunfotbollen`,
        description: `Matcher, tabelläge och nyheter om ${row.name}.`,
      }
    : {};
}

export default async function LagPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const teamId = teamIdBySlug(slug);
  if (!teamId) notFound();

  const db = await getDb();
  const now = currentTime();

  const [teamRows, teamMatches, newsRows] = await Promise.all([
    db
      .select({
        teamId: teams.id,
        name: teams.name,
        logoUrl: teams.logoUrl,
        leagueId: leagues.id,
        leagueName: leagues.name,
        teamClass: leagues.teamClass,
        groupId: tableRows.groupId,
        position: tableRows.position,
        pts: tableRows.pts,
        computedAt: tableRows.computedAt,
      })
      .from(teams)
      .leftJoin(tableRows, eq(tableRows.teamId, teams.id))
      .leftJoin(groups, eq(tableRows.groupId, groups.id))
      .leftJoin(leagues, eq(groups.leagueId, leagues.id))
      .where(eq(teams.id, teamId)),
    getMatches({
      where: or(eq(matches.homeTeamId, teamId), eq(matches.awayTeamId, teamId)),
      order: "asc",
    }),
    db
      .select({
        id: articles.id,
        title: articles.title,
        summary: articles.summary,
        source: articles.source,
        publishedAt: articles.publishedAt,
      })
      .from(articles)
      .innerJoin(articleTeams, eq(articleTeams.articleId, articles.id))
      .where(
        and(
          eq(articleTeams.teamId, teamId),
          gte(articles.publishedAt, newsCutoff()),
          // dölj AI-avvisade taggar; visa obedömda (null) och godkända (true)
          or(isNull(articleTeams.relevant), eq(articleTeams.relevant, true)),
        ),
      )
      .orderBy(desc(articles.publishedAt))
      .limit(NEWS_SHOWN),
  ]);

  const [team] = latestRowPerTeam(teamRows);
  if (!team) notFound();

  const groupTable = team.groupId
    ? await db
        .select({
          teamId: tableRows.teamId,
          teamName: teams.name,
          position: tableRows.position,
          pts: tableRows.pts,
        })
        .from(tableRows)
        .innerJoin(teams, eq(tableRows.teamId, teams.id))
        .where(eq(tableRows.groupId, team.groupId))
        .orderBy(asc(tableRows.position))
    : [];

  const [summary] = teamSummaries([team], teamMatches, now);
  const upcoming = teamMatches.filter((m) => m.status === "UPCOMING" && !isResultMissing(m, now));
  const played = teamMatches
    .filter((m) => m.status === "FINISHED" || isResultMissing(m, now))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const news: NewsArticle[] = newsRows.map((r) => ({ ...r, teamNames: [team.name] }));

  return (
    <>
      <section className="bg-surface-dark text-on-dark">
        <TeamHero team={summary} teamClass={team.teamClass} />
        <div className="mx-auto grid max-w-5xl gap-3 px-4 pb-10 md:grid-cols-[1.3fr_1fr]">
          <NextMatchBox next={summary.next} leagueName={team.leagueName} />
          <TableExcerptBox rows={tableExcerpt(groupTable, teamId)} teamId={teamId} leagueId={team.leagueId} />
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 lg:grid-cols-[2fr_1fr]">
        <section className="reveal space-y-6">
          <SectionHeading>Matcher</SectionHeading>
          {upcoming.length + played.length === 0 && (
            <p className="text-sm text-ink-muted">Inga matcher inlästa ännu.</p>
          )}
          {upcoming.length > 0 && (
            <div>
              <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">
                Kommande
              </h3>
              <MatchList matches={upcoming} />
            </div>
          )}
          {played.length > 0 && (
            <div>
              <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">
                Spelade
              </h3>
              <MatchList matches={played.slice(0, PLAYED_SHOWN)} />
              {played.length > PLAYED_SHOWN && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                    Visa fler matcher ({played.length - PLAYED_SHOWN})
                  </summary>
                  <div className="mt-3">
                    <MatchList matches={played.slice(PLAYED_SHOWN)} />
                  </div>
                </details>
              )}
            </div>
          )}
        </section>

        <aside className="reveal">
          <SectionHeading>Nyheter</SectionHeading>
          {news.length === 0 ? (
            <p className="text-sm text-ink-muted">Inga nyheter om laget just nu.</p>
          ) : (
            <div className="space-y-3">
              {news.map((a) => (
                <NewsCard key={a.id} a={a} />
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
