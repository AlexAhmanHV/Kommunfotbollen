import type { TeamSummary } from "@/lib/matchday";

const weekdayFmt = new Intl.DateTimeFormat("sv-SE", { weekday: "short", timeZone: "Europe/Stockholm" });
const dayMonthFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "numeric",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

export function NextMatchBox({
  next,
  leagueName,
}: {
  next: TeamSummary["next"];
  leagueName: string | null;
}) {
  return (
    <div className="rounded-xl bg-surface-dark-raised p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">
        Nästa match
        {next && ` · ${weekdayFmt.format(next.startsAt)} ${dayMonthFmt.format(next.startsAt)}`}
      </p>
      {next ? (
        <>
          <div className="mt-3 flex items-end justify-between gap-4">
            <p className="font-display text-2xl font-extrabold uppercase leading-none">
              {next.home ? "Hemma" : "Borta"} mot {next.opponent}
            </p>
            <p className="font-display text-5xl font-extrabold leading-none tabular-nums text-accent">
              {timeFmt.format(next.startsAt)}
            </p>
          </div>
          {leagueName && <p className="mt-2 text-xs text-on-dark-muted">{leagueName}</p>}
        </>
      ) : (
        <p className="mt-3 text-on-dark-muted">Ingen match inlagd</p>
      )}
    </div>
  );
}
