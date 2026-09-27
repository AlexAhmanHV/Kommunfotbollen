// Mörk rubrikrad för textsidor ("Så funkar det", systemstatus): etikett,
// rubrik och valfri ingress. Går kant i kant; innehållet under ligger ljust.
export function PageHeader({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="bg-surface-dark text-on-dark">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-10">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-accent">
          <span className="h-1 w-4 bg-accent" aria-hidden />
          {kicker}
        </p>
        <h1 className="mt-3 font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl">
          {title}
        </h1>
        {children && (
          <div className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-on-dark-muted">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}
