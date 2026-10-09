import { and, asc, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  articles,
  articleTeams,
  groups,
  leagues,
  matches,
  podcastEpisodes,
  radioEpisodes,
  tableRows,
  teams,
} from "@/lib/db/schema";
import { FEATURED_PRIORITY, LOCAL_TEAM_IDS } from "@/lib/local-teams";
import {
  latestRowPerTeam,
  matchdayMode,
  pickFeatured,
  teamSummaries,
  tickerItems,
  type LocalTeamRow,
  type Standing,
} from "@/lib/matchday";
import { MAX_ARTICLE_AGE_DAYS } from "@/lib/news";
import { getMatches } from "@/lib/queries";
import { MatchdayHero } from "./components/home/matchday-hero";
import { NewsFeed, type NewsArticle } from "./components/home/news-feed";
import type { RadioEpisodeView } from "./components/home/radio-player";
import { RoundStrip } from "./components/home/round-strip";
import { Sidebar, type PodcastGroup } from "./components/home/sidebar";
import { TeamGrid } from "./components/home/team-grid";
import { Ticker } from "./components/home/ticker";
import { SectionHeading } from "./components/section-heading";

// Datan ändras en gång per dygn (synken kl 22/23) — cacha sidan i stället
// för att fråga databasen vid varje besök.
export const revalidate = 60;

const PODCAST_RECENT = 3; // senaste avsnitten per podd, resten bakom "visa äldre"
const PODCASTS = [
  { name: "Nykritat", day: "torsdagar" },
  { name: "Fotbollsviken", day: "fredagar" },
] as const;

// Tiden som matchdagszonen utgår från. MATCHDAY_NOW (ISO-datum) används bara
// lokalt för att framkalla lägena "recent"/"offseason"; sätt den aldrig i Render.
function matchdayNow(): Date {
  const override = process.env.MATCHDAY_NOW;
  return override ? new Date(override) : new Date();
}

function newsCutoff(): Date {
  return new Date(Date.now() - MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000);
}

const radioDateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});

/** "Vecka 41" + "5 okt. – 11 okt." för senaste avsnittet. */
function radioView(row: { id: string; weekStart: Date; script: string; audioUrl: string }): RadioEpisodeView {
  // +6,5 dygn landar säkert på söndagen även veckan sommartiden slutar
  const sunday = new Date(row.weekStart.getTime() + 6.5 * 24 * 60 * 60 * 1000);
  return {
    title: `Vecka ${Number(row.id.slice(6))}`,
    dateLabel: `${radioDateFmt.format(row.weekStart)} – ${radioDateFmt.format(sunday)}`,
    audioUrl: row.audioUrl,
    script: row.script,
  };
}

export default async function Home() {
  const db = await getDb();
  const now = matchdayNow();
  const localIds = [...LOCAL_TEAM_IDS];

  const [allLeagues, localTeamRows, standingRows, localMatches, newsRows, podRows, radioRows] =
    await Promise.all([
      db.select({ id: leagues.id, name: leagues.name }).from(leagues).orderBy(asc(leagues.name)),
      db
        .select({
          teamId: teams.id,
          name: teams.name,
          logoUrl: teams.logoUrl,
          leagueId: leagues.id,
          leagueName: leagues.name,
          position: tableRows.position,
          pts: tableRows.pts,
          computedAt: tableRows.computedAt,
        })
        .from(teams)
        .leftJoin(tableRows, eq(tableRows.teamId, teams.id))
        .leftJoin(groups, eq(tableRows.groupId, groups.id))
        .leftJoin(leagues, eq(groups.leagueId, leagues.id))
        .where(inArray(teams.id, localIds)),
      db
        .select({
          teamId: tableRows.teamId,
          position: tableRows.position,
          pts: tableRows.pts,
          computedAt: tableRows.computedAt,
        })
        .from(tableRows),
      getMatches({
        where: or(inArray(matches.homeTeamId, localIds), inArray(matches.awayTeamId, localIds)),
        order: "asc",
      }),
      db
        .select({
          id: articles.id,
          title: articles.title,
          summary: articles.summary,
          source: articles.source,
          publishedAt: articles.publishedAt,
          teamName: teams.name,
        })
        .from(articles)
        .innerJoin(articleTeams, eq(articleTeams.articleId, articles.id))
        .innerJoin(teams, eq(articleTeams.teamId, teams.id))
        .where(
          and(
            gte(articles.publishedAt, newsCutoff()),
            // dölj AI-avvisade taggar; visa obedömda (null) och godkända (true)
            or(isNull(articleTeams.relevant), eq(articleTeams.relevant, true)),
          ),
        )
        .orderBy(desc(articles.publishedAt)),
      db
        .select({
          id: podcastEpisodes.id,
          podcast: podcastEpisodes.podcast,
          title: podcastEpisodes.title,
          durationSec: podcastEpisodes.durationSec,
          publishedAt: podcastEpisodes.publishedAt,
        })
        .from(podcastEpisodes)
        .orderBy(desc(podcastEpisodes.publishedAt)),
      db
        .select({
          id: radioEpisodes.id,
          weekStart: radioEpisodes.weekStart,
          script: radioEpisodes.script,
          audioUrl: radioEpisodes.audioUrl,
        })
        .from(radioEpisodes)
        .orderBy(desc(radioEpisodes.weekStart))
        .limit(1),
    ]);

  // Matchdagszonen. En tabellrad per lag — annars kan ett lag med en
  // kvarglömd rad från en grupp det lämnat dyka upp dubbelt eller ge en
  // godtycklig placering i standings-kartan.
  const standings = new Map<string, Standing>(
    latestRowPerTeam(standingRows).map((r) => [r.teamId, { position: r.position, pts: r.pts }]),
  );
  const { mode, matches: modeMatches } = matchdayMode(localMatches, LOCAL_TEAM_IDS, now);
  const featured = pickFeatured(modeMatches, FEATURED_PRIORITY, LOCAL_TEAM_IDS);
  const others = modeMatches.filter((m) => m.id !== featured?.id);
  const summaries = teamSummaries(
    latestRowPerTeam(localTeamRows) as LocalTeamRow[],
    localMatches,
    now,
  );
  const ticker = tickerItems(localMatches, LOCAL_TEAM_IDS, now);

  // Nyheter: en rad per artikel med alla taggade lag
  const byArticle = new Map<string, NewsArticle>();
  for (const r of newsRows) {
    const existing = byArticle.get(r.id);
    if (existing) existing.teamNames.push(r.teamName);
    else byArticle.set(r.id, { ...r, teamNames: [r.teamName] });
  }
  const news = [...byArticle.values()]; // redan sorterad nyast först

  const podcasts: PodcastGroup[] = PODCASTS.map((p) => {
    const eps = podRows.filter((e) => e.podcast === p.name);
    return {
      name: p.name,
      day: p.day,
      recent: eps.slice(0, PODCAST_RECENT),
      older: eps.slice(PODCAST_RECENT),
    };
  }).filter((p) => p.recent.length > 0);

  const radio = radioRows[0] ? radioView(radioRows[0]) : null;

  return (
    <>
      <section className="bg-surface-dark text-on-dark">
        <Ticker items={ticker} />
        <MatchdayHero mode={mode} featured={featured} standings={standings} />
        <div className="mx-auto max-w-5xl space-y-10 px-4 pb-10 pt-4">
          <RoundStrip mode={mode} matches={others} />
          <div>
            <SectionHeading tone="dark" count={`${summaries.length} lag`}>
              Lokala lag
            </SectionHeading>
            <TeamGrid teams={summaries} />
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 lg:grid-cols-[2fr_1fr]">
        <NewsFeed articles={news} />
        <Sidebar radio={radio} leagues={allLeagues} podcasts={podcasts} />
      </div>
    </>
  );
}
