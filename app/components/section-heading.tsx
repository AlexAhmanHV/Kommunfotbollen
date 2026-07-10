// Editorial sektionsrubrik: label + horisontlinje + valfri räknare. Ger varje
// sektion samma rytm utan att upprepa samma nakna versal-label rakt av.
export function SectionHeading({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: React.ReactNode;
}) {
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
