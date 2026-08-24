// Editorial sektionsrubrik. Två varianter för att bryta monotonin av att
// upprepa samma nakna versal-label i varje sektion:
// - "utility" (default): mono-label + hårlinje + valfri räknare. För lister
//   och sekundärt innehåll (nyheter, poddar, matcher).
// - "feature": större, tyngre rubrik utan hårlinje. För sidans huvudsektioner
//   (lokala lag, serier) som ska kännas som sidans kärna, inte en datarad.
export function SectionHeading({
  children,
  count,
  variant = "utility",
}: {
  children: React.ReactNode;
  count?: React.ReactNode;
  variant?: "utility" | "feature";
}) {
  if (variant === "feature") {
    return (
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">{children}</h2>
        {count != null && (
          <span className="font-mono text-xs text-neutral-500">{count}</span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        {children}
      </h2>
      <span className="h-px flex-1 bg-neutral-800" aria-hidden />
      {count != null && (
        <span className="font-mono text-xs text-neutral-600">{count}</span>
      )}
    </div>
  );
}
