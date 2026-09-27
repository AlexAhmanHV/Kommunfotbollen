// Sektionsrubrik: versaler i Barlow Condensed med ett kort grönt streck
// framför. `tone` väljer färg för mörk respektive ljus bakgrund.
export function SectionHeading({
  children,
  count,
  tone = "light",
}: {
  children: React.ReactNode;
  count?: React.ReactNode;
  tone?: "light" | "dark";
}) {
  const dark = tone === "dark";
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2
        className={`flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-wide ${
          dark ? "text-on-dark" : "text-ink"
        }`}
      >
        <span className="h-1 w-4 bg-accent" aria-hidden />
        {children}
      </h2>
      {count != null && (
        <span className={`text-xs ${dark ? "text-on-dark-muted" : "text-ink-muted"}`}>{count}</span>
      )}
    </div>
  );
}
