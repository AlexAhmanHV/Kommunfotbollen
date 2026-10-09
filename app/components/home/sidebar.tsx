import Link from "next/link";
import { SectionHeading } from "../section-heading";
import { RadioPlayer, type RadioEpisodeView } from "./radio-player";

export type PodEpisode = {
  id: string;
  podcast: string;
  title: string;
  durationSec: number | null;
  publishedAt: Date;
};

export type PodcastGroup = {
  name: string;
  day: string;
  recent: PodEpisode[];
  older: PodEpisode[];
};

const dateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});

function Episode({ e }: { e: PodEpisode }) {
  return (
    <li>
      <a
        href={e.id}
        target="_blank"
        rel="noopener noreferrer"
        className="group block px-3 py-2.5 transition-colors hover:bg-surface"
      >
        <span className="block text-sm font-medium text-ink group-hover:underline">{e.title}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">
          {dateFmt.format(e.publishedAt)}
          {e.durationSec ? ` · ${Math.round(e.durationSec / 60)} min` : ""}
        </span>
      </a>
    </li>
  );
}

// Sidospalten: Matchradion, länkar till serierna och de senaste poddavsnitten.
export function Sidebar({
  radio,
  leagues,
  podcasts,
}: {
  radio: RadioEpisodeView | null;
  leagues: { id: string; name: string }[];
  podcasts: PodcastGroup[];
}) {
  return (
    <aside className="space-y-10">
      {radio && (
        <section className="reveal">
          <SectionHeading>Matchradion</SectionHeading>
          <RadioPlayer {...radio} />
        </section>
      )}
      <section className="reveal">
        <SectionHeading>Serier</SectionHeading>
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-raised">
          {leagues.map((l) => (
            <li key={l.id}>
              <Link
                href={`/serie/${l.id}`}
                className="group flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-ink transition-colors hover:bg-surface"
              >
                <span className="font-medium">{l.name}</span>
                <span
                  className="text-ink-muted transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {podcasts.length > 0 && (
        <section id="poddar" className="reveal scroll-mt-24">
          <SectionHeading>Poddar</SectionHeading>
          <div className="space-y-6">
            {podcasts.map((p) => (
              <div key={p.name}>
                <h3 className="mb-2 flex items-baseline gap-2">
                  <span className="font-display text-lg font-extrabold uppercase text-ink">{p.name}</span>
                  <span className="text-xs text-ink-muted">{p.day}</span>
                </h3>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-raised">
                  {p.recent.map((e) => (
                    <Episode key={e.id} e={e} />
                  ))}
                </ul>
                {p.older.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                      Visa äldre avsnitt ({p.older.length})
                    </summary>
                    <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-raised">
                      {p.older.map((e) => (
                        <Episode key={e.id} e={e} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
