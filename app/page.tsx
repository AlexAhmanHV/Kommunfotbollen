import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { ensureSynced } from "@/lib/sync";
import {
  articles,
  articleTeams,
  groups,
  leagues,
  matches,
  podcastEpisodes,
  tableRows,
  teams,
} from "@/lib/db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { MAX_ARTICLE_AGE_DAYS } from "@/lib/news";

const NEWS_RECENT_DAYS = 7;
const NEWS_MIN_SHOWN = 12;
const PODCAST_RECENT = 3; // senaste avsnitten per podd, resten bakom "visa mer"

// De två poddarna i fast ordning (Nykritat tors, Fotbollsviken fre)
const PODCAST_NAMES = ["Nykritat", "Fotbollsviken"] as const;

type PodEpisode = {
  id: string;
  podcast: string;
  title: string;
  durationSec: number | null;
  publishedAt: Date;
};

function formatDuration(sec: number | null): string | null {
  if (!sec) return null;
  const min = Math.round(sec / 60);
  return `${min} min`;
}

type FormResult = "W" | "D" | "L";

// Senaste matcherna som bokstäver (V/O/F), äldst till vänster, senast till höger.
function FormLetters({ results }: { results: FormResult[] }) {
  if (results.length === 0) return null;
  const letter = { W: "V", D: "O", L: "F" };
  const label = { W: "Vinst", D: "Oavgjort", L: "Förlust" };
  return (
    <div
      className="mt-2 flex items-center gap-1.5 font-mono text-xs"
      aria-label={`Form, senaste matcherna: ${results.map((r) => label[r]).join(", ")}`}
    >
      <span className="text-neutral-500">Form:</span>
      {results.map((r, i) => (
        <span
          key={i}
          title={label[r]}
          className={`font-semibold ${
            r === "W" ? "text-emerald-400" : r === "D" ? "text-neutral-500" : "text-rose-400"
          }`}
        >
          {letter[r]}
        </span>
      ))}
    </div>
  );
}

function PodcastItem({ e, fmt }: { e: PodEpisode; fmt: Intl.DateTimeFormat }) {
  const dur = formatDuration(e.durationSec);
  return (
    <li>
      <a
        href={e.id}
        target="_blank"
        rel="noopener noreferrer"
        className="group block px-4 py-3 transition-colors hover:bg-neutral-800/40"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold group-hover:text-emerald-400">
            {e.title}
          </span>
          <span className="shrink-0 font-mono text-xs text-neutral-500">
            {fmt.format(e.publishedAt)}
          </span>
        </div>
        {dur && (
          <div className="mt-1 font-mono text-xs text-neutral-500">{dur}</div>
        )}
      </a>
    </li>
  );
}

type NewsArticle = {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  publishedAt: Date;
  teamNames: string[];
};

function NewsItem({ a, fmt }: { a: NewsArticle; fmt: Intl.DateTimeFormat }) {
  return (
    <li>
      <a
        href={a.id}
        target="_blank"
        rel="noopener noreferrer"
        className="group block px-4 py-3 transition-colors hover:bg-neutral-800/40"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold group-hover:text-emerald-400">
            {a.title}
          </span>
          <span className="shrink-0 font-mono text-xs text-neutral-500">
            {fmt.format(a.publishedAt)}
          </span>
        </div>
        {a.summary && (
          <p className="mt-1 line-clamp-2 text-sm text-neutral-400">
            {a.summary}
          </p>
        )}
        <div className="mt-1 font-mono text-xs text-neutral-500">
          {a.source}
          {a.teamNames.length > 0 && (
            <span className="text-emerald-500/70"> · {a.teamNames.join(" · ")}</span>
          )}
        </div>
      </a>
    </li>
  );
}
import { getMatches } from "@/lib/queries";
import { LOCAL_TEAM_IDS } from "@/lib/local-teams";
import { MatchList } from "./components/match-list";
import { SectionHeading } from "./components/section-heading";
import { TeamCrest } from "./components/team-crest";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureSynced();
  const db = await getDb();

  const allLeagues = await db.select().from(leagues).orderBy(asc(leagues.name));

  // De lokala lagens aktuella tabelläge, sorterat serie → position
  const localTeams = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      teamLogo: teams.logoUrl,
      leagueId: leagues.id,
      leagueName: leagues.name,
      level: leagues.level,
      position: tableRows.position,
      gp: tableRows.gp,
      pts: tableRows.pts,
    })
    .from(tableRows)
    .innerJoin(teams, eq(tableRows.teamId, teams.id))
    .innerJoin(groups, eq(tableRows.groupId, groups.id))
    .innerJoin(leagues, eq(groups.leagueId, leagues.id))
    .where(inArray(tableRows.teamId, [...LOCAL_TEAM_IDS]))
    .orderBy(asc(leagues.name), asc(tableRows.position));

  // nästa match per lokalt lag (om någon finns i insamlingsfönstret)
  const localIds = [...LOCAL_TEAM_IDS];
  const upcomingLocal = await getMatches({
    where: and(
      eq(matches.status, "UPCOMING"),
      or(
        inArray(matches.homeTeamId, localIds),
        inArray(matches.awayTeamId, localIds),
      ),
    ),
    order: "asc",
  });
  const nextMatch = new Map<string, (typeof upcomingLocal)[number]>();
  for (const m of upcomingLocal) {
    for (const id of [m.homeId, m.awayId]) {
      if (LOCAL_TEAM_IDS.has(id) && !nextMatch.has(id)) nextMatch.set(id, m);
    }
  }
  const nextFmt = new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Stockholm",
  });

  // senaste nyhetsartiklarna med taggade lag
  const newsRows = await db
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
        gte(
          articles.publishedAt,
          new Date(Date.now() - MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000),
        ),
        // dölj AI-avvisade taggar; visa obedömda (null) och godkända (true)
        or(isNull(articleTeams.relevant), eq(articleTeams.relevant, true)),
      ),
    )
    .orderBy(desc(articles.publishedAt));
  const news = new Map<
    string,
    Omit<(typeof newsRows)[number], "teamName"> & { teamNames: string[] }
  >();
  for (const r of newsRows) {
    const existing = news.get(r.id);
    if (existing) existing.teamNames.push(r.teamName);
    else news.set(r.id, { ...r, teamNames: [r.teamName] });
  }
  // Senaste veckan visas direkt, äldre (upp till 60 dygn) bakom "visa mer".
  // Under säsongsuppehåll är veckan nästan tom, så vi visar alltid minst
  // NEWS_MIN_SHOWN artiklar oavsett ålder — annars ser sidan tom ut fast vi
  // har massor av bevakning i det äldre skiktet.
  const recentCutoff = Date.now() - NEWS_RECENT_DAYS * 24 * 60 * 60 * 1000;
  const allNews = [...news.values()]; // redan sorterad nyast först
  const withinWeek = allNews.filter((a) => a.publishedAt.getTime() >= recentCutoff).length;
  const shownCount = Math.min(allNews.length, Math.max(withinWeek, NEWS_MIN_SHOWN));
  const recentNews = allNews.slice(0, shownCount);
  const olderNews = allNews.slice(shownCount);

  // Poddavsnitt, grupperade per podd (3 senaste + resten bakom "visa mer")
  const podRows = await db
    .select({
      id: podcastEpisodes.id,
      podcast: podcastEpisodes.podcast,
      title: podcastEpisodes.title,
      durationSec: podcastEpisodes.durationSec,
      publishedAt: podcastEpisodes.publishedAt,
    })
    .from(podcastEpisodes)
    .orderBy(desc(podcastEpisodes.publishedAt));
  const podcasts = PODCAST_NAMES.map((name) => {
    const eps = podRows.filter((e) => e.podcast === name);
    return { name, recent: eps.slice(0, PODCAST_RECENT), older: eps.slice(PODCAST_RECENT) };
  }).filter((p) => p.recent.length > 0);
  // senaste spelade matchen för varje lokalt lag (dedupe: lokalderbyn = en rad)
  const finishedLocal = await getMatches({
    where: and(
      eq(matches.status, "FINISHED"),
      or(
        inArray(matches.homeTeamId, [...LOCAL_TEAM_IDS]),
        inArray(matches.awayTeamId, [...LOCAL_TEAM_IDS]),
      ),
    ),
    order: "desc",
  });
  const latestSeen = new Set<string>();
  const latest: typeof finishedLocal = [];
  for (const m of finishedLocal) {
    const localIn = [m.homeId, m.awayId].filter((id) => LOCAL_TEAM_IDS.has(id));
    if (localIn.some((id) => !latestSeen.has(id))) latest.push(m);
    for (const id of localIn) latestSeen.add(id);
  }

  // Form: senaste 5 resultaten per lokalt lag, äldst→senast (finishedLocal är redan senast→äldst).
  const FORM_LENGTH = 5;
  const formByTeam = new Map<string, FormResult[]>();
  for (const m of finishedLocal) {
    for (const id of [m.homeId, m.awayId]) {
      if (!LOCAL_TEAM_IDS.has(id)) continue;
      const arr = formByTeam.get(id) ?? [];
      if (arr.length >= FORM_LENGTH) continue;
      const isHome = m.homeId === id;
      const gf = isHome ? m.homeScore! : m.awayScore!;
      const ga = isHome ? m.awayScore! : m.homeScore!;
      arr.push(gf > ga ? "W" : gf < ga ? "L" : "D");
      formByTeam.set(id, arr);
    }
  }
  for (const arr of formByTeam.values()) arr.reverse();

  return (
    <div className="space-y-14">
      <section className="pt-2">
        <h1 className="max-w-3xl text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
          Lokalfotbollen. Samlad och alltid uppdaterad.
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-neutral-400">
          Tabeller, spelprogram och resultat för kommunens serier. Hämtas och
          uppdateras automatiskt.
        </p>
      </section>

      <section className="reveal">
        <SectionHeading count={`${localTeams.length} lag`}>Lokala lag</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {localTeams.map((t) => (
            <Link
              key={t.teamId}
              href={`/serie/${t.leagueId}`}
              className="group rounded-xl border border-brand/30 bg-brand/[0.06] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-brand/60 hover:bg-brand/[0.11] hover:shadow-lg hover:shadow-brand/20 active:translate-y-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <TeamCrest name={t.teamName} logoUrl={t.teamLogo} size={30} />
                  <span className="truncate font-semibold group-hover:text-emerald-400">
                    {t.teamName}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-lg font-medium tabular-nums text-emerald-400/90">
                  {t.position}
                  <span className="text-sm text-neutral-500">:a</span>
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-xs text-neutral-500">
                  {t.leagueName}
                </span>
                <span className="shrink-0 font-mono text-xs text-neutral-500">
                  {t.pts} p / {t.gp} m
                </span>
              </div>
              <FormLetters results={formByTeam.get(t.teamId) ?? []} />
              {(() => {
                const nm = nextMatch.get(t.teamId);
                if (!nm) return null;
                const home = nm.homeId === t.teamId;
                return (
                  <div className="mt-2 truncate font-mono text-xs text-emerald-500/80">
                    nästa: {nextFmt.format(nm.startsAt)}{" "}
                    {home ? "hemma mot" : "borta mot"}{" "}
                    {home ? nm.awayName : nm.homeName}
                  </div>
                );
              })()}
            </Link>
          ))}
        </div>
      </section>

      <section className="reveal">
        <SectionHeading>Serier</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          {allLeagues.map((l) => (
            <Link
              key={l.id}
              href={`/serie/${l.id}`}
              className="group flex items-center justify-between gap-3 rounded-lg border border-neutral-800/70 p-4 transition duration-200 hover:border-emerald-500/40 hover:bg-neutral-900"
            >
              <div>
                <div className="font-semibold group-hover:text-emerald-400">
                  {l.name}
                </div>
                <div className="mt-1 font-mono text-xs text-neutral-500">
                  {l.level} · {l.district}
                </div>
              </div>
              <span
                className="font-mono text-neutral-700 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-500/70"
                aria-hidden
              >
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {allNews.length > 0 && (
        <section id="nyheter" className="reveal scroll-mt-24">
          <SectionHeading count={`${allNews.length} artiklar`}>
            Nyheter om lagen
          </SectionHeading>
          <ul className="divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
            {recentNews.map((a) => (
              <NewsItem key={a.id} a={a} fmt={nextFmt} />
            ))}
          </ul>
          {olderNews.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer font-mono text-xs text-neutral-500 hover:text-neutral-300">
                Visa äldre nyheter ({olderNews.length})
              </summary>
              <ul className="mt-3 divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                {olderNews.map((a) => (
                  <NewsItem key={a.id} a={a} fmt={nextFmt} />
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {podcasts.length > 0 && (
        <section className="reveal">
          <SectionHeading>Poddar om kommunfotbollen</SectionHeading>
          <div className="grid gap-8 sm:grid-cols-2">
            {podcasts.map((p) => (
              <div key={p.name}>
                <h3 className="mb-2 flex items-baseline gap-2 font-semibold text-emerald-400">
                  {p.name}
                  <span className="font-mono text-xs font-normal text-neutral-600">
                    {p.name === "Nykritat" ? "torsdagar" : "fredagar"}
                  </span>
                </h3>
                <ul className="divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                  {p.recent.map((e) => (
                    <PodcastItem key={e.id} e={e} fmt={nextFmt} />
                  ))}
                </ul>
                {p.older.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer font-mono text-xs text-neutral-500 hover:text-neutral-300">
                      Visa äldre avsnitt ({p.older.length})
                    </summary>
                    <ul className="mt-3 divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                      {p.older.map((e) => (
                        <PodcastItem key={e.id} e={e} fmt={nextFmt} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="reveal grid gap-8 sm:grid-cols-2">
        <section>
          <SectionHeading>Lokala lagens senaste matcher</SectionHeading>
          <MatchList matches={latest} />
        </section>
        <section id="kommande" className="scroll-mt-24">
          <SectionHeading>Kommande matcher</SectionHeading>
          <MatchList matches={upcomingLocal.slice(0, 9)} />
        </section>
      </div>
    </div>
  );
}
