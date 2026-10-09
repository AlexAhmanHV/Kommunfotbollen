import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { EpisodeData } from "./episode-data";

// Manus till Matchradion. Ett anrop i veckan, så Sonnet (språket är
// produkten). Manuset valideras innan det går till ElevenLabs — ett skenande
// svar får inte bränna röstkrediter.

const MODEL = "claude-sonnet-5-5";
export const MAX_SCRIPT_CHARS = 4000;

export const scriptSchema = z
  .string()
  .trim()
  .min(200, "manuset är för kort")
  .max(MAX_SCRIPT_CHARS, "manuset är för långt");

const SYSTEM = `Du skriver manus till "Matchradion", ett kort veckoprogram om lokal amatörfotboll i Västervik med omnejd. Manuset läses upp av en AI-röst med publikljud i bakgrunden.

Underlaget är JSON:
- teams: varje lokalt lag som spelat i veckan, med results (motståndare, hemma/borta, mål, utfall, scorers, quotes) och next (nästa match).
- tables: tabellrundan per serie — leader (serieledaren) och localTeams (placering, poäng, previousPosition).

Regler:
- Använd ENBART fakta i underlaget. Hitta aldrig på händelser, matchminuter, väder, publiksiffror, skador eller egenskaper hos spelare.
- scorers är lagets kända målskyttar i ordning och kan vara ofullständig. Är listan tom: nämn bara resultatet, gissa aldrig vem som gjorde målen. Är den kortare än goalsFor: nämn de kända skyttarna utan att antyda att de gjorde alla mål.
- quotes får bara återges ordagrant, och alltid med vem som sa det och källan, t.ex. "– <citat>, säger <roll> <namn> till <källa>." Omformulera eller hitta aldrig på citat. Är role null: nämn bara namnet.
- Avsluta med tabellrundan: för varje serie, nämn serieledaren och de lokala lagens placering. previousPosition är placeringen vid förra avsnittet; är den null, nämn bara nuvarande placering. Säg aldrig "klättrar" eller "tappar" utan att previousPosition visar det.
- Skriv resultat och placeringar så att de låter rätt upplästa, t.ex. "vann med tre–ett", "ligger fyra".
- Börja med en kort hälsning med veckonumret och sluta med en kort avrundning.
- Naturlig, levande svenska som en lokal sportradiokommentator — engagerad men inte överdriven.
- Ren löptext för uppläsning: inga rubriker, listor, emojis eller markdown.
- Längd: 350–450 ord.
- Svara med ENBART manuset.`;

export async function writeScript(data: EpisodeData, apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Vecka ${data.week}. Underlag:\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  return scriptSchema.parse(text);
}
