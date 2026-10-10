import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { radioEpisodes } from "@/lib/db/schema";
import { radioView } from "@/lib/radio/view";
import { RadioPlayer } from "../components/home/radio-player";
import { PageContainer } from "../components/page-container";
import { PageHeader } from "../components/page-header";

// Avsnitten tillkommer en gång i veckan — cacha som startsidan.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Matchradion | Kommunfotbollen",
  description:
    "Alla avsnitt av Matchradion: ett AI-genererat veckoprogram om lokalfotbollen i Västervik med omnejd, med resultat, målskyttar, tränarcitat och tabellrunda.",
};

export default async function RadioArchive() {
  const db = await getDb();
  const rows = await db
    .select({
      id: radioEpisodes.id,
      weekStart: radioEpisodes.weekStart,
      script: radioEpisodes.script,
      audioUrl: radioEpisodes.audioUrl,
    })
    .from(radioEpisodes)
    .orderBy(desc(radioEpisodes.weekStart));

  return (
    <>
      <PageHeader kicker="Varje måndag under säsongen" title="Matchradion">
        Ett kort radioprogram om veckans omgång: resultat, målskyttar, citat
        från tränarna och en tabellrunda. Manuset skrivs av AI utifrån
        resultaten och lokaltidningarnas matchrapporter.
      </PageHeader>
      <PageContainer>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Inga avsnitt än. Matchradion är tillbaka när säsongen startar.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {rows.map((row) => (
              <li key={row.id}>
                <RadioPlayer {...radioView(row)} />
              </li>
            ))}
          </ul>
        )}
      </PageContainer>
    </>
  );
}
