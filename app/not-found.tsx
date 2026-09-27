import Link from "next/link";
import { PageContainer } from "./components/page-container";
import { PageHeader } from "./components/page-header";

export default function NotFound() {
  return (
    <>
      <PageHeader kicker="404" title="Sidan finns inte.">
        Serien eller sidan du letade efter är borta eller har aldrig funnits.
      </PageHeader>
      <PageContainer>
        <Link
          href="/"
          className="group inline-flex items-center gap-1.5 rounded-lg border border-line px-4 py-2 text-xs text-ink transition duration-200 hover:-translate-y-0.5 hover:border-ink-muted hover:bg-surface-raised active:translate-y-0"
        >
          <span className="transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden>
            ←
          </span>
          Till startsidan
        </Link>
      </PageContainer>
    </>
  );
}
