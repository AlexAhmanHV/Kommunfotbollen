import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { groups, leagues, tableRows, teams } from "@/lib/db/schema";
import { LOCAL_TEAM_IDS } from "@/lib/local-teams";
import { SiteNav } from "./components/site-nav";
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <header className="sticky top-0 z-40 border-b border-neutral-800/80 bg-neutral-950/80 backdrop-blur">
          <div className="relative mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
            <Link
              href="/"
              className="group flex items-center gap-2 font-semibold tracking-tight transition-colors hover:text-brand"
            >
              <Image
                src="/logo.svg"
                alt=""
                width={26}
                height={26}
                className="transition-transform duration-200 group-hover:-rotate-6"
              />
              Kommunfotbollen
            </Link>
            <SiteNav leagues={nav.leagues} teams={nav.teams} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-neutral-800 py-8">
          <div className="mx-auto flex max-w-4xl items-center justify-center px-4">
            <a
              href="https://alexahman.se"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 text-neutral-400 transition-colors hover:text-neutral-100"
            >
              <Image
                src="/alexahman-logo.svg"
                alt="AlexAhman"
                width={28}
                height={28}
                className="rounded-md"
              />
              <span className="font-mono text-xs">Skapad av AlexAhman</span>
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
