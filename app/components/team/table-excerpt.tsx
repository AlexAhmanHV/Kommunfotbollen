import Link from "next/link";

export type ExcerptRow = { teamId: string; teamName: string; position: number; pts: number };

// Utdrag ur serietabellen med lagets rad markerad och länk till hela tabellen.
export function TableExcerptBox({
  rows,
  teamId,
  leagueId,
}: {
  rows: ExcerptRow[];
  teamId: string;
  leagueId: string | null;
}) {
  return (
    <div className="rounded-xl bg-surface-dark-raised p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">Tabellen</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-on-dark-muted">Ingen tabell inläst.</p>
      ) : (
        <table className="mt-2 w-full text-sm tabular-nums">
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.teamId}
                className={`border-t border-line-dark first:border-t-0 ${
                  r.teamId === teamId ? "bg-accent/10 font-bold" : ""
                }`}
              >
                <td className="w-8 py-1.5 pl-2 text-on-dark-muted">{r.position}</td>
                <td className="py-1.5">{r.teamName}</td>
                <td className="py-1.5 pr-2 text-right font-display text-base font-extrabold text-accent">
                  {r.pts}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {leagueId && (
        <Link
          href={`/serie/${leagueId}`}
          className="mt-3 inline-block text-xs font-semibold text-accent hover:underline"
        >
          Hela tabellen →
        </Link>
      )}
    </div>
  );
}
