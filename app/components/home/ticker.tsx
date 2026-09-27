import type { TickerItem } from "@/lib/matchday";

const weekdayFmt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "short",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

function Row({ items, duplicate }: { items: TickerItem[]; duplicate?: boolean }) {
  return (
    <ul className={`flex shrink-0 ${duplicate ? "ticker-dup" : ""}`} aria-hidden={duplicate || undefined}>
      {items.map(({ kind, match: m }) => (
        <li
          key={`${kind}-${m.id}`}
          className="px-5 py-1.5 font-display text-sm font-bold uppercase tracking-wide"
        >
          {kind === "result" ? (
            <>
              {m.homeName} <span className="font-extrabold">{m.homeScore}–{m.awayScore}</span> {m.awayName}
            </>
          ) : (
            <>
              {weekdayFmt.format(m.startsAt)} {timeFmt.format(m.startsAt)} · {m.homeName} – {m.awayName}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

// Rullande list med senaste resultat och kommande avspark. Innehållet står
// två gånger i rad så att loopen blir sömlös (animationen flyttar -50 %).
export function Ticker({ items }: { items: TickerItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      className="ticker overflow-hidden whitespace-nowrap bg-accent text-surface-dark"
      aria-label="Senaste resultat och kommande matcher"
    >
      <div
        className="ticker-track inline-flex"
        style={{ "--ticker-duration": `${Math.max(20, items.length * 5)}s` } as React.CSSProperties}
      >
        <Row items={items} />
        <Row items={items} duplicate />
      </div>
    </div>
  );
}
