import { isResultMissing, type UiMatch } from "@/lib/queries";
import { isLocalTeam } from "@/lib/local-teams";
import { getGoalsByMatch } from "@/lib/goals";
import { TeamCrest } from "./team-crest";

const dateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

// Flera mål av samma spelare slås ihop: "Albin Kito, Albin Kito" → "Albin Kito (2)",
// och den som gjort flest mål listas först.
function formatScorers(players: string[]): string {
  const counts = new Map<string, number>();
  for (const p of players) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name} (${n})` : name))
    .join(", ");
}

// Lagnamn; lokala lag i fetstil med ett kort grönt streck framför.
function TeamName({ id, name, align }: { id: string; name: string; align: "left" | "right" }) {
  const local = isLocalTeam(id);
  return (
    <span
      className={`flex min-w-0 items-center gap-1.5 ${align === "right" ? "justify-end" : ""} ${
        local ? "font-semibold text-ink" : "text-ink"
      }`}
    >
      {local && <span className="h-3 w-1 shrink-0 rounded-sm bg-accent" aria-hidden />}
      <span className="truncate">{name}</span>
    </span>
  );
}

export async function MatchList({ matches }: { matches: UiMatch[] }) {
  if (matches.length === 0) {
    return <p className="text-sm text-ink-muted">Inga matcher.</p>;
  }

  const finishedIds = matches
    .filter((m) => m.status === "FINISHED")
    .map((m) => m.id);
  const goals = await getGoalsByMatch(finishedIds);

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-raised">
      {matches.map((m) => {
        const g = goals.get(m.id);
        const resultMissing = isResultMissing(m);
        const homeScorers = g?.filter((x) => x.teamId === m.homeId).map((x) => x.player) ?? [];
        const awayScorers = g?.filter((x) => x.teamId === m.awayId).map((x) => x.player) ?? [];
        // Målskyttar letas bara för de lokala lagens matcher — bara där är det
        // värt att säga att de saknas, så ingen tror att något är trasigt.
        const scorersMissing =
          m.status === "FINISHED" &&
          (m.homeScore ?? 0) + (m.awayScore ?? 0) > 0 &&
          homeScorers.length === 0 &&
          awayScorers.length === 0 &&
          (isLocalTeam(m.homeId) || isLocalTeam(m.awayId));
        return (
          <li key={m.id} className="px-4 py-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="w-14 shrink-0 text-xs tabular-nums text-ink-muted">
                {dateFmt.format(m.startsAt)}
              </span>
              <span className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <TeamName id={m.homeId} name={m.homeName} align="right" />
                <TeamCrest name={m.homeName} logoUrl={m.homeLogo} size={20} />
              </span>
              <span className="w-14 shrink-0 text-center font-display text-lg font-extrabold tabular-nums text-ink">
                {m.status === "FINISHED" ? (
                  `${m.homeScore}–${m.awayScore}`
                ) : resultMissing ? (
                  <span className="text-ink-muted" title="Resultat saknas">–</span>
                ) : m.status === "ONGOING" ? (
                  <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide text-ink">
                    live
                  </span>
                ) : (
                  <span className="text-base font-bold text-ink-muted">{timeFmt.format(m.startsAt)}</span>
                )}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <TeamCrest name={m.awayName} logoUrl={m.awayLogo} size={20} />
                <TeamName id={m.awayId} name={m.awayName} align="left" />
              </span>
            </div>

            {(homeScorers.length > 0 || awayScorers.length > 0) && (
              <div className="mt-1.5 flex items-start gap-3 text-[11px] leading-snug text-ink-muted">
                <span className="w-14 shrink-0" aria-hidden />
                <span className="flex-1 text-right">{formatScorers(homeScorers)}</span>
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  title="Målskyttar (från lokaltidningarnas matchreferat)"
                  aria-hidden
                />
                <span className="flex-1">{formatScorers(awayScorers)}</span>
              </div>
            )}

            {resultMissing && (
              <p className="mt-1.5 text-center text-[11px] leading-snug text-ink-muted">
                Resultat saknas
              </p>
            )}

            {scorersMissing && (
              <p className="mt-1.5 text-center text-[11px] leading-snug text-ink-muted">
                Målskyttar ej rapporterade
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
