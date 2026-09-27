import Image from "next/image";
import Link from "next/link";
import type { FormLetter, TeamSummary } from "@/lib/matchday";
import { teamImage } from "@/lib/team-images";
import { teamSlug } from "@/lib/teams";
import { TeamCrest } from "../team-crest";

const weekdayFmt = new Intl.DateTimeFormat("sv-SE", {
  weekday: "short",
  timeZone: "Europe/Stockholm",
});
const dayMonthFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "numeric",
  timeZone: "Europe/Stockholm",
});
const timeFmt = new Intl.DateTimeFormat("sv-SE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Stockholm",
});

const FORM_STYLE: Record<FormLetter, string> = {
  V: "bg-accent text-surface-dark",
  O: "bg-form-draw text-on-dark",
  F: "bg-line-dark text-on-dark-muted",
};
const FORM_LABEL: Record<FormLetter, string> = { V: "Vinst", O: "Oavgjort", F: "Förlust" };

export function FormBadges({ form }: { form: FormLetter[] }) {
  if (form.length === 0) return null;
  return (
    <div
      role="img"
      className="mt-2 flex gap-1"
      aria-label={`Form, senaste matcherna: ${form.map((f) => FORM_LABEL[f]).join(", ")}`}
    >
      {form.map((f, i) => (
        <span
          key={i}
          className={`grid h-4 w-4 place-items-center rounded-[3px] text-[9px] font-bold ${FORM_STYLE[f]}`}
        >
          {f}
        </span>
      ))}
    </div>
  );
}

function TeamCard({ team, index }: { team: TeamSummary; index: number }) {
  const image = teamImage(team.teamId);
  const body = (
    <>
      <div className="relative h-24 overflow-hidden">
        {image ? (
          <Image
            src={image}
            alt=""
            fill
            sizes="(min-width: 768px) 20vw, 70vw"
            className="object-cover transition-transform duration-500 motion-safe:group-hover:scale-110"
          />
        ) : (
          <div
            className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#2a2f38,#0e1116)]"
            aria-hidden
          >
            <div className="opacity-15">
              <TeamCrest name={team.name} logoUrl={team.logoUrl} size={80} />
            </div>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-dark/85 to-transparent" aria-hidden />
        <span className="absolute bottom-2 left-2">
          <TeamCrest name={team.name} logoUrl={team.logoUrl} size={26} />
        </span>
        <span className="absolute bottom-1.5 right-2 font-display text-3xl font-extrabold leading-none tabular-nums text-on-dark">
          {team.position ?? "–"}
          {team.position != null && (
            <small className="font-sans text-[10px] font-medium text-on-dark-muted">:a</small>
          )}
        </span>
      </div>
      <div className="p-3">
        <span className="block truncate font-display text-base font-bold uppercase leading-none">
          {team.name}
        </span>
        <FormBadges form={team.form} />
        <div className="mt-2.5 flex flex-col gap-0.5">
          {team.next ? (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">
                Nästa · {weekdayFmt.format(team.next.startsAt)} {dayMonthFmt.format(team.next.startsAt)}{" "}
                {timeFmt.format(team.next.startsAt)}
              </span>
              <span className="truncate text-sm font-semibold text-on-dark">
                <span className="font-normal text-on-dark-muted">{team.next.home ? "hemma" : "borta"}</span>{" "}
                {team.next.opponent}
              </span>
            </>
          ) : (
            <span className="text-sm text-on-dark-muted">Ingen match inlagd</span>
          )}
        </div>
      </div>
    </>
  );

  const cls =
    "group rise block w-[70%] shrink-0 snap-start overflow-hidden rounded-lg bg-surface-dark-raised transition duration-200 md:w-auto";
  const style = { "--i": index } as React.CSSProperties;
  const slug = teamSlug(team.teamId);
  const href = slug ? `/lag/${slug}` : team.leagueId ? `/serie/${team.leagueId}` : null;
  return href ? (
    <Link
      href={href}
      className={`${cls} hover:shadow-xl hover:shadow-black/40 motion-safe:hover:-translate-y-1`}
      style={style}
    >
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

// De lokala lagen sorterade efter placering (sorteringen görs i lib/matchday.ts).
// Mobil: en rad att svepa i; från md-bredd ett rutnät med fem kolumner.
export function TeamGrid({ teams }: { teams: TeamSummary[] }) {
  if (teams.length === 0) {
    return <p className="text-sm text-on-dark-muted">Inga lag eller tabeller inlästa ännu.</p>;
  }
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0 md:pb-0">
      {teams.map((t, i) => (
        <TeamCard key={t.teamId} team={t} index={i} />
      ))}
    </div>
  );
}
