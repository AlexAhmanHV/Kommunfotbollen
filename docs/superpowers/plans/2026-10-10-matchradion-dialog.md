# Matchradion som dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Matchradion leds av två jämlika värdar, Tommy och Peter, i stället för en berättare.

**Architecture:** Claude skriver manuset som rader `Tommy: …` / `Peter: …`. En ren parser (`parseDialogue`) validerar och delar upp det. Varje replik läses upp för sig med `eleven_multilingual_v2` och rätt röst, med grannreplikerna som `previous_text`/`next_text`, och MP3-svaren sätts ihop i ordning. Lagring, spelare och arkiv är oförändrade.

**Tech Stack:** TypeScript, Zod 4, `@anthropic-ai/sdk`, ElevenLabs REST (fetch), `tsx --test` (node:test).

**Spec:** `docs/superpowers/specs/2026-10-10-matchradion-dialog-design.md`

## Global Constraints

- Talare: exakt `Tommy` och `Peter`. Replik högst 250 tecken. Hela manuset 200–4 000 tecken (befintligt `scriptSchema`).
- Röster: Tommy = `ELEVENLABS_VOICE_ID`, Peter = ny `ELEVENLABS_VOICE_ID_2` (`oJEeOXECH9V31Oci9WHK`).
- TTS-modell `eleven_multilingual_v2`, `output_format=mp3_44100_128`, tidsgräns 2 min per anrop (befintlig `TTS_TIMEOUT_MS`).
- Manuset sparas med talarprefix i `radio_episodes.script` — ingen schemaändring.
- Inga nya npm-beroenden. Kodkommentarer på svenska.
- Kör aldrig något som anropar Anthropic/ElevenLabs/Supabase eller skriver till databasen (`.env.local` pekar på produktion). Starta ingen dev-server.

## Review Focus

1. Claude skriver talaren med fel skiftläge eller extra blanksteg (`tommy :`) → ska accepteras och normaliseras till `Tommy` (test i Task 1).
2. En rad utan talarprefix (fortsättning på förra repliken, avrundningsmening) → hela manuset avvisas, så att ingen text läses med fel röst eller tappas (test i Task 1).
3. Kolon i själva repliken (`Tommy: Tabellen: Vimmerby leder.`) → allt efter första prefixkolonet behålls som text (test i Task 1).
4. Replik på exakt 250 tecken godkänns, 251 avvisas (test i Task 1).
5. Första och sista repliken har ingen granne → `previous_text`/`next_text` utelämnas i stället för tom sträng (test i Task 2).

---

### Task 1: `parseDialogue`

**Files:**
- Create: `lib/radio/dialogue.ts`
- Test: `lib/radio/dialogue.test.ts`

**Interfaces:**
- Produces: `type Speaker = "Tommy" | "Peter"`, `type DialogueLine = { speaker: Speaker; text: string }`, `MAX_LINE_CHARS = 250`, `parseDialogue(script: string): DialogueLine[]` (kastar `Error` vid ogiltig dialog).

- [ ] **Step 1: Skriv de fallerande testerna**

`lib/radio/dialogue.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINE_CHARS, parseDialogue } from "./dialogue";

describe("parseDialogue", () => {
  it("delar upp repliker i ordning", () => {
    const lines = parseDialogue("Tommy: Välkomna!\nPeter: Tack, Tommy.\nTommy: Nu kör vi.");
    assert.deepEqual(lines, [
      { speaker: "Tommy", text: "Välkomna!" },
      { speaker: "Peter", text: "Tack, Tommy." },
      { speaker: "Tommy", text: "Nu kör vi." },
    ]);
  });

  it("ignorerar tomma rader och CRLF", () => {
    const lines = parseDialogue("Tommy: Hej.\r\n\r\n\nPeter: Hej hej.\r\n");
    assert.equal(lines.length, 2);
  });

  it("normaliserar skiftläge och blanksteg i talaren", () => {
    const lines = parseDialogue("  tommy :  Hej.  \nPETER:Hej hej.");
    assert.deepEqual(lines, [
      { speaker: "Tommy", text: "Hej." },
      { speaker: "Peter", text: "Hej hej." },
    ]);
  });

  it("behåller kolon i själva repliken", () => {
    const lines = parseDialogue("Tommy: Tabellen: Vimmerby leder.\nPeter: Ja.");
    assert.equal(lines[0].text, "Tabellen: Vimmerby leder.");
  });

  it("avvisar en rad utan känd talare", () => {
    assert.throws(() => parseDialogue("Tommy: Hej.\nPeter: Hej.\nOch så var det slut."), /talare/);
    assert.throws(() => parseDialogue("Tommy: Hej.\nAnna: Hej."), /talare/);
  });

  it("avvisar en tom replik", () => {
    assert.throws(() => parseDialogue("Tommy: Hej.\nPeter:   "), /tom/);
  });

  it("godkänner 250 tecken men inte 251", () => {
    const ok = "a".repeat(MAX_LINE_CHARS);
    assert.equal(parseDialogue(`Tommy: ${ok}\nPeter: Ja.`)[0].text.length, 250);
    assert.throws(() => parseDialogue(`Tommy: ${ok}a\nPeter: Ja.`), /lång/);
  });

  it("kräver att båda värdarna pratar", () => {
    assert.throws(() => parseDialogue("Tommy: Hej.\nTommy: Igen."), /båda/);
    assert.throws(() => parseDialogue(""), /båda/);
  });
});
```

- [ ] **Step 2: Kör och se dem falla**

Run: `npx tsx --test lib/radio/dialogue.test.ts`
Expected: FAIL — `Cannot find module './dialogue'`.

- [ ] **Step 3: Implementera**

`lib/radio/dialogue.ts`:

```ts
// Matchradions manus är en dialog: en replik per rad, "Tommy: …" eller
// "Peter: …". Parsern är strikt — en rad som inte går att tillskriva en
// värd får aldrig läsas upp med fel röst eller tappas tyst.

export type Speaker = "Tommy" | "Peter";
export type DialogueLine = { speaker: Speaker; text: string };

export const MAX_LINE_CHARS = 250;

const SPEAKERS: Record<string, Speaker> = { tommy: "Tommy", peter: "Peter" };
const LINE = /^\s*([^:]+?)\s*:\s*(.*?)\s*$/;

export function parseDialogue(script: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  for (const raw of script.split(/\r?\n/)) {
    if (raw.trim() === "") continue;
    const m = LINE.exec(raw);
    const speaker = m ? SPEAKERS[m[1].toLowerCase()] : undefined;
    if (!m || !speaker) throw new Error(`okänd talare på raden: ${raw.slice(0, 60)}`);
    const text = m[2];
    if (text === "") throw new Error(`tom replik för ${speaker}`);
    if (text.length > MAX_LINE_CHARS) {
      throw new Error(`för lång replik för ${speaker} (${text.length} tecken)`);
    }
    lines.push({ speaker, text });
  }
  const speakers = new Set(lines.map((l) => l.speaker));
  if (speakers.size < 2) throw new Error("båda värdarna måste prata i dialogen");
  return lines;
}
```

- [ ] **Step 4: Kör och se dem passera**

Run: `npx tsx --test lib/radio/dialogue.test.ts`
Expected: PASS, 8 tester.

- [ ] **Step 5: Commit**

```bash
git add lib/radio/dialogue.ts lib/radio/dialogue.test.ts
git commit -m "feat(radio): parseDialogue for two-host scripts"
```

---

### Task 2: Uppläsning replik för replik

**Files:**
- Modify: `lib/radio/voice.ts` (ersätt `synthesize`)
- Test: `lib/radio/voice.test.ts` (ny)

**Interfaces:**
- Consumes: `DialogueLine`, `Speaker` från Task 1.
- Produces: `ttsRequests(lines: DialogueLine[], voices: Record<Speaker, string>): { voiceId: string; body: TtsBody }[]` (ren), `synthesizeDialogue(lines: DialogueLine[], apiKey: string, voices: Record<Speaker, string>): Promise<ArrayBuffer>`. `synthesize` tas bort.

- [ ] **Step 1: Skriv de fallerande testerna**

`lib/radio/voice.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ttsRequests } from "./voice";

const VOICES = { Tommy: "voice-tommy", Peter: "voice-peter" };

describe("ttsRequests", () => {
  it("en förfrågan per replik med rätt röst och grannarnas text", () => {
    const reqs = ttsRequests(
      [
        { speaker: "Tommy", text: "Ett." },
        { speaker: "Peter", text: "Två." },
        { speaker: "Tommy", text: "Tre." },
      ],
      VOICES,
    );
    assert.deepEqual(
      reqs.map((r) => r.voiceId),
      ["voice-tommy", "voice-peter", "voice-tommy"],
    );
    assert.deepEqual(reqs[1].body, {
      text: "Två.",
      model_id: "eleven_multilingual_v2",
      previous_text: "Ett.",
      next_text: "Tre.",
    });
  });

  it("utelämnar previous_text först och next_text sist", () => {
    const reqs = ttsRequests(
      [
        { speaker: "Tommy", text: "Ett." },
        { speaker: "Peter", text: "Två." },
      ],
      VOICES,
    );
    assert.equal("previous_text" in reqs[0].body, false);
    assert.equal(reqs[0].body.next_text, "Två.");
    assert.equal(reqs[1].body.previous_text, "Ett.");
    assert.equal("next_text" in reqs[1].body, false);
  });
});
```

- [ ] **Step 2: Kör och se dem falla**

Run: `npx tsx --test lib/radio/voice.test.ts`
Expected: FAIL — `ttsRequests` finns inte (SyntaxError/does not provide an export).

- [ ] **Step 3: Implementera**

I `lib/radio/voice.ts`: uppdatera filkommentaren, lägg till importen och ersätt hela funktionen `synthesize` (inklusive dess JSDoc) med:

```ts
import type { DialogueLine, Speaker } from "./dialogue";
```

(överst i filen), och

```ts
type TtsBody = { text: string; model_id: string; previous_text?: string; next_text?: string };

/** En TTS-förfrågan per replik. Grannreplikernas text skickas med så att
 * intonationen hänger ihop över växlingarna. */
export function ttsRequests(
  lines: DialogueLine[],
  voices: Record<Speaker, string>,
): { voiceId: string; body: TtsBody }[] {
  return lines.map((line, i) => {
    const body: TtsBody = { text: line.text, model_id: TTS_MODEL };
    if (i > 0) body.previous_text = lines[i - 1].text;
    if (i < lines.length - 1) body.next_text = lines[i + 1].text;
    return { voiceId: voices[line.speaker], body };
  });
}

/** Dialog → en MP3: replik för replik i ordning, svaren ihopsatta. Ett fel i
 * någon replik kastar — ett avsnitt med halva dialogen får aldrig sändas. */
export async function synthesizeDialogue(
  lines: DialogueLine[],
  apiKey: string,
  voices: Record<Speaker, string>,
): Promise<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  for (const { voiceId, body } of ttsRequests(lines, voices)) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
    parts.push(new Uint8Array(await res.arrayBuffer()));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out.buffer;
}
```

Filkommentaren högst upp blir:

```ts
// Uppläsning (ElevenLabs, en replik i taget) och lagring (Supabase Storage)
// av Matchradion. Båda via fetch — inga SDK:er behövs.
```

- [ ] **Step 4: Kör och se dem passera**

Run: `npx tsx --test lib/radio/voice.test.ts`
Expected: PASS, 2 tester. (`npx tsc --noEmit` fallerar tills Task 3 byter anropet i `generate.ts` — förväntat.)

- [ ] **Step 5: Commit**

```bash
git add lib/radio/voice.ts lib/radio/voice.test.ts
git commit -m "feat(radio): synthesize dialogue line by line with neighbour context"
```

---

### Task 3: Dialogprompt och koppling i jobbet

**Files:**
- Modify: `lib/radio/script.ts` (prompt + validering)
- Modify: `lib/radio/generate.ts` (env, parse, uppläsning)
- Modify: `README.md` (Matchradion-avsnittet)
- Test: `lib/radio/script.test.ts` (befintliga måste passera)

**Interfaces:**
- Consumes: `parseDialogue` (Task 1), `synthesizeDialogue` (Task 2).
- Produces: `writeScript` returnerar ett manus som garanterat passerar `parseDialogue`.

- [ ] **Step 1: Ny prompt**

I `lib/radio/script.ts`, ersätt i `SYSTEM`:

- första stycket med:

```
Du skriver manus till "Matchradion", ett kort veckoprogram om lokal amatörfotboll i Västervik med omnejd. Programmet leds av två jämlika värdar, Tommy och Peter, som läses upp av AI-röster med publikljud i bakgrunden.
```

- raden `- Börja med en kort hälsning med veckonumret och sluta med en kort avrundning.` med:

```
- Tommy och Peter turas om med lagen och pratar med varandra — reagera, ställ en fråga, lämna över. Båda presenterar sig i början, och programmet slutar med en kort gemensam avrundning.
- Citat kan läsas av vem som helst av värdarna, alltid ordagrant med talare och källa.
```

- raden `- Ren löptext för uppläsning: inga rubriker, listor, emojis eller markdown.` med:

```
- Format: en replik per rad, som börjar med "Tommy: " eller "Peter: ". Varje replik högst 250 tecken. Inga andra rader, rubriker, listor, emojis eller markdown.
```

Övriga regler (fakta, skyttar, citat, tabellrunda, uttal, stavning, längd 350–450 ord, "Svara med ENBART manuset.") lämnas orörda.

- [ ] **Step 2: Validera dialogen i `writeScript`**

Lägg till `import { parseDialogue } from "./dialogue";` och ersätt sista raden `return scriptSchema.parse(text);` med:

```ts
  const script = scriptSchema.parse(text);
  parseDialogue(script); // kastar om dialogen inte går att läsa upp
  return script;
```

- [ ] **Step 3: Koppla in i `generate.ts`**

1. Importer: `import { parseDialogue } from "./dialogue";` och ändra voice-importen till `import { storageReachable, synthesizeDialogue, uploadAudio } from "./voice";`.
2. Läs Peters röst: efter `const voiceId = process.env.ELEVENLABS_VOICE_ID;` lägg till `const voiceId2 = process.env.ELEVENLABS_VOICE_ID_2;`.
3. I `missing`-listan, efter `["ELEVENLABS_VOICE_ID", voiceId],` lägg till `["ELEVENLABS_VOICE_ID_2", voiceId2],`.
4. Villkoret blir `if (!anthropicKey || !elevenKey || !voiceId || !voiceId2 || !supabaseUrl || !serviceKey) {`.
5. Ersätt `const audio = await synthesize(script, elevenKey, voiceId);` med:

```ts
  const audio = await synthesizeDialogue(parseDialogue(script), elevenKey, {
    Tommy: voiceId,
    Peter: voiceId2,
  });
```

- [ ] **Step 4: README**

I `README.md`, Matchradion-avsnittet: ersätt env-raden med

```
- Sätt `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (Tommy), `ELEVENLABS_VOICE_ID_2` (Peter), `SUPABASE_URL` och `SUPABASE_SERVICE_ROLE_KEY` (plus `ANTHROPIC_API_KEY`) — saknas någon hoppas jobbet över.
```

och ändra i stycket ovanför "ElevenLabs läser upp det" till "två ElevenLabs-röster (Tommy och Peter) läser upp dialogen".

- [ ] **Step 5: Verifiera**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: inga typfel, inga lintfel, alla tester gröna (tidigare 89 + 8 + 2 = 99).

- [ ] **Step 6: Commit**

```bash
git add lib/radio/script.ts lib/radio/generate.ts README.md
git commit -m "feat(radio): two-host dialogue prompt and line-by-line voices in the weekly job"
```

---

### Efter planen (controller, inte underagent)

- Lägg till `ELEVENLABS_VOICE_ID_2=oJEeOXECH9V31Oci9WHK` i `.env`; Alex lägger in samma i Render.
- Verifiering mot riktiga API:er (ett dialogavsnitt, avkodas i spelaren) görs när ElevenLabs-krediter finns — med Alex ok.
