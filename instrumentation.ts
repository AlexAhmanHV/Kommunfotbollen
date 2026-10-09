// Körs en gång när Next.js-servern startar (dev och prod).
// Tre schemalagda jobb, appen är sin egen cron:
//   1. Nyheter + AI-relevansfilter en gång per dygn kl 22:00 svensk tid.
//   2. Lagen (tabeller, matcher/resultat, målskyttar) kl 23:00 svensk tid.
//   3. Matchradion kl 23:30 (gör bara något när veckans avsnitt saknas).
// /api/sync kör jobben manuellt (backup / test).

const SEED_DELAY_MS = 5 * 1000;
const NEWS_HOUR_LOCAL = 22; // 22:00 Europe/Stockholm
const TEAMS_HOUR_LOCAL = 23; // 23:00 Europe/Stockholm
const RADIO_TIME_LOCAL = { hour: 23, minute: 30 }; // efter lagsynken

/** Millisekunder till nästa `hour`:`minute` svensk tid. */
function msUntilNext(hour: number, minute = 0): number {
  const now = new Date();
  // "nu" uttryckt i svensk lokaltid
  const local = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }),
  );
  const target = new Date(local);
  target.setHours(hour, minute, 0, 0);
  if (target <= local) target.setDate(target.getDate() + 1);
  return target.getTime() - local.getTime();
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as typeof globalThis & {
    __kfScheduled?: boolean;
  };
  if (g.__kfScheduled) return; // HMR-vakt
  g.__kfScheduled = true;

  const { ensureSynced, syncNewsAndFilter, syncRadio, syncTeams } = await import("./lib/sync");

  const run = (label: string, job: () => Promise<boolean>) => async () => {
    const t = Date.now();
    try {
      const ran = await job();
      console.log(
        ran
          ? `[sync] ${label} ok ${Date.now() - t}ms`
          : `[sync] ${label} körs redan — hoppar över`,
      );
    } catch (err) {
      console.error(`[sync] ${label} misslyckades:`, err);
    }
  };

  // Dagliga jobb: räkna om tiden till nästa körning efter varje körning, så
  // klockslaget håller även över sommar-/vintertidsskiftet.
  const daily = (hour: number, label: string, job: () => Promise<boolean>, minute = 0) => {
    const runJob = run(label, job);
    const at = `${hour}:${String(minute).padStart(2, "0")}`;
    const schedule = () => {
      const delay = msUntilNext(hour, minute);
      console.log(`[sync] ${label} schemalagda om ${Math.round(delay / 60000)} min (nästa ${at})`);
      setTimeout(async () => {
        await runJob();
        schedule();
      }, delay);
    };
    schedule();
  };

  // Strax efter start: fyll en tom databas (första deployen) så sidan inte
  // står tom till kl 23. Finns serierna redan görs ingenting.
  setTimeout(async () => {
    try {
      await ensureSynced();
    } catch (err) {
      console.error("[sync] autoseed misslyckades:", err);
    }
  }, SEED_DELAY_MS);

  daily(NEWS_HOUR_LOCAL, "nyheter", syncNewsAndFilter);
  daily(TEAMS_HOUR_LOCAL, "lag", syncTeams);
  daily(RADIO_TIME_LOCAL.hour, "radio", syncRadio, RADIO_TIME_LOCAL.minute);

  console.log(
    "[sync] schemalagt: nyheter kl 22:00, lag (tabeller, matcher, målskyttar) kl 23:00, radio kl 23:30",
  );
}
