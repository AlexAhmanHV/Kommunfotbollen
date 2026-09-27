import type { UiMatch } from "@/lib/queries";
import type { MatchdayMode } from "@/lib/matchday";

const weekdayFmt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "short",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});
const dayMonthFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "numeric",
  timeZone: "Europe/Stockholm",
});

// "Division 4 Småland norra" → "Div 4"
function shortLeague(name: string): string {
  const m = name.match(/^Division (\d+)/);
  return m ? `Div ${m[1]}` : name;
}

// Omgångens övriga lokala matcher: tid före avspark, resultat i läget "recent".
export function RoundStrip({ mode, matches }: { mode: MatchdayMode; matches: UiMatch[] }) {
  if (matches.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {matches.map((m, i) => (
        <li
          key={m.id}
          className="rise rounded-lg bg-surface-dark-raised px-3 py-2.5"
          style={{ "--i": i } as React.CSSProperties}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {m.homeName} – {m.awayName}
            </span>
            <span className="shrink-0 font-display text-lg font-extrabold tabular-nums text-accent">
              {mode === "recent"
                ? `${m.homeScore}–${m.awayScore}`
                : timeFmt.format(m.startsAt)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-on-dark-muted">
            {shortLeague(m.leagueName)} · {weekdayFmt.format(m.startsAt)}{" "}
            {dayMonthFmt.format(m.startsAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}
