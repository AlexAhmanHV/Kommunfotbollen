import Image from "next/image";
import type { TeamSummary } from "@/lib/matchday";
import { teamImage } from "@/lib/team-images";
import { CLASS_LABEL } from "@/lib/teams";
import { FormBadges } from "../home/team-grid";
import { TeamCrest } from "../team-crest";

// Lagsidans affisch: lagbild (eller reserv) med långsam zoom, lagnamn stort,
// placering, poäng och form.
export function TeamHero({ team, teamClass }: { team: TeamSummary; teamClass: string | null }) {
  const image = teamImage(team.teamId);
  return (
    <div className="relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10">
        {image ? (
          <Image src={image} alt="" fill unoptimized className="kenburns object-cover" />
        ) : (
          <div
            className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,var(--color-line-dark),var(--color-surface-dark))]"
            aria-hidden
          >
            <div className="opacity-15">
              <TeamCrest name={team.name} logoUrl={team.logoUrl} size={220} />
            </div>
          </div>
        )}
      </div>
      <div
        className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,var(--color-surface-dark)_5%,color-mix(in_srgb,var(--color-surface-dark)_25%,transparent)_70%)]"
        aria-hidden
      />
      <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-4 px-4 pb-8 pt-28 sm:pt-40">
        <TeamCrest name={team.name} logoUrl={team.logoUrl} size={64} />
        <div className="min-w-0">
          {team.leagueName && (
            <p className="text-xs font-semibold uppercase tracking-widest text-on-dark-muted">
              {team.leagueName}
              {teamClass && ` · ${CLASS_LABEL[teamClass] ?? teamClass}`}
            </p>
          )}
          <h1 className="font-display text-5xl font-extrabold uppercase leading-none sm:text-6xl">
            {team.name}
          </h1>
        </div>
        <div className="ml-auto text-right">
          {team.position != null && (
            <p className="font-display text-6xl font-extrabold leading-none tabular-nums text-accent">
              {team.position}
              <small className="font-sans text-sm font-medium text-on-dark-muted">
                :a · {team.pts} p
              </small>
            </p>
          )}
          <div className="flex justify-end">
            <FormBadges form={team.form} />
          </div>
        </div>
      </div>
    </div>
  );
}
