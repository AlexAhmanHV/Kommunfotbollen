import Anthropic from "@anthropic-ai/sdk";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "./db/client";
import { articles, articleTeams, teams } from "./db/schema";
import { TEAM_NEWS_ALIASES } from "./local-teams";

// Kort läsbar namnhint per lag så modellen känner igen skrivsätt i rubriken
// (t.ex. att "Blackstad Odensvi IF" är samma klubb som "B.O.IF").
function aliasHint(teamId: string): string {
  const a = TEAM_NEWS_ALIASES[teamId];
  return a && a.length > 1 ? ` (skrivs även: ${a.join(", ")})` : "";
}

// AI-relevansfilter: bedömer per (artikel, lag)-par om artikeln faktiskt
// handlar om lagets fotboll, eller om laget bara nämns i förbigående / om
// det är en namnkrock (företag, ort, annan sport). Körs sist i synken.
//
// Robusthet:
//  - ingen ANTHROPIC_API_KEY  → hela steget hoppas över, par förblir
//    obedömda (relevant = null) och visas optimistiskt.
//  - API- eller parsningsfel  → paret lämnas obedömt och försöks igen nästa
//    synk (fail-open — ett trasigt AI-svar får aldrig dölja en riktig nyhet).
//  - varje par bedöms bara en gång (checkedAt sätts) → billigt över tid.

const MODEL = "claude-haiku-4-5";
const BATCH_SIZE = 15;

// Kända lokala sportkrönikörer/-signaturer. Deras texter handlar alltid om
// lokal fotboll men har ofta generisk rubrik + saknar ingress,
// så AI-filtret slänger dem felaktigt. Släpp igenom dem utan AI-bedömning.
const TRUSTED_BYLINES = [/\bwille hansson\b/i];

function isTrustedByline(title: string): boolean {
  return TRUSTED_BYLINES.some((re) => re.test(title));
}

const responseSchema = z.array(
  z.object({ i: z.number().int(), relevant: z.boolean() }),
);

const SYSTEM = `Du filtrerar nyheter för en sajt om lokal amatörfotboll i Västervik med omnejd.
För varje artikel får du en rubrik, en källa (tidning) och ett lokalt fotbollslag.
Avgör om artikeln faktiskt handlar om DET lagets fotboll (matcher, resultat, spelare, tabell, klubbnyheter).
Svara false om:
- artikeln handlar om en ANNAN idrott (speedway, ishockey, innebandy, motorsport) — även om ett fotbollslag nämns,
- laget bara nämns i förbigående medan artikeln egentligen handlar om ett annat lag (t.ex. motståndaren),
- det är en namnkrock (företag, ort, förening med liknande namn),
- det är en kategori-/sektionssida eller listning utan eget redaktionellt innehåll.
Laget kan vara ett herr- eller damlag — damlag skrivs ofta kort som "<ort> Dam" (t.ex. "Västerviks Dam").
Handlar artikeln om lagets fotboll (match, spelare, klubb): svara true. Vid genuin tveksamhet: svara true.`;

export async function filterRelevance(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return; // utan nyckel: hoppa över, artiklar visas ofiltrerade

  const db = await getDb();
  const pending = await db
    .select({
      articleId: articleTeams.articleId,
      teamId: articleTeams.teamId,
      title: articles.title,
      summary: articles.summary,
      source: articles.source,
      teamName: teams.name,
    })
    .from(articleTeams)
    .innerJoin(articles, eq(articleTeams.articleId, articles.id))
    .innerJoin(teams, eq(articleTeams.teamId, teams.id))
    .where(isNull(articleTeams.checkedAt));

  if (pending.length === 0) return;

  const client = new Anthropic({ apiKey });
  const now = new Date();

  // Betrodda krönikörer godkänns direkt, resten går till AI-filtret.
  const trusted = pending.filter((p) => isTrustedByline(p.title));
  const toCheck = pending.filter((p) => !isTrustedByline(p.title));
  for (const pair of trusted) {
    await db
      .update(articleTeams)
      .set({ relevant: true, checkedAt: now })
      .where(
        and(
          eq(articleTeams.articleId, pair.articleId),
          eq(articleTeams.teamId, pair.teamId),
        ),
      );
  }

  for (let start = 0; start < toCheck.length; start += BATCH_SIZE) {
    const batch = toCheck.slice(start, start + BATCH_SIZE);
    const prompt =
      "Svara med ENBART en JSON-array, ett objekt per artikel: " +
      '[{"i":0,"relevant":true}, ...].\n\n' +
      batch
        .map((b, i) => {
          const ingress = b.summary ? ` | Ingress: ${b.summary.slice(0, 180)}` : "";
          return `${i}. Lag: ${b.teamName}${aliasHint(b.teamId)} | Rubrik: ${b.title}${ingress} | Källa: ${b.source}`;
        })
        .join("\n");

    let verdicts: Map<number, boolean>;
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("");
      const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
      verdicts = new Map(
        responseSchema.parse(JSON.parse(json)).map((v) => [v.i, v.relevant]),
      );
    } catch (err) {
      // lämna batchen obedömd — nästa synk försöker igen
      console.error("[relevance] batch misslyckades:", err);
      continue;
    }

    for (let i = 0; i < batch.length; i++) {
      const pair = batch[i];
      // saknas index i svaret → behåll optimistiskt (true), men markera bedömt
      const relevant = verdicts.get(i) ?? true;
      await db
        .update(articleTeams)
        .set({ relevant, checkedAt: now })
        .where(
          and(
            eq(articleTeams.articleId, pair.articleId),
            eq(articleTeams.teamId, pair.teamId),
          ),
        );
    }
  }
}
