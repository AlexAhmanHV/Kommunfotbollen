import Link from "next/link";
import { PageContainer } from "./components/page-container";

export default function NotFound() {
  return (
    <PageContainer className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-emerald-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
        404
      </p>
      <h1 className="mt-3 text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
        Sidan finns inte.
      </h1>
      <p className="mt-4 max-w-sm text-pretty text-neutral-400">
        Serien eller sidan du letade efter är borta eller har aldrig funnits.
      </p>
      <Link
        href="/"
        className="group mt-8 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 px-4 py-2 font-mono text-xs text-emerald-400 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-500/60 hover:bg-emerald-500/[0.06] active:translate-y-0"
      >
        <span className="transition-transform duration-200 group-hover:-translate-x-0.5" aria-hidden>
          ←
        </span>
        Till startsidan
      </Link>
    </PageContainer>
  );
}
