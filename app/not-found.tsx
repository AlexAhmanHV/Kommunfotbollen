import Link from "next/link";
import { PageContainer } from "./components/page-container";

export default function NotFound() {
  return (
    <PageContainer className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-ink-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
        404
      </p>
      <h1 className="mt-3 font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl">
        Sidan finns inte.
      </h1>
      <p className="mt-4 max-w-sm text-pretty text-ink-muted">
        Serien eller sidan du letade efter är borta eller har aldrig funnits.
      </p>
      <Link
        href="/"
        className="group mt-8 inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-xs text-ink transition duration-200 hover:-translate-y-0.5 hover:border-ink-muted hover:bg-surface-raised active:translate-y-0"
      >
        <span className="transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden>
          ←
        </span>
        Till startsidan
      </Link>
    </PageContainer>
  );
}
