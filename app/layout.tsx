import type { Metadata } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { groups, leagues, tableRows, teams } from "@/lib/db/schema";
import { LOCAL_TEAM_IDS } from "@/lib/local-teams";
import { SiteNav } from "./components/site-nav";
import { SiteFooter } from "./components/site-footer";
import "./globals.css";

// Nav-data (serier + lokala lag). Bäst-effort: om DB ännu inte fyllts på
// första laddningen visas ett tomt nav som fylls vid nästa navigering.
async function getNavData() {
  try {
    const db = await getDb();
    const ls = await db
      .select({ id: leagues.id, name: leagues.name })
      .from(leagues)
      .orderBy(asc(leagues.name));
    const ts = await db
      .select({
        id: teams.id,
        name: teams.name,
        logoUrl: teams.logoUrl,
        leagueId: leagues.id,
      })
      .from(tableRows)
      .innerJoin(teams, eq(tableRows.teamId, teams.id))
      .innerJoin(groups, eq(tableRows.groupId, groups.id))
      .innerJoin(leagues, eq(groups.leagueId, leagues.id))
      .where(inArray(tableRows.teamId, [...LOCAL_TEAM_IDS]))
      .orderBy(asc(leagues.name), asc(tableRows.position));
    return { leagues: ls, teams: ts };
  } catch {
    return { leagues: [], teams: [] };
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Kommunfotbollen | Tabeller & resultat för lokalfotbollen",
  description:
    "Tabeller, spelprogram och resultat för fotbollsserierna i Västervik med omnejd. Automatiskt uppdaterat.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nav = await getNavData();
  return (
    <html
      lang="sv"
      className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-surface text-ink">
        <header className="sticky top-0 z-40 border-b border-line-dark bg-surface-dark text-on-dark">
          <div className="relative mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link
              href="/"
              className="flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-wide text-on-dark"
            >
              <span className="h-3.5 w-3.5 rounded-[3px] bg-accent" aria-hidden />
              Kommunfotbollen
            </Link>
            <SiteNav leagues={nav.leagues} teams={nav.teams} />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
