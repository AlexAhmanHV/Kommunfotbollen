import { getDb } from "./db/client";
import { podcastEpisodes } from "./db/schema";

// Poddflöden: de två lokala fotbollspoddar som täcker kommunfotbollen.
// Båda ligger på pod.space och har rena RSS 2.0-flöden (title/link/pubDate/
// enclosure/itunes:duration). Vi lagrar bara metadata + länk — lyssningen
// sker hos podden. Nykritat släpps torsdagar, Fotbollsviken fredagar.
const PODCASTS = [
  { name: "Nykritat", url: "https://feed.pod.space/nykritat" },
  { name: "Fotbollsviken", url: "https://feed.pod.space/fotbollsviken" },
];

const USER_AGENT =
  "kommunfotboll.se dev (portfolioprojekt; kontakt: alexhvahman@gmail.com)";

// Vi behåller de senaste avsnitten per podd (sidan visar 3 + "visa mer").
const KEEP_PER_PODCAST = 20;
const MAX_SUMMARY_LENGTH = 300;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aring: "å", auml: "ä", ouml: "ö", Aring: "Å", Auml: "Ä", Ouml: "Ö",
  eacute: "é", Eacute: "É", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function cleanText(s: string): string {
  const text = decodeEntities(decodeEntities(s).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_SUMMARY_LENGTH
    ? text.slice(0, MAX_SUMMARY_LENGTH - 1).trimEnd() + "…"
    : text;
}

function unwrapCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

function tagContent(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? unwrapCdata(m[1]).trim() : undefined;
}

// "01:43:18" | "50:44" | "3044" → sekunder
function parseDuration(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

type Episode = {
  link: string;
  title: string;
  summary: string | null;
  audioUrl: string | null;
  durationSec: number | null;
  publishedAt: Date;
};

function parseEpisodes(xml: string): Episode[] {
  const out: Episode[] = [];
  for (const m of xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = decodeEntities(tagContent(block, "title") ?? "");
    const link = tagContent(block, "link") ?? "";
    const pubDate = tagContent(block, "pubDate") ?? "";
    const publishedAt = new Date(pubDate);
    if (!title || !link || isNaN(publishedAt.getTime())) continue;

    const enclosure = block.match(/<enclosure[^>]*url="([^"]+)"/i);
    const desc =
      tagContent(block, "itunes:summary") ?? tagContent(block, "description");

    out.push({
      link,
      title,
      summary: desc ? cleanText(desc) : null,
      audioUrl: enclosure ? enclosure[1] : null,
      durationSec: parseDuration(tagContent(block, "itunes:duration")),
      publishedAt,
    });
  }
  return out;
}

export async function syncPodcasts(): Promise<void> {
  const db = await getDb();
  const now = new Date();

  for (const pod of PODCASTS) {
    let xml: string;
    try {
      const res = await fetch(pod.url, {
        headers: { "User-Agent": USER_AGENT },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      // en trasig podd ska inte stoppa den andra
      console.error(`[podcasts] ${pod.name} gick inte att hämta:`, err);
      continue;
    }

    const episodes = parseEpisodes(xml)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, KEEP_PER_PODCAST);

    for (const ep of episodes) {
      await db
        .insert(podcastEpisodes)
        .values({
          id: ep.link,
          podcast: pod.name,
          title: ep.title,
          summary: ep.summary,
          audioUrl: ep.audioUrl,
          durationSec: ep.durationSec,
          publishedAt: ep.publishedAt,
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: podcastEpisodes.id,
          set: {
            title: ep.title,
            summary: ep.summary,
            durationSec: ep.durationSec,
            fetchedAt: now,
          },
        });
    }
  }
}
