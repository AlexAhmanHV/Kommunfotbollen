export type NewsArticle = {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  publishedAt: Date;
  teamNames: string[];
};

const dateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});

export function formatNewsDate(d: Date): string {
  return dateFmt.format(d);
}

export function NewsTags({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((n) => (
        <span
          key={n}
          className="rounded-[3px] bg-accent px-1.5 py-0.5 font-display text-xs font-bold uppercase tracking-wide text-surface-dark"
        >
          {n}
        </span>
      ))}
    </span>
  );
}

// Mörkt nyhetskort (startsidan och lagsidan): lagetiketter, rubrik, ingress,
// källa och datum. Länkar alltid vidare till tidningen.
export function NewsCard({ a }: { a: NewsArticle }) {
  return (
    <a
      href={a.id}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl bg-surface-dark p-5 text-on-dark transition-colors hover:bg-surface-dark-raised focus-visible:outline-offset-[-3px]"
    >
      <NewsTags names={a.teamNames} />
      <h3 className="mt-3 font-display text-2xl font-extrabold uppercase leading-none sm:text-3xl">
        {a.title}
      </h3>
      {a.summary && <p className="mt-3 line-clamp-3 text-sm text-on-dark-muted">{a.summary}</p>}
      <p className="mt-3 text-xs text-on-dark-muted">
        {a.source} · {formatNewsDate(a.publishedAt)}
      </p>
    </a>
  );
}
