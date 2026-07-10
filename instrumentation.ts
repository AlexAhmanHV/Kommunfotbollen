// Körs en gång när Next.js-servern startar (dev och prod).
// Två schemalagda jobb, appen är sin egen cron:
//   1. Matchsynk (tabeller/resultat) var 15:e minut.
//   2. Nyheter + AI-relevansfilter en gång per dygn kl 22:00 svensk tid.
// /api/sync kör allt manuellt (backup / test).

const MATCH_INTERVAL_MS = 15 * 60 * 1000;
const MATCH_FIRST_RUN_MS = 5 * 1000;
const NEWS_HOUR_LOCAL = 22; // 22:00 Europe/Stockholm

/** Millisekunder till nästa kl 22:00 svensk tid. */
function msUntilNextNewsRun(): number {
  const now = new Date();
  // "nu" uttryckt i svensk lokaltid
  const local = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }),
  );
  const target = new Date(local);
  target.setHours(NEWS_HOUR_LOCAL, 0, 0, 0);
  if (target <= local) target.setDate(target.getDate() + 1);
  return target.getTime() - local.getTime();
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as typeof globalThis & {
    __kfMatchTimer?: NodeJS.Timeout;
    __kfNewsScheduled?: boolean;
  };
  if (g.__kfMatchTimer) return; // HMR-vakt

  const { syncMatches, syncNewsAndFilter } = await import("./lib/sync");

  const runMatches = async () => {
    const t = Date.now();
    try {
      await syncMatches();
      console.log(`[sync] matcher ok ${Date.now() - t}ms`);
    } catch (err) {
      console.error("[sync] matcher misslyckades:", err);
    }
  };

  const runNews = async () => {
    const t = Date.now();
    try {
      await syncNewsAndFilter();
      console.log(`[sync] nyheter ok ${Date.now() - t}ms`);
    } catch (err) {
      console.error("[sync] nyheter misslyckades:", err);
    }
  };

  // Matcher: var 15:e minut, första körning strax efter start.
  g.__kfMatchTimer = setInterval(runMatches, MATCH_INTERVAL_MS);
  setTimeout(runMatches, MATCH_FIRST_RUN_MS);

  // Nyheter: schemalägg nästa 22:00, sedan var 24:e timme.
  const scheduleNews = () => {
    const delay = msUntilNextNewsRun();
    console.log(
      `[sync] nyheter schemalagda om ${Math.round(delay / 60000)} min (nästa 22:00)`,
    );
    setTimeout(() => {
      runNews();
      setInterval(runNews, 24 * 60 * 60 * 1000);
    }, delay);
  };
  g.__kfNewsScheduled = true;
  scheduleNews();

  console.log("[sync] schemalagt: matcher var 15:e min, nyheter kl 22:00");
}
