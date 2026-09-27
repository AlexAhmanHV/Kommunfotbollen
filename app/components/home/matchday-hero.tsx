import Image from "next/image";
import type { UiMatch } from "@/lib/queries";
import { scoreText, type MatchdayMode, type Standing } from "@/lib/matchday";
import { teamImage } from "@/lib/team-images";
import { TeamCrest } from "../team-crest";

const dayFmt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

// Ena halvan av affischen: lagbilden med långsam zoom, eller en mörk gradient
// med lagets emblem stort och svagt när bild saknas.
function HeroHalf({ teamId, name, logoUrl }: { teamId: string; name: string; logoUrl: string | null }) {
  const image = teamImage(teamId);
  return (
    <div className="relative overflow-hidden">
      {image ? (
        <Image src={image} alt="" fill sizes="50vw" className="kenburns object-cover" />
      ) : (
        <div
          className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,var(--color-line-dark),var(--color-surface-dark))]"
          aria-hidden
        >
          <div className="opacity-15">
            <TeamCrest name={name} logoUrl={logoUrl} size={160} />
          </div>
        </div>
      )}
    </div>
  );
}

function HeroTeam({
  name,
  logoUrl,
  standing,
}: {
  name: string;
  logoUrl: string | null;
  standing?: Standing;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      <TeamCrest name={name} logoUrl={logoUrl} size={56} />
      <span className="font-display text-2xl font-extrabold uppercase leading-none sm:text-3xl">
        {name}
      </span>
      {standing && (
        <span className="text-xs text-on-dark-muted">
          {standing.position}:a · {standing.pts} p
        </span>
      )}
    </div>
  );
}

// Veckans match som affisch (upcoming), mest intressanta spelade matchen
// (recent) eller säsongsuppehåll (offseason). Urvalet görs i lib/matchday.ts.
export function MatchdayHero({
  mode,
  featured,
  standings,
}: {
  mode: MatchdayMode;
  featured: UiMatch | null;
  standings: ReadonlyMap<string, Standing>;
}) {
  if (mode === "offseason" || !featured) {
    return (
      <div className="mx-auto max-w-5xl px-4 pb-4 pt-12">
        <p className="font-display text-sm font-bold uppercase tracking-widest text-accent">
          Kommunfotbollen
        </p>
        <h1 className="mt-2 font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl">
          Säsongen är slut
        </h1>
        <p className="mt-3 max-w-xl text-on-dark-muted">
          Här är slutplaceringarna för de lokala lagen. Nästa säsong syns här så
          fort spelprogrammet är klart.
        </p>
      </div>
    );
  }

  const center =
    mode === "recent"
      ? scoreText(featured.homeScore, featured.awayScore)
      : timeFmt.format(featured.startsAt);

  const h1Text =
    mode === "recent"
      ? `Senaste omgången: ${featured.homeName} mot ${featured.awayName}`
      : `Veckans match: ${featured.homeName} mot ${featured.awayName}`;

  return (
    <div className="relative isolate overflow-hidden">
      <h1 className="sr-only">{h1Text}</h1>
      <div className="absolute inset-0 -z-10 grid grid-cols-2">
        <HeroHalf teamId={featured.homeId} name={featured.homeName} logoUrl={featured.homeLogo} />
        <HeroHalf teamId={featured.awayId} name={featured.awayName} logoUrl={featured.awayLogo} />
      </div>
      <div className="hero-shade absolute inset-0 -z-10" aria-hidden />
      <div className="mx-auto max-w-5xl px-4 pb-8 pt-16 sm:pt-24">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-widest text-on-dark-muted">
          <span className="rounded bg-accent px-2 py-1 font-display text-sm font-bold tracking-wide text-surface-dark">
            {mode === "recent" ? "Senaste omgången" : "Veckans match"}
          </span>
          {featured.leagueName} · {dayFmt.format(featured.startsAt)}
        </p>
        <div className="mt-6 grid grid-cols-1 items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <HeroTeam
            name={featured.homeName}
            logoUrl={featured.homeLogo}
            standing={standings.get(featured.homeId)}
          />
          <span className="text-center font-display text-6xl font-extrabold tabular-nums text-accent sm:text-7xl">
            {center}
          </span>
          <HeroTeam
            name={featured.awayName}
            logoUrl={featured.awayLogo}
            standing={standings.get(featured.awayId)}
          />
        </div>
      </div>
    </div>
  );
}
