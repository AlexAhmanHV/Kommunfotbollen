import { SectionHeading } from "../section-heading";
import { NewsCard, NewsTags, formatNewsDate, type NewsArticle } from "../news-card";

export type { NewsArticle };

const FEATURED_COUNT = 6; // nyaste artiklarna som mörka kort, resten bakom "Visa äldre"

function Item({ a }: { a: NewsArticle }) {
  return (
    <li>
      <a href={a.id} target="_blank" rel="noopener noreferrer" className="group block py-3">
        <NewsTags names={a.teamNames} />
        <h4 className="mt-1.5 font-semibold text-ink group-hover:underline">{a.title}</h4>
        {a.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{a.summary}</p>}
        <p className="mt-1 text-xs text-ink-muted">
          {a.source} · {formatNewsDate(a.publishedAt)}
        </p>
      </a>
    </li>
  );
}

// Nyheterna om lagen: de sex senaste som mörka kort i rutnät, resten i lista
// bakom "Visa äldre".
export function NewsFeed({ articles }: { articles: NewsArticle[] }) {
  const featured = articles.slice(0, FEATURED_COUNT);
  const older = articles.slice(FEATURED_COUNT);

  return (
    <section id="nyheter" className="reveal scroll-mt-24">
      <SectionHeading count={articles.length > 0 ? `${articles.length} artiklar` : undefined}>
        Nyheter
      </SectionHeading>
      {featured.length === 0 ? (
        <p className="text-sm text-ink-muted">Inga nyheter om lagen just nu.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {featured.map((a) => (
              <NewsCard key={a.id} a={a} />
            ))}
          </div>
          {older.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink">
                Visa äldre nyheter ({older.length})
              </summary>
              <ul className="mt-2 divide-y divide-line">
                {older.map((a) => (
                  <Item key={a.id} a={a} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
