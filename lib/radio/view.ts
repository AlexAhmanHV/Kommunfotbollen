import type { RadioEpisodeView } from "@/app/components/home/radio-player";

// Ett sparat avsnitt → det spelaren visar ("Vecka 40", "28 sep. – 4 okt.").
// Delas av startsidan och arkivsidan /radio.

const dateFmt = new Intl.DateTimeFormat("sv-SE", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/Stockholm",
});

export function radioView(row: {
  id: string;
  weekStart: Date;
  script: string;
  audioUrl: string;
}): RadioEpisodeView {
  // +6,5 dygn landar säkert på söndagen även veckan sommartiden slutar
  const sunday = new Date(row.weekStart.getTime() + 6.5 * 24 * 60 * 60 * 1000);
  return {
    title: `Vecka ${Number(row.id.slice(6))}`,
    dateLabel: `${dateFmt.format(row.weekStart)} – ${dateFmt.format(sunday)}`,
    audioUrl: row.audioUrl,
    script: row.script,
  };
}
