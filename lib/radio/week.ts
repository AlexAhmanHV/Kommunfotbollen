// Veckologik för Matchradion — ren, ingen databas. Allt räknas i svensk tid:
// en vecka är måndag 00:00 till nästa måndag 00:00 (slutet exklusivt), och
// nyckeln är ISO-veckan ("2026-W41").

const TZ = "Europe/Stockholm";
const DAY_MS = 24 * 60 * 60 * 1000;

export type RadioWeek = { key: string; start: Date; end: Date };

type YMD = readonly [y: number, m: number, d: number];

/** Svenskt kalenderdatum (månad 1–12) för ett ögonblick. */
function stockholmDate(at: Date): YMD {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return [get("year"), get("month"), get("day")];
}

/** Ögonblicket då kalenderdatumet börjar (00:00) i svensk tid. */
function stockholmMidnight([y, m, d]: YMD): Date {
  const guess = new Date(Date.UTC(y, m - 1, d));
  // Hur långt svensk tid ligger före UTC just då (1 eller 2 timmar).
  const local = new Date(guess.toLocaleString("en-US", { timeZone: TZ }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime()));
}

function toYMD(date: Date): YMD {
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

/** ISO-veckonyckel för ett kalenderdatum: veckan hör till torsdagens år. */
function isoWeekKey([y, m, d]: YMD): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7; // mån=1 … sön=7
  date.setUTCDate(date.getUTCDate() + 4 - dow); // torsdagen samma vecka
  const year = date.getUTCFullYear();
  const dayOfYear = (date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1;
  const week = Math.ceil(dayOfYear / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Senast avslutade veckan före `now`. */
export function lastCompletedWeek(now: Date): RadioWeek {
  // Kalenderräkning på UTC-datum (inga klockslag, så inget sommartidsstrul).
  const [y, m, d] = stockholmDate(now);
  const today = new Date(Date.UTC(y, m - 1, d));
  const dow = today.getUTCDay() || 7;
  const monday = new Date(today.getTime() - (dow - 1 + 7) * DAY_MS); // förra veckans måndag
  const nextMonday = new Date(monday.getTime() + 7 * DAY_MS);
  return {
    key: isoWeekKey(toYMD(monday)),
    start: stockholmMidnight(toYMD(monday)),
    end: stockholmMidnight(toYMD(nextMonday)),
  };
}
