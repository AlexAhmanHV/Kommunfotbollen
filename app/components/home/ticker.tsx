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

// Minsta antal rader innan loopen upprepas, så att dubbletten (för den
// sömlösa -50%-loopen) aldrig hamnar synlig bredvid originalet vid få items.
const MIN_ROW_ITEMS = 8;

type RepeatedItem = { item: TickerItem; rep: number };

function Row({ items, duplicate }: { items: RepeatedItem[]; duplicate?: boolean }) {
  return (
    <ul className={`flex shrink-0 ${duplicate ? "ticker-dup" : ""}`} aria-hidden={duplicate || undefined}>
      {items.map(({ item: { kind, match: m }, rep }) => (
        <li
          key={`${rep}-${kind}-${m.id}`}
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
// Går att pausa utan mus: kryssrutan längst till höger (WCAG 2.2.2), annars
// pausar hover eller tangentbordsfokus i listan.
export function Ticker({ items }: { items: TickerItem[] }) {
  if (items.length === 0) return null;

  // Upprepa listan tills raden har minst MIN_ROW_ITEMS poster, så att
  // originalet och dubbletten inte visar samma post sida vid sida.
  const repeatCount = Math.max(1, Math.ceil(MIN_ROW_ITEMS / items.length));
  const rowItems: RepeatedItem[] = Array.from({ length: repeatCount }, (_, rep) =>
    items.map((item): RepeatedItem => ({ item, rep })),
  ).flat();

  return (
    <div
      className="ticker flex items-stretch bg-accent text-surface-dark"
      aria-label="Senaste resultat och kommande matcher"
    >
      <div className="ticker-viewport min-w-0 flex-1 overflow-hidden whitespace-nowrap">
        <div
          className="ticker-track inline-flex"
          style={{ "--ticker-duration": `${Math.max(20, rowItems.length * 5)}s` } as React.CSSProperties}
        >
          <Row items={rowItems} />
          <Row items={rowItems} duplicate />
        </div>
      </div>
      <label className="ticker-toggle flex shrink-0 cursor-pointer select-none items-center border-l border-surface-dark/15 px-3">
        <input type="checkbox" aria-label="Pausa tickern" className="sr-only" />
        <span aria-hidden="true" className="ticker-icon-pause">
          ⏸
        </span>
        <span aria-hidden="true" className="ticker-icon-play">
          ▶
        </span>
      </label>
    </div>
  );
}
