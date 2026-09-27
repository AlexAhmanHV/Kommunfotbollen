import type { UiMatch } from "@/lib/queries";
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

export async function MatchList({ matches }: { matches: UiMatch[] }) {
  if (matches.length === 0) {
    return <p className="text-sm text-neutral-500">Inga matcher.</p>;
  }

  const finishedIds = matches
    .filter((m) => m.status === "FINISHED")
    .map((m) => m.id);
  const goals = await getGoalsByMatch(finishedIds);

  return (
    <ul className="divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      {matches.map((m) => {
        const g = goals.get(m.id);
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
              <span className="w-14 shrink-0 font-mono text-xs text-neutral-500">
                {dateFmt.format(m.startsAt)}
              </span>
              <span className="flex flex-1 items-center justify-end gap-2 truncate">
                <span
                  className={`truncate text-right ${isLocalTeam(m.homeId) ? "font-semibold text-emerald-400" : ""}`}
                >
                  {m.homeName}
                </span>
                <TeamCrest name={m.homeName} logoUrl={m.homeLogo} size={20} />
              </span>
              <span className="shrink-0 font-mono font-semibold">
                {m.status === "FINISHED" ? (
                  `${m.homeScore}–${m.awayScore}`
                ) : m.status === "ONGOING" ? (
                  <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-950">
                    live
                  </span>
                ) : (
                  <span className="text-neutral-500">{timeFmt.format(m.startsAt)}</span>
                )}
              </span>
              <span className="flex flex-1 items-center gap-2 truncate">
                <TeamCrest name={m.awayName} logoUrl={m.awayLogo} size={20} />
                <span
                  className={`truncate ${isLocalTeam(m.awayId) ? "font-semibold text-emerald-400" : ""}`}
                >
                  {m.awayName}
                </span>
              </span>
            </div>

            {(homeScorers.length > 0 || awayScorers.length > 0) && (
              <div className="mt-1.5 flex items-start gap-3 text-[11px] leading-snug text-neutral-500">
                <span className="w-14 shrink-0" aria-hidden />
                <span className="flex-1 text-right">{formatScorers(homeScorers)}</span>
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                  title="Målskyttar (från lokaltidningarnas matchreferat)"
                  aria-hidden
                />
                <span className="flex-1">{formatScorers(awayScorers)}</span>
              </div>
            )}

            {scorersMissing && (
              <p className="mt-1.5 text-center text-[11px] leading-snug text-neutral-600">
                Målskyttar ej rapporterade
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
