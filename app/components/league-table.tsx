import Link from "next/link";
import { isLocalTeam } from "@/lib/local-teams";
import { teamSlug } from "@/lib/teams";
import { TeamCrest } from "./team-crest";

export type LeagueTableRow = {
  position: number;
  teamId: string;
  teamName: string;
  teamLogo: string | null;
  gp: number;
  w: number;
  d: number;
  l: number;
  gd: number;
  pts: number;
  positionStatus: string | null;
};

// Zonkant längst till vänster, från Everysports zonstreck.
const ZONE: Record<string, string> = {
  promotion: "shadow-[inset_3px_0_0_#c6f432]",
  playoff: "shadow-[inset_3px_0_0_rgb(198_244_50/0.45)]",
  relegation: "shadow-[inset_3px_0_0_#ff5a5a]",
};

// Seriens tabell som resultattavla i den mörka zonen. Lokala lag i fetstil
// med svag grön bakgrund; deras namn länkar till lagsidan.
export function LeagueTable({ rows }: { rows: LeagueTableRow[] }) {
  const hasZones = rows.some((r) => r.positionStatus);
  return (
    <div>
      <div className="overflow-x-auto rounded-xl bg-surface-dark-raised">
        <table className="w-full min-w-[520px] text-sm tabular-nums">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-widest text-on-dark-muted">
              <th className="px-3 py-2.5 text-left">#</th>
              <th className="px-3 py-2.5 text-left">Lag</th>
              <th className="px-2 py-2.5 text-right">S</th>
              <th className="px-2 py-2.5 text-right">V</th>
              <th className="px-2 py-2.5 text-right">O</th>
              <th className="px-2 py-2.5 text-right">F</th>
              <th className="px-2 py-2.5 text-right">+/-</th>
              <th className="px-3 py-2.5 text-right">P</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const local = isLocalTeam(r.teamId);
              const slug = local ? teamSlug(r.teamId) : null;
              return (
                <tr
                  key={r.teamId}
                  className={`border-t border-line-dark ${local ? "bg-accent/10 font-semibold" : ""}`}
                >
                  <td className={`px-3 py-2 text-on-dark-muted ${ZONE[r.positionStatus ?? ""] ?? ""}`}>
                    {r.position}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2.5">
                      <TeamCrest name={r.teamName} logoUrl={r.teamLogo} size={22} />
                      {slug ? (
                        <Link href={`/lag/${slug}`} className="hover:underline">
                          {r.teamName}
                        </Link>
                      ) : (
                        r.teamName
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">{r.gp}</td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">{r.w}</td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">{r.d}</td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">{r.l}</td>
                  <td className="px-2 py-2 text-right text-on-dark-muted">
                    {r.gd > 0 ? `+${r.gd}` : r.gd}
                  </td>
                  <td className="px-3 py-2 text-right font-display text-lg font-extrabold text-accent">
                    {r.pts}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasZones && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-dark-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-1 bg-accent" aria-hidden /> uppflyttning
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-1 bg-accent/45" aria-hidden /> kval
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-1 bg-[#ff5a5a]" aria-hidden /> nedflyttning
          </span>
        </p>
      )}
    </div>
  );
}
