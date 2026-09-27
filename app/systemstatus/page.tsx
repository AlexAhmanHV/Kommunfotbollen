import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { articles, dvReports, matches, matchGoals, podcastEpisodes, tableRows, teams, leagues } from "@/lib/db/schema";
import { SectionHeading } from "../components/section-heading";
import { PageContainer } from "../components/page-container";
import { PageHeader } from "../components/page-header";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Systemstatus | Kommunfotbollen",
  description: "Live insyn i synkjobben som håller Kommunfotbollen uppdaterat: senast körda, hur ofta, och hur mycket data som samlats in.",
};

function relativeTime(date: Date | null): string {
  if (!date) return "aldrig";
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just nu";
  if (min < 60) return `${min} min sedan`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} tim sedan`;
  const days = Math.floor(hours / 24);
  return `${days} dygn sedan`;
}

// sql<>-uttryck returnerar rådata (sträng), inte ett äkta Date-objekt
// som för vanliga kolumn-select — normalisera explicit.
async function getMax(query: Promise<{ m: unknown }[]>): Promise<Date | null> {
  const rows = await query;
  const raw = rows[0]?.m;
  if (!raw) return null;
  const d = new Date(raw as string);
  return isNaN(d.getTime()) ? null : d;
}

/** Kördes jobbet inom den senaste halvtimmen? */
function isFresh(lastRun: Date | null): boolean {
  return lastRun != null && Date.now() - lastRun.getTime() < 30 * 60_000;
}

function JobCard({
  title,
  cadence,
  lastRun,
}: {
  title: string;
  cadence: string;
  lastRun: Date | null;
}) {
  const fresh = isFresh(lastRun);
  return (
    <div className="rounded-xl border border-line bg-surface-raised p-4">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${fresh ? "bg-accent" : "bg-ink-muted"}`}
          aria-hidden
        />
        <span className="font-semibold">{title}</span>
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums text-ink">
        {relativeTime(lastRun)}
      </p>
      <p className="mt-1 text-xs text-ink-muted">{cadence}</p>
    </div>
  );
}

function FlowStep({
  label,
  detail,
  accent,
}: {
  label: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex-1 rounded-xl border p-3 ${
        accent ? "border-accent bg-accent" : "border-line bg-surface-raised"
      }`}
    >
      <div
        className={`font-display text-sm font-bold uppercase tracking-wide ${accent ? "text-surface-dark" : "text-ink-muted"}`}
      >
        {label}
      </div>
      <p className={`mt-1 text-xs leading-relaxed ${accent ? "text-surface-dark" : "text-ink-muted"}`}>{detail}</p>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex shrink-0 items-center justify-center py-1 text-ink-muted sm:rotate-0" aria-hidden>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="rotate-90 sm:rotate-0">
        <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function StatTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-raised p-4 text-center">
      <div className="text-2xl font-semibold tabular-nums text-ink">
        {value.toLocaleString("sv-SE")}
      </div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
    </div>
  );
}

export default async function SystemStatus() {
  const db = await getDb();

  const [
    lastMatchSync,
    lastTableSync,
    lastGoalsCheck,
    lastNewsFetch,
    lastPodcastFetch,
    matchCount,
    leagueCount,
    teamCount,
    articleCount,
    podcastCount,
    goalCount,
  ] = await Promise.all([
    getMax(db.select({ m: sql<Date | null>`max(${matches.updatedAt})` }).from(matches)),
    getMax(db.select({ m: sql<Date | null>`max(${tableRows.computedAt})` }).from(tableRows)),
    getMax(db.select({ m: sql<Date | null>`max(${dvReports.checkedAt})` }).from(dvReports)),
    getMax(db.select({ m: sql<Date | null>`max(${articles.fetchedAt})` }).from(articles)),
    getMax(db.select({ m: sql<Date | null>`max(${podcastEpisodes.fetchedAt})` }).from(podcastEpisodes)),
    db.select({ n: sql<number>`count(*)` }).from(matches).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(leagues).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(teams).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(articles).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(podcastEpisodes).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: sql<number>`count(*)` }).from(matchGoals).then((r) => Number(r[0]?.n ?? 0)),
  ]);

  return (
    <>
      <PageHeader kicker="Live från servern" title="Systemstatus">
        Kommunfotbollen är byggt för att sköta sig själv. Här är samma data
        synken själv skriver till, hämtad direkt när sidan laddas, inte
        hårdkodad text.
      </PageHeader>
      <PageContainer className="space-y-14">
        <section>
          <SectionHeading>Senast körda jobb</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <JobCard title="Matcher & tabeller" cadence="Dagligen, 23:00" lastRun={lastMatchSync ?? lastTableSync} />
            <JobCard title="Målskyttar" cadence="Dagligen, 23:00" lastRun={lastGoalsCheck} />
            <JobCard title="Nyheter" cadence="Dagligen, 22:00" lastRun={lastNewsFetch} />
            <JobCard title="Poddavsnitt" cadence="Dagligen, 22:00" lastRun={lastPodcastFetch} />
          </div>
        </section>

        <section>
          <SectionHeading>Insamlad data</SectionHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile value={leagueCount} label="serier" />
            <StatTile value={teamCount} label="lag" />
            <StatTile value={matchCount} label="matcher" />
            <StatTile value={goalCount} label="registrerade mål" />
            <StatTile value={articleCount} label="artiklar" />
            <StatTile value={podcastCount} label="poddavsnitt" />
          </div>
        </section>

        <section>
          <SectionHeading>Hur det är byggt</SectionHeading>
          <p className="mb-4 max-w-xl text-sm text-ink-muted">
            Inget redigeras för hand. Fyra jobb hämtar, tolkar och sparar data
            löpande — det här är vägen en artikel eller ett mål tar från källa
            till sidan du läser just nu.
          </p>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <FlowStep
              label="Källor"
              detail="Everysport, DV, Vimmerby T, VT, poddar"
            />
            <FlowArrow />
            <FlowStep label="AI-extraktion" detail="Claude läser matchreferat och bedömer relevans" accent />
            <FlowArrow />
            <FlowStep label="Databas" detail="Supabase Postgres + Drizzle" />
            <FlowArrow />
            <FlowStep label="Sidan" detail="Next.js Server Components, ingen cache-fördröjning" />
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            Byggt med Next.js 16 · Supabase Postgres · Drizzle · Zod · Tailwind v4 · Claude API
          </p>
          <p className="mt-3 text-xs text-ink-muted">
            <a
              href="https://github.com/AlexAhmanHV/Kommunfotbollen"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-ink hover:underline"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              Källkod på GitHub
            </a>
          </p>
        </section>

        <section>
          <SectionHeading>Källor</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-raised p-4">
              <div className="font-semibold text-ink">Everysport</div>
              <p className="mt-1 text-sm text-ink-muted">
                Tabeller, matcher och resultat för fyra serier.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface-raised p-4">
              <div className="font-semibold text-ink">
                Dagens Västervik &amp; Vimmerby Tidning
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                Alla fotbollsartiklar läses (Vimmerby T via sitemap, DV via
                fotbollssidan) och ger underlag för målskytte-extraktion.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface-raised p-4">
              <div className="font-semibold text-ink">
                Västerviks-Tidningen
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                Artiklar hittas via sitemap. Brödtexten ligger bakom betalvägg,
                så målskyttar läses bara ur rubrik och ingress.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface-raised p-4">
              <div className="font-semibold text-ink">Nykritat &amp; Fotbollsviken</div>
              <p className="mt-1 text-sm text-ink-muted">
                De två poddar som bevakar kommunfotbollen.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface-raised p-4 sm:col-span-2">
              <div className="font-semibold text-ink">Claude (Anthropic)</div>
              <p className="mt-1 text-sm text-ink-muted">
                Bedömer artiklars relevans och läser ut målskyttar ur
                matchreferat, med strikta regler mot att gissa.
              </p>
            </div>
          </div>
        </section>

        <section>
          <p className="text-xs text-ink-muted">
            <Link href="/sa-funkar-det" className="hover:text-ink hover:underline">
              Läs mer om hur det funkar
            </Link>{" "}
            ·{" "}
            <Link href="/" className="hover:text-ink hover:underline">
              ← Tillbaka till startsidan
            </Link>
          </p>
        </section>
      </PageContainer>
    </>
  );
}
